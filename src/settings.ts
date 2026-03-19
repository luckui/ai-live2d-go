// =====================================================
// LLM 服务商设置面板
// =====================================================

interface ProviderConfig {
  type: 'openai-compatible';
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

interface RuntimeConfig {
  activeProvider: string;
  agentMode?: 'off' | 'force';
  contextWindowRounds: number;
  providers: Record<string, ProviderConfig>;
  /** 用户主动删除的 provider key，用于 loadPersistedConfig 合并时跳过 */
  deletedProviders?: string[];
}

declare global {
  interface Window {
    settingsAPI?: {
      get(): Promise<RuntimeConfig>;
      save(cfg: RuntimeConfig): Promise<void>;
    };
  }
}

// ── 状态 ──────────────────────────────────────────────

let cfg: RuntimeConfig | null = null;
/** 当前表单正在编辑的 provider key */
let editKey: string | null = null;
/** 打开设置前的窗口高度，关闭时恢复 */
let savedWindowHeight = 0;

// ── 表单 ↔ 内存同步 ───────────────────────────────────

function syncFormToCfg(): void {
  if (!cfg || !editKey || !cfg.providers[editKey]) return;
  const p = cfg.providers[editKey];
  p.name       = (document.getElementById('s-name')     as HTMLInputElement).value.trim() || p.name;
  p.baseUrl    = (document.getElementById('s-baseUrl')  as HTMLInputElement).value.trim();
  p.apiKey     = (document.getElementById('s-apiKey')   as HTMLInputElement).value.trim();
  p.model      = (document.getElementById('s-model')    as HTMLInputElement).value.trim();
  p.temperature =
    parseFloat((document.getElementById('s-temp')   as HTMLInputElement).value) || 0.85;
  p.maxTokens  =
    parseInt((document.getElementById('s-tokens') as HTMLInputElement).value, 10) || 1024;
  p.systemPrompt = (document.getElementById('s-sysprompt') as HTMLTextAreaElement).value;

  const rounds = parseInt((document.getElementById('s-rounds') as HTMLInputElement).value, 10);
  if (rounds > 0) cfg.contextWindowRounds = rounds;

  const mode = (document.getElementById('s-agent-mode') as HTMLSelectElement).value;
  cfg.agentMode = mode === 'force' ? 'force' : 'off';
}

function renderForm(): void {
  if (!cfg || !editKey) return;
  const p = cfg.providers[editKey];
  if (!p) return;

  (document.getElementById('s-name')      as HTMLInputElement).value  = p.name      ?? '';
  (document.getElementById('s-baseUrl')   as HTMLInputElement).value  = p.baseUrl   ?? '';
  (document.getElementById('s-apiKey')    as HTMLInputElement).value  = p.apiKey    ?? '';
  (document.getElementById('s-model')     as HTMLInputElement).value  = p.model     ?? '';
  (document.getElementById('s-temp')      as HTMLInputElement).value  = String(p.temperature ?? 0.85);
  (document.getElementById('s-tokens')    as HTMLInputElement).value  = String(p.maxTokens  ?? 1024);
  (document.getElementById('s-sysprompt') as HTMLTextAreaElement).value = p.systemPrompt ?? '';

  // "设为当前" 按钮状态
  const activeBtn = document.getElementById('s-set-active-btn') as HTMLButtonElement;
  if (editKey === cfg.activeProvider) {
    activeBtn.textContent = '✓ 当前使用中';
    activeBtn.classList.add('active');
    activeBtn.disabled = true;
  } else {
    activeBtn.textContent = '设为当前';
    activeBtn.classList.remove('active');
    activeBtn.disabled = false;
  }

  // 只有一个 provider 时隐藏删除按钮
  const delBtn = document.getElementById('s-del-btn') as HTMLButtonElement;
  delBtn.style.visibility = Object.keys(cfg.providers).length <= 1 ? 'hidden' : 'visible';
}

// ── Provider Pills ─────────────────────────────────────

function renderPills(): void {
  if (!cfg) return;
  const container = document.getElementById('s-provider-pills');
  if (!container) return;
  container.innerHTML = '';

  for (const [key, prov] of Object.entries(cfg.providers)) {
    const pill = document.createElement('button');
    pill.className = 's-pill';
    if (key === editKey) pill.classList.add('s-pill-selected');
    if (key === cfg.activeProvider) pill.classList.add('s-pill-active');
    pill.textContent = prov.name || key;
    pill.title = key === cfg.activeProvider ? '当前使用中' : '点击编辑';
    pill.addEventListener('click', () => {
      syncFormToCfg();
      editKey = key;
      renderPills();
      renderForm();
    });
    container.appendChild(pill);
  }
}

// ── 加载设置到 UI ──────────────────────────────────────

async function loadSettingsUI(): Promise<void> {
  cfg = await window.settingsAPI!.get();
  editKey = cfg.activeProvider;
  (document.getElementById('s-rounds') as HTMLInputElement).value =
    String(cfg.contextWindowRounds);
  (document.getElementById('s-agent-mode') as HTMLSelectElement).value = cfg.agentMode ?? 'off';
  renderPills();
  renderForm();
}

// ── 保存 ──────────────────────────────────────────────

async function saveSettings(): Promise<void> {
  if (!cfg) return;
  syncFormToCfg();
  await window.settingsAPI!.save(cfg);

  const btn = document.getElementById('settings-save-btn') as HTMLButtonElement;
  btn.textContent = '✓ 已保存';
  btn.classList.add('saved');
  setTimeout(() => {
    btn.textContent = '保存设置';
    btn.classList.remove('saved');
  }, 1800);

  renderPills(); // 刷新 active 标记
}

// ── 新增 Provider ──────────────────────────────────────

function addProvider(): void {
  if (!cfg) return;
  syncFormToCfg();
  const key = `provider_${Date.now()}`;
  cfg.providers[key] = {
    type: 'openai-compatible',
    name: '新服务商',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.85,
    maxTokens: 1024,
    systemPrompt: '',
  };
  editKey = key;
  renderPills();
  renderForm();
  // 滚动到表单
  document.getElementById('s-form-section')?.scrollIntoView({ behavior: 'smooth' });
}

// ── 删除 Provider ──────────────────────────────────────

function deleteProvider(): void {
  if (!cfg || !editKey || Object.keys(cfg.providers).length <= 1) return;
  if (editKey === cfg.activeProvider) {
    const remaining = Object.keys(cfg.providers).filter((k) => k !== editKey);
    cfg.activeProvider = remaining[0];
  }
  // 记录删除，保证重启后代码默认 provider 里同名的不会被重新补入
  cfg.deletedProviders = [...(cfg.deletedProviders ?? []), editKey];
  delete cfg.providers[editKey];
  editKey = cfg.activeProvider;
  renderPills();
  renderForm();
  // 立即持久化，不依赖用户手动点保存
  void saveSettings();
}

// ── 设为当前 ──────────────────────────────────────────

function setActiveProvider(): void {
  if (!cfg || !editKey) return;
  syncFormToCfg();
  cfg.activeProvider = editKey;
  renderPills();
  renderForm();
}

// ── 面板开关 ──────────────────────────────────────────

export function openSettings(): void {
  savedWindowHeight = window.innerHeight;
  // 打开设置时确保窗口足够高（620px）以显示完整表单
  if (savedWindowHeight < 620) {
    window.electronAPI?.resizeWindow(620);
  }
  document.getElementById('settings-panel')?.classList.add('visible');
  loadSettingsUI();
}

export function closeSettings(): void {
  document.getElementById('settings-panel')?.classList.remove('visible');
  // 恢复原始窗口高度
  if (savedWindowHeight > 0 && savedWindowHeight < 620) {
    window.electronAPI?.resizeWindow(savedWindowHeight);
  }
  savedWindowHeight = 0;
}

// ── 初始化入口 ────────────────────────────────────────

export function initSettings(): void {
  // 设置面板触发按钮
  document.getElementById('settings-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openSettings();
  });

  // 返回按钮
  document.getElementById('settings-back')?.addEventListener('click', closeSettings);

  // 新增 provider
  document.getElementById('s-add-btn')?.addEventListener('click', addProvider);

  // 删除 provider
  document.getElementById('s-del-btn')?.addEventListener('click', deleteProvider);

  // 设为当前
  document.getElementById('s-set-active-btn')?.addEventListener('click', setActiveProvider);

  // 保存
  document.getElementById('settings-save-btn')?.addEventListener('click', saveSettings);

  // API Key 显示/隐藏
  document.getElementById('s-eye-btn')?.addEventListener('click', () => {
    const input = document.getElementById('s-apiKey') as HTMLInputElement;
    const btn = document.getElementById('s-eye-btn') as HTMLButtonElement;
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '🙈';
    } else {
      input.type = 'password';
      btn.textContent = '👁';
    }
  });

  // 防止面板内所有输入触发窗口拖动
  document.querySelectorAll('#settings-panel input, #settings-panel textarea').forEach((el) => {
    el.addEventListener('mousedown', (e) => e.stopPropagation());
  });
}
