/// <reference types="node" />
// 必须在所有 import 之前加载，这样 ai.config.ts 里的 process.env 才能取到局部 .env 的实际内容
import * as dotenv from 'dotenv';
dotenv.config(); // 生产环境文件不存在时静默失败，用户通过 UI 配置
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'path';
import {
  initDatabase,
  createConversation,
  listConversations,
  getMessages,
  deleteConversation,
  renameConversation,
  getSetting,
  setSetting,
  countNonSystemMessages,
  getMemoryCursor,
  getMemoryFragments,
  getGlobalMemoryCursor,
} from './db';
import { sendChatMessage, setToolEventListener } from './aiService';
import { triggerConversationLeave, memoryManager, globalMemoryManager, runStartupCatchUp, startIdleScheduler } from './memory/index';
import aiConfig from './ai.config';
import { startBridges, stopBridges } from './bridges/index';
import { DiscordAdapter } from './bridges/adapters/discord';
import { ttsService } from './ttsService';

// ── 实运行时加载持久化的 LLM 配置 ──────────────────────────────

/**
 * 用户可在 UI 修改的字段：apiKey / baseUrl / model / temperature / maxTokens / name
 * 其余字段（systemPrompt / extraParams / thinkingBudgetTokens）属于开发者配置，
 * 始终以 ai.config.ts 代码为准，不从数据库覆盖。
 * 这样每次更新提示词后重启即可生效，不需要用户手动清空数据库。
 */
const USER_EDITABLE_FIELDS = ['apiKey', 'baseUrl', 'model', 'temperature', 'maxTokens', 'name'] as const;

function loadPersistedConfig(): void {
  const stored = getSetting('llm_config');
  if (!stored) return;
  try {
    const saved = JSON.parse(stored) as typeof aiConfig;
    if (saved.activeProvider) aiConfig.activeProvider = saved.activeProvider;
    if (saved.agentMode) aiConfig.agentMode = saved.agentMode;
    if (saved.contextWindowRounds) aiConfig.contextWindowRounds = saved.contextWindowRounds;

    // 记录用户曾主动删除的 provider key
    const deletedProviders: string[] = saved.deletedProviders ?? [];
    aiConfig.deletedProviders = deletedProviders;

    if (saved.providers && Object.keys(saved.providers).length > 0) {
      for (const [key, codeProv] of Object.entries(aiConfig.providers)) {
        const dbProv = saved.providers[key];
        if (!dbProv) continue; // DB 里没有此 provider，保留代码默认值
        // 只把用户可编辑字段从 DB 合并进来，开发者字段（systemPrompt 等）始终用代码版本
        for (const field of USER_EDITABLE_FIELDS) {
          if (dbProv[field] !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (codeProv as any)[field] = dbProv[field];
          }
        }
      }
      // 将 DB 里用户自行新增的 provider（代码里没有的）也加进来
      for (const [key, dbProv] of Object.entries(saved.providers)) {
        if (!(key in aiConfig.providers) && !deletedProviders.includes(key)) {
          aiConfig.providers[key] = dbProv;
        }
      }
    }
  } catch {
    // 解析失败时保持默认配置
  }
}

/** 当前活跃对话 ID，用于切换时触发全局记忆精炼 */
let activeConversationId: string | null = null;

