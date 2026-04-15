// =====================================================
// 类型声明
// =====================================================

import { playTTS } from './ttsPlayer';

console.log('[Chat] module loaded ✅ (带TTS版本)');

interface Conversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  preview: string;
}

interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: number;
}

declare global {
  interface Window {
    electronAPI?: {
      dragWindow: (dx: number, dy: number) => void;
      closeWindow: () => void;
      resizeWindow: (height: number) => void;
      togglePin: () => void;
      onPinState: (cb: (pinned: boolean) => void) => void;
    };
    chatAPI?: {
      createConversation(): Promise<Conversation>;
      listConversations(): Promise<Conversation[]>;
      loadConversation(id: string): Promise<ChatMessage[]>;
      deleteConversation(id: string): Promise<void>;
      renameConversation(id: string, title: string): Promise<void>;
      send(conversationId: string, content: string): Promise<{ content: string; created_at: number }>;
    };
    appLifecycleAPI?: {
      onQuitting(cb: () => void): void;
      onQuitReady(cb: () => void): void;
    };
    debugAPI?: {
      onToolCall(cb: (ev: {
        name: string;
        args: Record<string, unknown>;
        result: string;
        ok: boolean;
        durationMs: number;
      }) => void): void;
    };
    ttsAPI?: {
      isEnabled(): Promise<boolean>;
      speak(text: string): Promise<{ data: string } | null>;
    };
  }
}

// =====================================================
// 状态
// =====================================================

let currentConversationId: string | null = null;
let isConvPanelOpen = false;
let isSending = false;

// =====================================================
// 工具函数
// =====================================================

