/// <reference types="node" />
// 必须在所有 import 之前加载，这样 ai.config.ts 里的 process.env 才能取到局部 .env 的实际内容
import * as dotenv from 'dotenv';
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'path';

/**
 * 持久化 .env 文件路径：
 *   dev  → 项目根目录（便于直接编辑）
 *   打包 → app.getPath('userData')（系统用户数据目录，跨版本升级不丢失）
 *          Windows: %AppData%\<AppName>\.env
 */
function getEnvFilePath(): string {
  return app.isPackaged
    ? join(app.getPath('userData'), '.env')
    : join(app.getAppPath(), '.env');
}

/**
 * 启动时环境变量合并：
 *   1. 优先读取 userData/.env（用户自定义值）
 *   2. 对 userData/.env 里缺失的键，从 resources/.env.defaults（打包时的项目 .env）补充
 *   这样升级后新增的配置项能自动填入默认值，同时不覆盖用户已有配置。
 */
function migrateEnvFile(): void {
  if (!app.isPackaged) return;
  const fs = require('fs') as typeof import('fs');
  const userDataEnv  = getEnvFilePath();
  const defaultsPath = join(process.resourcesPath, '.env.defaults');

  // 读取默认值（打包时的 .env）
  let defaults: Record<string, string> = {};
  if (fs.existsSync(defaultsPath)) {
    try {
      const raw = fs.readFileSync(defaultsPath, 'utf-8');
      for (const line of raw.split('\n')) {
        const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
        if (m) defaults[m[1].trim()] = m[2].trim();
      }
    } catch { /* 读取失败忽略 */ }
  }

  // 读取用户配置（可能不存在）
  let userLines: string[] = [];
  let userKeys  = new Set<string>();
  if (fs.existsSync(userDataEnv)) {
    try {
      userLines = fs.readFileSync(userDataEnv, 'utf-8').split('\n');
      for (const line of userLines) {
        const m = line.match(/^([^#=\s][^=]*)=/);
        if (m) userKeys.add(m[1].trim());
      }
    } catch { /* 读取失败从空开始 */ }
  }

  // 把 defaults 里有但 userData/.env 里缺的键追加进去
  const missing = Object.entries(defaults).filter(([k]) => !userKeys.has(k));
  if (missing.length > 0 || userLines.length === 0) {
    for (const [k, v] of missing) userLines.push(`${k}=${v}`);
    try {
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      fs.writeFileSync(userDataEnv, userLines.filter(l => l !== '').join('\n') + '\n', 'utf-8');
      if (missing.length > 0) {
        console.info(`[Config] 补充了 ${missing.length} 个缺失配置项:`, missing.map(([k]) => k).join(', '));
      }
    } catch (e) {
      console.warn('[Config] 写入 userData/.env 失败:', (e as Error).message);
    }
  }
}

// 迁移后再加载（迁移必须在 dotenv.config 之前）
migrateEnvFile();
// 启动时从正确路径加载 .env
dotenv.config({ path: getEnvFilePath() });
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
  getStructuredGlobalMemory,
  setStructuredGlobalMemory,
} from './db';
import { sendChatMessage, setToolEventListener } from './aiService';
import { triggerConversationLeave, memoryManager, globalMemoryManager, runStartupCatchUp, startIdleScheduler } from './memory/index';
import { exportMemoryToMarkdown, importMemoryFromMarkdown } from './memory/memoryExport';
import aiConfig from './ai.config';
import { startBridges, stopBridges } from './bridges/index';
import { DiscordAdapter } from './bridges/adapters/discord';
import { WeChatAdapter, qrLogin } from './bridges/adapters/wechat';
import { ttsService } from './ttsService';
import { getAgentMode, setAgentMode } from './agentMode';

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
    contextWindowRounds: aiConfig.contextWindowRounds,
    providers: aiConfig.providers,
    deletedProviders: aiConfig.deletedProviders ?? [],
  }));

  ipcMain.handle('settings:save', (_e, newCfg: typeof aiConfig) => {
    aiConfig.activeProvider = newCfg.activeProvider;
    aiConfig.contextWindowRounds = newCfg.contextWindowRounds;
    aiConfig.providers = newCfg.providers; // 完全替换
    aiConfig.deletedProviders = newCfg.deletedProviders ?? [];
    setSetting('llm_config', JSON.stringify({
      activeProvider: newCfg.activeProvider,
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
    // ① 先更新内存 env（当前会话立即生效，与文件写入无关）
    process.env['DISCORD_ENABLED']          = String(cfg.enabled);
    process.env['DISCORD_TOKEN']            = cfg.token;
    process.env['DISCORD_ALLOWED_CHANNELS'] = cfg.allowedChannels;
    process.env['DISCORD_PROXY']            = cfg.proxyUrl;

    // ② 再持久化到 .env 文件（失败只影响下次重启，不影响当前会话）
    try {
      const fs = require('fs') as typeof import('fs');
      const envPath = getEnvFilePath();
      let envContent = '';
      try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch { }
      const lines = envContent.split('\n').filter(l => !/^DISCORD_/.test(l.trim()));
      lines.push(`DISCORD_ENABLED=${cfg.enabled}`);
      lines.push(`DISCORD_TOKEN=${cfg.token}`);
      lines.push(`DISCORD_ALLOWED_CHANNELS=${cfg.allowedChannels}`);
      lines.push(`DISCORD_PROXY=${cfg.proxyUrl}`);
      fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');
    } catch (e) {
      console.warn('[Discord config] 写入 .env 失败（仅影响持久化）:', (e as Error).message);
    }

    // ③ 重启 bridges
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

  // ── WeChat 设置 ──────────────────────────────────────────────
  ipcMain.handle('wechat:get', () => {
    return {
      enabled:         process.env['WECHAT_ENABLED'] === 'true',
      token:           process.env['WECHAT_TOKEN'] ?? '',
      accountId:       process.env['WECHAT_ACCOUNT_ID'] ?? '',
      baseUrl:         process.env['WECHAT_BASE_URL'] ?? 'https://ilinkai.weixin.qq.com',
      sendChunkDelay:  parseFloat(process.env['WECHAT_SEND_CHUNK_DELAY'] ?? '0.35'),
    };
  });

  ipcMain.handle('wechat:status', () => {
    return WeChatAdapter.activeAdapter !== null ? 'online' : 'offline';
  });

  ipcMain.handle('wechat:save', async (_e, cfg: {
    enabled: boolean; token?: string; accountId?: string; baseUrl?: string; sendChunkDelay?: number;
  }) => {
    // 更新内存 env
    process.env['WECHAT_ENABLED']         = String(cfg.enabled);
    if (cfg.token) process.env['WECHAT_TOKEN'] = cfg.token;
    if (cfg.accountId) process.env['WECHAT_ACCOUNT_ID'] = cfg.accountId;
    if (cfg.baseUrl) process.env['WECHAT_BASE_URL'] = cfg.baseUrl;
    if (cfg.sendChunkDelay !== undefined) {
      process.env['WECHAT_SEND_CHUNK_DELAY'] = String(cfg.sendChunkDelay);
    }

    // 持久化到 .env 文件
    try {
      const fs = require('fs') as typeof import('fs');
      const envPath = getEnvFilePath();
      let envContent = '';
      try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch { }
      const lines = envContent.split('\n').filter(l => !/^WECHAT_/.test(l.trim()));
      lines.push(`WECHAT_ENABLED=${cfg.enabled}`);
      if (cfg.token) lines.push(`WECHAT_TOKEN=${cfg.token}`);
      if (cfg.accountId) lines.push(`WECHAT_ACCOUNT_ID=${cfg.accountId}`);
      if (cfg.baseUrl) lines.push(`WECHAT_BASE_URL=${cfg.baseUrl}`);
      if (cfg.sendChunkDelay !== undefined) {
        lines.push(`WECHAT_SEND_CHUNK_DELAY=${cfg.sendChunkDelay}`);
      }
      fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');
    } catch (e) {
      console.warn('[WeChat config] 写入 .env 失败（仅影响持久化）:', (e as Error).message);
    }

    // 重启 bridges
    await stopBridges();
    const convs = listConversations();
    const convId = convs.length > 0 ? convs[0].id : createConversation().id;
    await startBridges(convId).catch(e => console.error('[WeChat] 重启失败:', (e as Error).message));
  });

  ipcMain.handle('wechat:qr-login', async (event) => {
    try {
      for await (const state of qrLogin()) {
        event.sender.send('wechat:qr-login-update', state);
        if (state.status === 'confirmed' && state.credentials) {
          // 保存凭证到 .env
          const creds = state.credentials;
          process.env['WECHAT_ENABLED']    = 'true';
          process.env['WECHAT_TOKEN']      = creds.token;
          process.env['WECHAT_ACCOUNT_ID'] = creds.accountId;
          process.env['WECHAT_BASE_URL']   = creds.baseUrl;
          
          try {
            const fs = require('fs') as typeof import('fs');
            const envPath = getEnvFilePath();
            let envContent = '';
            try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch { }
            const lines = envContent.split('\n').filter(l => !/^WECHAT_/.test(l.trim()));
            lines.push(`WECHAT_ENABLED=true`);
            lines.push(`WECHAT_TOKEN=${creds.token}`);
            lines.push(`WECHAT_ACCOUNT_ID=${creds.accountId}`);
            lines.push(`WECHAT_BASE_URL=${creds.baseUrl}`);
            fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');
          } catch (e) {
            console.warn('[WeChat QR] 写入 .env 失败:', (e as Error).message);
          }
          
          // 登录成功后自动启动 adapter
          try {
            await stopBridges();
            const convs = listConversations();
            const convId = convs.length > 0 ? convs[0].id : createConversation().id;
            await startBridges(convId);
            console.log('[WeChat QR] adapter 已自动启动');
          } catch (e) {
            console.error('[WeChat QR] 自动启动 adapter 失败:', (e as Error).message);
          }
          
          return { success: true, credentials: creds };
        } else if (state.status === 'error' || state.status === 'expired') {
          return { success: false, error: state.error };
        }
      }
      return { success: false, error: '登录超时' };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── Memory 导出/导入 ─────────────────────────────────────────
  ipcMain.handle('memory:export', async () => {
    const memory = getStructuredGlobalMemory();
    return await exportMemoryToMarkdown(memory);
  });

  ipcMain.handle('memory:import', async () => {
    const result = await importMemoryFromMarkdown();
    if (result.success && result.content) {
      // 导入成功，写入数据库
      setStructuredGlobalMemory(result.content);
    }
    return result;
  });

  // ── Agent 模式管理 ────────────────────────────────────────────
  ipcMain.handle('agent:get-mode', () => {
    return getAgentMode();
  });

  ipcMain.handle('agent:set-mode', (_e, mode: string) => {
    setAgentMode(mode);
    console.log(`[IPC] Agent 模式切换为: ${mode}`);
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
    // ① 先更新内存 env + 重置服务（当前会话立即生效）
    process.env['TTS_ENABLED']  = String(newCfg.enabled);
    process.env['TTS_URL']      = newCfg.url;
    process.env['TTS_API_KEY']  = newCfg.apiKey;
    process.env['TTS_SPEAKER']  = newCfg.speaker;
    process.env['TTS_LANGUAGE'] = newCfg.language;
    ttsService.reset();

    // ② 评断当前是否已有效（reset 后重新初始化）
    const nowEnabled = ttsService.isEnabled;
    const debug = {
      TTS_ENABLED:  process.env['TTS_ENABLED'],
      TTS_URL:      process.env['TTS_URL'] ? '(set)' : '(empty)',
      TTS_SPEAKER:  process.env['TTS_SPEAKER'] ? '(set)' : '(empty)',
      TTS_API_KEY:  process.env['TTS_API_KEY'] ? '(set)' : '(empty)',
      isEnabled:    nowEnabled,
    };
    console.info('[TTS config:save] 保存后状态:', debug);

    // ③ 再持久化到 .env 文件（失败只影响下次重启，不影响当前会话）
    let fileSaved = false;
    try {
      const fs = require('fs') as typeof import('fs');
      const envPath = getEnvFilePath();
      let envContent = '';
      try { envContent = fs.readFileSync(envPath, 'utf-8'); } catch { }
      const lines = envContent.split('\n').filter(l => !/^TTS_/.test(l.trim()));
      lines.push(`TTS_ENABLED=${newCfg.enabled}`);
      lines.push(`TTS_URL=${newCfg.url}`);
      lines.push(`TTS_API_KEY=${newCfg.apiKey}`);
      lines.push(`TTS_SPEAKER=${newCfg.speaker}`);
      lines.push(`TTS_LANGUAGE=${newCfg.language}`);
      fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');
      fileSaved = true;
    } catch (e) {
      console.warn('[TTS config] 写入 .env 失败（仅影响持久化）:', (e as Error).message);
    }

    return { isEnabled: nowEnabled, fileSaved, debug };
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