/** 全局窗口引用，用于向渲染层推送退出状态 */
let mainWin: BrowserWindow | null = null;

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: 360,
    height: 620,
    x: width - 380,
    y: height - 640,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    }
  });
  mainWin = win;

  // 启动时用 screen-saver 层级，确保盖过全屏应用和其他 alwaysOnTop 窗口
  win.setAlwaysOnTop(true, 'screen-saver');

  // 置顶切换
  let pinned = true;
  ipcMain.on('window-pin', () => {
    pinned = !pinned;
    if (pinned) {
      win.setAlwaysOnTop(true, 'screen-saver');
    } else {
      win.setAlwaysOnTop(false);
    }
    win.webContents.send('window-pin-state', pinned);
  });
  win.on('closed', () => ipcMain.removeAllListeners('window-pin'));

  // ── 工具调用调试事件：AI 每次调用工具时实时推送给渲染层 ──────
  setToolEventListener((ev) => {
    if (mainWin && !mainWin.isDestroyed() && !mainWin.webContents.isDestroyed()) {
      mainWin.webContents.send('tool-call-log', ev);
    }
  });
  win.on('closed', () => setToolEventListener(null));

  // ── 全屏光标追踪：每帧推送光标屏幕坐标给渲染层，用于 Live2D 目光追踪 ──
  const cursorInterval = setInterval(() => {
    if (mainWin && !mainWin.isDestroyed() && !mainWin.webContents.isDestroyed()) {
      const { x, y } = screen.getCursorScreenPoint();
      mainWin.webContents.send('cursor-position', { x, y });
    }
  }, 16); // ~60fps
  win.on('closed', () => clearInterval(cursorInterval));

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // ── 窗口控制 ──────────────────────────────────────────────
  ipcMain.on('window-drag', (_e, { deltaX, deltaY }: { deltaX: number; deltaY: number }) => {
    const [x, y] = win.getPosition();
    win.setPosition(x + deltaX, y + deltaY);
  });

  ipcMain.on('window-close', () => app.quit());

  ipcMain.on('window-resize', (_e, { height: h }: { height: number }) => {
    win.setSize(360, h);
  });

  // ── 对话管理 ──────────────────────────────────────────────
  ipcMain.handle('chat:create-conversation', () => createConversation());
  ipcMain.handle('chat:list-conversations', () => listConversations());
  ipcMain.handle('chat:load-conversation', (_e, id: string) => {
    // 切换到不同对话时，触发旧对话的离开流水线（强制衦1 + 全局精炼）
    if (activeConversationId && activeConversationId !== id) {
      triggerConversationLeave(activeConversationId);
    }
    activeConversationId = id;
    return getMessages(id);
  });
  ipcMain.handle('chat:delete-conversation', (_e, id: string) => deleteConversation(id));
  ipcMain.handle('chat:rename-conversation', (_e, id: string, title: string) =>
    renameConversation(id, title)
  );

  // ── AI 发送消息 ────────────────────────────────────────────
  ipcMain.handle('chat:send', (_e, conversationId: string, content: string) =>
    sendChatMessage(conversationId, content)
  );

  // ── LLM 设置 ──────────────────────────────────────────────
  ipcMain.handle('settings:get', () => ({
    activeProvider: aiConfig.activeProvider,
    agentMode: aiConfig.agentMode ?? 'off',
    contextWindowRounds: aiConfig.contextWindowRounds,
    providers: aiConfig.providers,
    deletedProviders: aiConfig.deletedProviders ?? [],
  }));

  ipcMain.handle('settings:save', (_e, newCfg: typeof aiConfig) => {
    aiConfig.activeProvider = newCfg.activeProvider;
    aiConfig.agentMode = newCfg.agentMode ?? 'off';
    aiConfig.contextWindowRounds = newCfg.contextWindowRounds;
    aiConfig.providers = newCfg.providers; // 完全替换
    aiConfig.deletedProviders = newCfg.deletedProviders ?? [];
    setSetting('llm_config', JSON.stringify({
      activeProvider: newCfg.activeProvider,
      agentMode: newCfg.agentMode ?? 'off',
      contextWindowRounds: newCfg.contextWindowRounds,
      providers: newCfg.providers,
      deletedProviders: newCfg.deletedProviders ?? [],
    }));
  });

  // ── Discord 设置 ──────────────────────────────────────────
  ipcMain.handle('discord:get', () => {
    return {
      enabled:         process.env['DISCORD_ENABLED'] === 'true',
      token:           process.env['DISCORD_TOKEN'] ?? '',
      allowedChannels: process.env['DISCORD_ALLOWED_CHANNELS'] ?? '',
      proxyUrl:        process.env['DISCORD_PROXY'] ?? '',
    };
  });

  ipcMain.handle('discord:status', () => {
    return DiscordAdapter.activeClient !== null ? 'online' : 'offline';
  });

  ipcMain.handle('discord:save', async (_e, cfg: {
    enabled: boolean; token: string; allowedChannels: string; proxyUrl: string;
  }) => {
    // 写入 .env 文件（项目根目录）
    const fs = require('fs') as typeof import('fs');
    const envPath = app.isPackaged
      ? join(process.resourcesPath, '.env')
      : join(app.getAppPath(), '.env');

    // 读取现有 .env，更新 DISCORD_* 字段
    let envContent = '';
    try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch { /* 文件不存在时从空白开始 */ }

    const lines = envContent.split('\n').filter(l => !/^DISCORD_/.test(l.trim()));
    lines.push(`DISCORD_ENABLED=${cfg.enabled}`);
    lines.push(`DISCORD_TOKEN=${cfg.token}`);
    lines.push(`DISCORD_ALLOWED_CHANNELS=${cfg.allowedChannels}`);
    lines.push(`DISCORD_PROXY=${cfg.proxyUrl}`);
    fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');

    // 同步更新 process.env，让下次 loadBridgeConfig() 读到最新值
    process.env['DISCORD_ENABLED'] = String(cfg.enabled);
    process.env['DISCORD_TOKEN'] = cfg.token;
    process.env['DISCORD_ALLOWED_CHANNELS'] = cfg.allowedChannels;
    process.env['DISCORD_PROXY'] = cfg.proxyUrl;

    // 重启 bridges
    await stopBridges();
    const convs = listConversations();
    const convId = convs.length > 0 ? convs[0].id : createConversation().id;
    await startBridges(convId).catch(e => console.error('[Discord] 重启失败:', (e as Error).message));
  });

  // ── TTS ──────────────────────────────────────────────────────
  ipcMain.handle('tts:speak', async (_e, text: string) => {
    if (!ttsService.isEnabled) return null;
    try {
      const wav = await ttsService.speak(text);
      const data = Buffer.from(wav).toString('base64');
      return { data };
    } catch (e) {
      console.warn('[TTS] speak 失败:', (e as Error).message);
      return null;
    }
  });

  ipcMain.handle('tts:isEnabled', () => ttsService.isEnabled);

  ipcMain.handle('tts:debug', () => ttsService.debugInfo());

  ipcMain.handle('tts:health', () => ttsService.health());

  // ── TTS 配置读写（设置 UI 用）──────────────────────────────────
  ipcMain.handle('tts:config:get', () => ({
    enabled:  process.env['TTS_ENABLED']  === 'true',
    url:      process.env['TTS_URL']      ?? '',
    apiKey:   process.env['TTS_API_KEY']  ?? '',
    speaker:  process.env['TTS_SPEAKER']  ?? '',
    language: process.env['TTS_LANGUAGE'] ?? 'Auto',
  }));

  ipcMain.handle('tts:config:save', async (_e, newCfg: {
    enabled: boolean; url: string; apiKey: string; speaker: string; language: string;
  }) => {
    const fs = require('fs') as typeof import('fs');
    const envPath = app.isPackaged
      ? join(process.resourcesPath, '.env')
      : join(app.getAppPath(), '.env');

    let envContent = '';
    try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch { /* 文件不存在时从空白开始 */ }

    const lines = envContent.split('\n').filter(l => !/^TTS_/.test(l.trim()));
    lines.push(`TTS_ENABLED=${newCfg.enabled}`);
    lines.push(`TTS_URL=${newCfg.url}`);
    lines.push(`TTS_API_KEY=${newCfg.apiKey}`);
    lines.push(`TTS_SPEAKER=${newCfg.speaker}`);
    lines.push(`TTS_LANGUAGE=${newCfg.language}`);
    fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');

    process.env['TTS_ENABLED']  = String(newCfg.enabled);
    process.env['TTS_URL']      = newCfg.url;
    process.env['TTS_API_KEY']  = newCfg.apiKey;
    process.env['TTS_SPEAKER']  = newCfg.speaker;
    process.env['TTS_LANGUAGE'] = newCfg.language;

    ttsService.reset(); // 下次调用 speak() 时重新初始化
  });

  ipcMain.handle('tts:config:test', async (_e, url: string) => {
    if (!url) return { ok: false, error: '地址为空' };
    const cleanUrl = url.replace(/\/$/, '');
    try {
      const resp = await fetch(`${cleanUrl}/health/`, { signal: AbortSignal.timeout(5000) });
      const body = await resp.text().catch(() => '');
      return { ok: resp.ok, status: resp.status, body: body.slice(0, 100) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
}

app.whenReady().then(() => {
  initDatabase();
  loadPersistedConfig();
  createWindow();

  // ── 启动平台桥接（Discord 等）：使用首个对话 ID 作为默认绑定对话 ──
  const existingConvs = listConversations();
  const defaultConvId = existingConvs.length > 0
    ? existingConvs[0].id
    : createConversation().id;
  startBridges(defaultConvId).catch((e) =>
    console.error('[Bridges] 启动失败:', (e as Error).message)
  );

  // ── 启动时批量追赶：延迟 3s 等 UI 稳定后处理所有遗留的未总结消息 ──
  setTimeout(() => {
    const ids = listConversations().map((c) => c.id);
    runStartupCatchUp(ids).catch((e) =>
      console.error('[Memory] 启动追赶异常:', (e as Error).message)
    );
  }, 3000);

  // ── 空闲调度器：用户停止聊天 10 分钟后自动后台总结 ──
  startIdleScheduler(() => activeConversationId);
});

/** 防止 before-quit 重入：流水线执行完成后我们主动调用 app.quit()，不再被拦截 */
let isQuitting = false;

app.on('before-quit', (event) => {
  if (isQuitting || !activeConversationId) return;

  // ── 快速判断是否真的有需要处理的内容 ──────────────────────
  const convId = activeConversationId;
  const batchSize = 6; // leaveMinRounds(3) * 2，与 DEFAULT_MEMORY_CONFIG 保持一致
  const unsummarized = countNonSystemMessages(convId) - getMemoryCursor(convId);
  const newFragments = getMemoryFragments(convId).length - getGlobalMemoryCursor(convId);
  const hasWork = unsummarized >= batchSize || newFragments > 0;

  if (!hasWork) return; // 无需处理，放行立即退出

  // ── 有工作要做：拦截退出，显示遮罩，执行流水线 ─────────────
  event.preventDefault();
  isQuitting = true;

  // 通知渲染层显示退出提示
  if (mainWin && !mainWin.isDestroyed() && !mainWin.webContents.isDestroyed()) {
    mainWin.webContents.send('app:quitting');
  }

  ;(async () => {
    console.info('[Memory] 应用退出，执行记忆流水线...');
    await memoryManager.forcePartialSummarize(convId);
    await globalMemoryManager.refineAsync(convId);
    console.info('[Memory] 记忆流水线完成，正常退出');
  })()
    .catch((e) => console.error('[Memory] 退出时流水线异常:', (e as Error).message))
    .finally(() => {
      stopBridges().finally(() => {
        if (mainWin && !mainWin.isDestroyed() && !mainWin.webContents.isDestroyed()) {
          // 通知渲染层流水线完成，短暂展示"已保存"后关闭
          mainWin.webContents.send('app:quit-ready');
          setTimeout(() => {
            mainWin?.destroy(); // 直接 destroy 跳过 close 事件，防止重入
            app.quit();
          }, 400);
        } else {
          app.quit();
        }
      });
    });
});

app.on('window-all-closed', () => {
  app.quit();
});

