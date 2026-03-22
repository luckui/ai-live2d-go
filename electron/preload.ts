import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  dragWindow: (deltaX: number, deltaY: number) =>
    ipcRenderer.send('window-drag', { deltaX, deltaY }),
  closeWindow: () => ipcRenderer.send('window-close'),
  resizeWindow: (height: number) => ipcRenderer.send('window-resize', { height }),
  togglePin: () => ipcRenderer.send('window-pin'),
  onPinState: (cb: (pinned: boolean) => void) =>
    ipcRenderer.on('window-pin-state', (_e, pinned) => cb(pinned)),
  /** 注册全屏光标位置回调，用于 Live2D 目光追踪 */
  onCursorPosition: (cb: (pos: { x: number; y: number }) => void) =>
    ipcRenderer.on('cursor-position', (_e, pos) => cb(pos)),
});

contextBridge.exposeInMainWorld('chatAPI', {
  createConversation: () =>
    ipcRenderer.invoke('chat:create-conversation'),
  listConversations: () =>
    ipcRenderer.invoke('chat:list-conversations'),
  loadConversation: (id: string) =>
    ipcRenderer.invoke('chat:load-conversation', id),
  deleteConversation: (id: string) =>
    ipcRenderer.invoke('chat:delete-conversation', id),
  renameConversation: (id: string, title: string) =>
    ipcRenderer.invoke('chat:rename-conversation', id, title),
  send: (conversationId: string, content: string) =>
    ipcRenderer.invoke('chat:send', conversationId, content),
});

contextBridge.exposeInMainWorld('settingsAPI', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: (cfg: unknown) => ipcRenderer.invoke('settings:save', cfg),
});

contextBridge.exposeInMainWorld('discordAPI', {
  get: () => ipcRenderer.invoke('discord:get'),
  save: (cfg: unknown) => ipcRenderer.invoke('discord:save', cfg),
  getStatus: () => ipcRenderer.invoke('discord:status'),
});

contextBridge.exposeInMainWorld('ttsAPI', {
  isEnabled: () => ipcRenderer.invoke('tts:isEnabled'),
  speak: (text: string) => ipcRenderer.invoke('tts:speak', text),
  debug: () => ipcRenderer.invoke('tts:debug'),
  health: () => ipcRenderer.invoke('tts:health'),
});

contextBridge.exposeInMainWorld('ttsSettingsAPI', {
  get:  ()             => ipcRenderer.invoke('tts:config:get'),
  save: (cfg: unknown) => ipcRenderer.invoke('tts:config:save', cfg) as Promise<{ isEnabled: boolean; fileSaved: boolean; debug: Record<string, unknown> }>,
  test: (url: string)  => ipcRenderer.invoke('tts:config:test', url),
});

/** 应用退出相关事件 */
contextBridge.exposeInMainWorld('appLifecycleAPI', {
  /** 开始退出流水线时触发（正在保存记忆） */
  onQuitting: (cb: () => void) =>
    ipcRenderer.on('app:quitting', () => cb()),
  /** 流水线完成、即将关闭时触发 */
  onQuitReady: (cb: () => void) =>
    ipcRenderer.on('app:quit-ready', () => cb()),
});

/** AI 工具调用调试事件（开发调试用） */
contextBridge.exposeInMainWorld('debugAPI', {
  onToolCall: (cb: (ev: {
    name: string;
    args: Record<string, unknown>;
    result: string;
    ok: boolean;
    durationMs: number;
  }) => void) => ipcRenderer.on('tool-call-log', (_e, ev) => cb(ev)),
});
