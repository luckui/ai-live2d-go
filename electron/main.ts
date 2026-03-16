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
} from './db';
import { sendChatMessage } from './aiService';
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
    }
  });

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

  ipcMain.on('window-close', () => win.close());

  ipcMain.on('window-resize', (_e, { height: h }: { height: number }) => {
    win.setSize(360, h);
  });

  // ── 对话管理 ──────────────────────────────────────────────
  ipcMain.handle('chat:create-conversation', () => createConversation());
  ipcMain.handle('chat:list-conversations', () => listConversations());
  ipcMain.handle('chat:load-conversation', (_e, id: string) => getMessages(id));
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
});

app.on('window-all-closed', () => {
  app.quit();
});

