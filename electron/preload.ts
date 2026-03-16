import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  dragWindow: (deltaX: number, deltaY: number) =>
    ipcRenderer.send('window-drag', { deltaX, deltaY }),
  closeWindow: () => ipcRenderer.send('window-close'),
  resizeWindow: (height: number) => ipcRenderer.send('window-resize', { height }),
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