function formatTime(ts?: number): string {
  const d = ts ? new Date(ts) : new Date();
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function scrollToBottom(): void {
  const container = document.getElementById('messages-container');
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}

// =====================================================
// 消息渲染
// =====================================================

function addMessage(
  type: 'ai' | 'user',
  content: string,
  animate = true,
  ts?: number
): void {
  const messagesDiv = document.getElementById('messages');
  if (!messagesDiv) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${type === 'ai' ? 'ai-message' : 'user-message'}`;

  if (type === 'ai') {
    msgDiv.innerHTML = `
      <div class="message-avatar">🌸</div>
      <div class="message-bubble">
        <p>${escapeHtml(content)}</p>
        <span class="message-time">${formatTime(ts)}</span>
      </div>`;
  } else {
    msgDiv.innerHTML = `
      <div class="message-bubble">
        <p>${escapeHtml(content)}</p>
        <span class="message-time">${formatTime(ts)}</span>
      </div>`;
  }

  messagesDiv.appendChild(msgDiv);

  if (animate) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        msgDiv.classList.add('visible');
      });
    });
  } else {
    msgDiv.classList.add('visible');
  }

  scrollToBottom();
}

function addTypingIndicator(): HTMLElement | null {
  const messagesDiv = document.getElementById('messages');
  if (!messagesDiv) return null;

  const typing = document.createElement('div');
  typing.className = 'message ai-message typing-indicator';
  typing.innerHTML = `
    <div class="message-avatar">🌸</div>
    <div class="message-bubble">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>`;
  messagesDiv.appendChild(typing);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      typing.classList.add('visible');
    });
  });

  scrollToBottom();
  return typing;
}

// =====================================================
// 工具调用调试气泡
// =====================================================

function addToolCallBubble(ev: {
  name: string;
  args: Record<string, unknown>;
  result: string;
  ok: boolean;
  durationMs: number;
  conversationId?: string;  // 🆕 工具调用来源对话ID
}): void {
  const messagesDiv = document.getElementById('messages');
  if (!messagesDiv) return;

  // 🆕 如果工具调用来自其他对话，显示警告标签
  const isOtherConv = ev.conversationId && ev.conversationId !== currentConversationId;
  const convTag = isOtherConv ? `<span style="color:#ff6b6b; font-size:10px;">[其他对话]</span> ` : '';

  const icon   = ev.ok ? '✅' : ev.result.startsWith('⏸️') ? '⏸️' : '❌';
  const status = ev.ok ? 'ok' : ev.result.startsWith('⏸️') ? 'pause' : 'err';

  // 精简参数展示：只展示值，不要键名嵌套
  let argsText = '';
  try {
    const vals = Object.values(ev.args);
    argsText = vals.length ? vals.map(v => JSON.stringify(v)).join(', ') : '（无参数）';
  } catch {
    argsText = JSON.stringify(ev.args);
  }

  const bubble = document.createElement('div');
  bubble.className = 'tool-call-bubble';
  bubble.innerHTML = `
    <details>
      <summary>
        <span class="tc-icon">${icon}</span>
        <span class="tc-name">${convTag}${escapeHtml(ev.name)}</span>
        <span class="tc-args">${escapeHtml(argsText.slice(0, 60))}${argsText.length > 60 ? '…' : ''}</span>
        <span class="tc-duration tc-${status}">${ev.durationMs}ms</span>
      </summary>
      <div class="tc-detail">
        <div class="tc-row"><span class="tc-label">参数</span><span class="tc-val">${escapeHtml(JSON.stringify(ev.args, null, 2))}</span></div>
        <div class="tc-row"><span class="tc-label">结果</span><span class="tc-val">${escapeHtml(ev.result)}</span></div>
      </div>
    </details>`;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => bubble.classList.add('visible'));
  });

  messagesDiv.appendChild(bubble);
  scrollToBottom();
}

// =====================================================
// 发送消息
// =====================================================

async function sendMessage(): Promise<void> {
  if (isSending || !currentConversationId) return;

  const input = document.getElementById('message-input') as HTMLInputElement;
  const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
  const text = input?.value.trim();
  if (!text) return;

  input.value = '';
  isSending = true;
  if (sendBtn) sendBtn.disabled = true;

  addMessage('user', text);
  const typing = addTypingIndicator();

  try {
    const result = await window.chatAPI!.send(currentConversationId, text);
    typing?.remove();
    addMessage('ai', result.content, true, result.created_at);
    // TTS 播放（未启用时静默跳过）
    console.log('[Chat] 准备调用 playTTS, 文本长度:', result.content.length);
    playTTS(result.content).catch((e) => console.error('[TTS] playTTS 抛出异常:', e));
    // 首轮发送后 AI 服务会自动重命名对话，刷新 header 标题
    await refreshConvTitle(currentConversationId);
  } catch (e) {
    typing?.remove();
    addMessage('ai', `（出错了：${(e as Error).message}）`);
  } finally {
    isSending = false;
    if (sendBtn) sendBtn.disabled = false;
    input?.focus();
  }
}

// =====================================================
// 对话管理
// =====================================================

async function refreshConvTitle(conversationId: string): Promise<void> {
  const convs = await window.chatAPI!.listConversations();
  const conv = convs.find((c) => c.id === conversationId);
  if (!conv) return;

  const statusEl = document.getElementById('chat-conv-title');
  if (statusEl) {
    statusEl.textContent = conv.title === '新对话' ? '在线' : conv.title;
  }
}

async function switchConversation(id: string): Promise<void> {
  currentConversationId = id;

  const messagesDiv = document.getElementById('messages');
  if (messagesDiv) messagesDiv.innerHTML = '';

  const msgs = await window.chatAPI!.loadConversation(id);
  for (const msg of msgs) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      addMessage(msg.role === 'user' ? 'user' : 'ai', msg.content, false, msg.created_at);
    }
  }

  if (msgs.length === 0) {
    addMessage('ai', '你好~！我是 Hiyori，很高兴认识你！✨', true);
  }

  scrollToBottom();
  await refreshConvTitle(id);
  closeConvPanel();
}

async function createNewConversation(): Promise<void> {
  const conv = await window.chatAPI!.createConversation();
  await switchConversation(conv.id);
}

async function deleteConversationById(id: string): Promise<void> {
  await window.chatAPI!.deleteConversation(id);

  if (id === currentConversationId) {
    const remaining = await window.chatAPI!.listConversations();
    if (remaining.length > 0) {
      await switchConversation(remaining[0].id);
    } else {
      await createNewConversation();
    }
  } else {
    await renderConvList();
  }
}

// =====================================================
// 对话列表面板
// =====================================================

async function renderConvList(): Promise<void> {
  const listEl = document.getElementById('conv-list');
  if (!listEl) return;

  const convs = await window.chatAPI!.listConversations();

  if (convs.length === 0) {
    listEl.innerHTML = '<div class="conv-empty">暂无历史对话</div>';
    return;
  }

  listEl.innerHTML = '';
  for (const conv of convs) {
    const item = document.createElement('div');
    item.className = `conv-item${conv.id === currentConversationId ? ' active' : ''}`;
    item.dataset['id'] = conv.id;

    const preview = conv.preview
      ? conv.preview.length > 32
        ? conv.preview.slice(0, 32) + '…'
        : conv.preview
      : '（空对话）';

    item.innerHTML = `
      <div class="conv-item-main">
        <span class="conv-item-title">${escapeHtml(conv.title)}</span>
        <span class="conv-item-time">${formatTime(conv.updated_at)}</span>
      </div>
      <div class="conv-item-preview">${escapeHtml(preview)}</div>
      <button class="conv-item-delete no-drag" title="删除" data-id="${conv.id}">×</button>
    `;

    item.addEventListener('click', async (e) => {
      if ((e.target as HTMLElement).classList.contains('conv-item-delete')) return;
      await switchConversation(conv.id);
    });

    const delBtn = item.querySelector('.conv-item-delete') as HTMLButtonElement;
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteConversationById(conv.id);
    });

    listEl.appendChild(item);
  }
}

function openConvPanel(): void {
  isConvPanelOpen = true;
  document.getElementById('conv-panel')?.classList.add('visible');
  document.getElementById('sessions-btn')?.classList.add('active');
  renderConvList();
}

function closeConvPanel(): void {
  isConvPanelOpen = false;
  document.getElementById('conv-panel')?.classList.remove('visible');
  document.getElementById('sessions-btn')?.classList.remove('active');
}

function toggleConvPanel(): void {
  isConvPanelOpen ? closeConvPanel() : openConvPanel();
}

// =====================================================
// 折叠/展开
// =====================================================

function updateChatLayout(isExpanded: boolean): void {
  const chatBody = document.getElementById('chat-body');
  const toggleIcon = document.getElementById('toggle-icon');
  if (!chatBody || !toggleIcon) return;

  if (isExpanded) {
    chatBody.classList.remove('collapsed');
    toggleIcon.textContent = '▾';
  } else {
    chatBody.classList.add('collapsed');
    toggleIcon.textContent = '▴';
    closeConvPanel();
  }

  const headerH = document.getElementById('chat-header')?.offsetHeight ?? 50;
  const bodyH = isExpanded ? 220 : 0;
  window.electronAPI?.resizeWindow(360 + headerH + bodyH);
}

// =====================================================
// 窗口拖动
// =====================================================

function setupWindowDrag(): void {
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let startX = 0;
  let startY = 0;

  const canvasContainer = document.getElementById('canvas-container');

  canvasContainer?.addEventListener('mousedown', (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.no-drag')) return;
    if (e.button !== 0) return;
    // 不调 preventDefault，否则会干扰 Live2D 的 pointer 事件链
    isDragging = false; // 先不设为 true，等实际移动后才设
    lastX = e.screenX;
    lastY = e.screenY;
    startX = e.screenX;
    startY = e.screenY;
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (lastX === 0 && lastY === 0) return;
    const moved = Math.abs(e.screenX - startX) + Math.abs(e.screenY - startY);
    if (!isDragging && moved > 4) {
      // 移动超过 4px 才认为拖拽，不是点击
      isDragging = true;
    }
    if (!isDragging) return;
    window.electronAPI?.dragWindow(e.screenX - lastX, e.screenY - lastY);
    lastX = e.screenX;
    lastY = e.screenY;
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    lastX = 0;
    lastY = 0;
  });
}

// =====================================================
// 初始化入口
// =====================================================

export async function initChat(): Promise<void> {
  setupWindowDrag();

  // 折叠/展开
  let isExpanded = true;
  document.getElementById('toggle-chat-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    isExpanded = !isExpanded;
    updateChatLayout(isExpanded);
  });

  // 关闭窗口
  document.getElementById('close-btn')?.addEventListener('click', () => {
    window.electronAPI?.closeWindow();
  });

  // 对话列表面板
  document.getElementById('sessions-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleConvPanel();
  });

  // Agent 模式切换器
  let isAgentMode = true; // 默认 Agent 模式
  const agentModeBtn = document.getElementById('agent-mode-btn');
  const agentModeText = document.getElementById('agent-mode-text');
  
  // 更新 UI 的通用函数
  function updateAgentModeUI(mode: string) {
    const isAgent = mode === 'agent' || mode === 'agent-debug';
    isAgentMode = isAgent;
    
    if (agentModeText) {
      if (mode === 'agent-debug') {
        agentModeText.textContent = 'Debug';
      } else {
        agentModeText.textContent = isAgent ? 'Agent' : 'Chat';
      }
    }
    
    if (agentModeBtn) {
      if (isAgent) {
        agentModeBtn.classList.add('active');
      } else {
        agentModeBtn.classList.remove('active');
      }
    }
  }
  
  // 初始化显示为 Agent 模式
  updateAgentModeUI('agent');

  // 用户点击按钮切换
  agentModeBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const newMode = isAgentMode ? 'chat' : 'agent';
    
    // 发送 IPC 切换模式
    await (window as any).agentAPI?.setMode(newMode);
    console.log(`[Agent Mode] 用户切换到 ${newMode.toUpperCase()} 模式`);
    
    // 更新 UI
    updateAgentModeUI(newMode);
  });

  // 监听 AI 主动切换模式
  (window as any).agentAPI?.onModeChanged((mode: string) => {
    console.log(`[Agent Mode] AI 切换到 ${mode.toUpperCase()} 模式`);
    updateAgentModeUI(mode);
  });

  // 监听 AI 主动切换模式
  (window as any).agentAPI?.onModeChanged((mode: string) => {
    console.log(`[Agent Mode] AI 切换到 ${mode.toUpperCase()} 模式`);
    updateAgentModeUI(mode);
  });

  // 新建对话（header 按钮）
  document.getElementById('new-chat-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    createNewConversation();
  });

  // 新建对话（conv-panel 内按钮）
  document.getElementById('conv-new-btn')?.addEventListener('click', () => {
    createNewConversation();
  });

  // 发送消息
  document.getElementById('send-btn')?.addEventListener('click', () => sendMessage());

  const input = document.getElementById('message-input') as HTMLInputElement;
  input?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  input?.addEventListener('mousedown', (e) => e.stopPropagation());

  // 加载或创建初始对话
  const convs = await window.chatAPI!.listConversations();
  if (convs.length > 0) {
    // 优先加载有消息的对话，避免启动时显示空白对话
    const convWithMessages = convs.find(c => c.preview && c.preview.trim() !== '');
    await switchConversation((convWithMessages || convs[0]).id);
  } else {
    const conv = await window.chatAPI!.createConversation();
    await switchConversation(conv.id);
  }

  // ── 退出保存遮罩 ──────────────────────────────────────────
  const quitOverlay = document.getElementById('quit-overlay');
  window.appLifecycleAPI?.onQuitting(() => {
    quitOverlay?.classList.add('visible');
  });
  window.appLifecycleAPI?.onQuitReady(() => {
    // 短暂显示"完成"后窗口即关闭，给用户一个积极的视觉收尾
    const title = quitOverlay?.querySelector('.quit-title');
    const hint  = quitOverlay?.querySelector('.quit-hint');
    if (title) (title as HTMLElement).textContent = '记忆已保存 ✓';
    if (hint)  (hint  as HTMLElement).textContent  = '再见，下次见到你要更厉害哦 ✨';
  });

  // ── 工具调用调试气泡：实时展示 AI 正在调用哪些工具 ──────────
  window.debugAPI?.onToolCall((ev) => addToolCallBubble(ev));
}


