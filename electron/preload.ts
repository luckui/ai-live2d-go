import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  dragWindow: (deltaX: number, deltaY: number) =>
    ipcRenderer.send('window-drag', { deltaX, deltaY }),
  closeWindow: () => ipcRenderer.send('window-close'),
  resizeWindow: (height: number) => ipcRenderer.send('window-resize', { height }),
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

/** 应用退出相关事件 */
contextBridge.exposeInMainWorld('appLifecycleAPI', {
  /** 开始退出流水线时触发（正在保存记忆） */
  onQuitting: (cb: () => void) =>
    ipcRenderer.on('app:quitting', () => cb()),
  /** 流水线完成、即将关闭时触发 */
  onQuitReady: (cb: () => void) =>
    ipcRenderer.on('app:quit-ready', () => cb()),
});
