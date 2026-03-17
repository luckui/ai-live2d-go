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
import { sendChatMessage } from './aiService';
import { triggerConversationLeave, memoryManager, globalMemoryManager, runStartupCatchUp, startIdleScheduler } from './memory/index';
import aiConfig from './ai.config';

// ── 实运行时加载持久化的 LLM 配置 ──────────────────────────────
function loadPersistedConfig(): void {
  const stored = getSetting('llm_config');
  if (!stored) return;
  try {
    const saved = JSON.parse(stored) as typeof aiConfig;
    if (saved.activeProvider) aiConfig.activeProvider = saved.activeProvider;
    if (saved.contextWindowRounds) aiConfig.contextWindowRounds = saved.contextWindowRounds;
    if (saved.providers && Object.keys(saved.providers).length > 0) {
      aiConfig.providers = saved.providers; // 完全替换，支持用户删除默认 provider
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
  }));

  ipcMain.handle('settings:save', (_e, newCfg: typeof aiConfig) => {
    aiConfig.activeProvider = newCfg.activeProvider;
    aiConfig.contextWindowRounds = newCfg.contextWindowRounds;
    aiConfig.providers = newCfg.providers; // 完全替换
    setSetting('llm_config', JSON.stringify(newCfg));
  });
}

app.whenReady().then(() => {
  initDatabase();
  loadPersistedConfig();
  createWindow();

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

app.on('window-all-closed', () => {
  app.quit();
});

