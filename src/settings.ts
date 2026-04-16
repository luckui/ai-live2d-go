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
  contextWindowRounds: number;
  providers: Record<string, ProviderConfig>;
  /** 用户主动删除的 provider key，用于 loadPersistedConfig 合并时跳过 */
  deletedProviders?: string[];
}

interface DiscordConfig {
  enabled: boolean;
  token: string;
  allowedChannels: string;
  proxyUrl: string;
}

interface WeChatConfig {
  enabled: boolean;
  token?: string;
  accountId?: string;
  baseUrl?: string;
  sendChunkDelay?: number;
}

interface TTSConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
  speaker: string;
  language: string;
}

interface MemoryExportResult {
  success: boolean;
  path?: string;
  error?: string;
}

interface MemoryImportResult {
  success: boolean;
  content?: string;
  error?: string;
}

declare global {
  interface Window {
    settingsAPI?: {
      get(): Promise<RuntimeConfig>;
      save(cfg: RuntimeConfig): Promise<void>;
    };
    discordAPI?: {
      get(): Promise<DiscordConfig>;
      save(cfg: DiscordConfig): Promise<void>;
      getStatus(): Promise<'online' | 'offline'>;
    };
    wechatAPI?: {
      get(): Promise<WeChatConfig>;
      save(cfg: WeChatConfig): Promise<void>;
      getStatus(): Promise<'online' | 'offline'>;
      startQRLogin(): Promise<{ success: boolean; credentials?: any; error?: string }>;
      onQRLoginUpdate(cb: (state: any) => void): void;
    };
    ttsSettingsAPI?: {
      get(): Promise<TTSConfig>;
      save(cfg: TTSConfig): Promise<{ isEnabled: boolean; fileSaved: boolean; debug: Record<string, unknown> }>;
      test(url: string): Promise<{ ok: boolean; status?: number; body?: string; error?: string }>;
    };
    memoryAPI?: {
      export(): Promise<MemoryExportResult>;
      import(): Promise<MemoryImportResult>;
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

// ── Provider Select ─────────────────────────────────────

function renderProviderSelect(): void {
  if (!cfg) return;
  const select = document.getElementById('s-provider-select') as HTMLSelectElement;
  if (!select) return;
  select.innerHTML = '';

  for (const [key, prov] of Object.entries(cfg.providers)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = prov.name || key;
    if (key === cfg.activeProvider) {
      option.textContent += ' (当前使用)';
    }
    if (key === editKey) {
      option.selected = true;
    }
    select.appendChild(option);
  }

  // 监听下拉框变化
  select.onchange = () => {
    syncFormToCfg();
    editKey = select.value;
    renderProviderSelect();
    renderForm();
  };
}

// ── 加载设置到 UI ──────────────────────────────────────

async function loadSettingsUI(): Promise<void> {
  cfg = await window.settingsAPI!.get();
  editKey = cfg.activeProvider;
  (document.getElementById('s-rounds') as HTMLInputElement).value =
    String(cfg.contextWindowRounds);
  renderProviderSelect();
  renderForm();
}

async function loadDiscordUI(): Promise<void> {
  if (!window.discordAPI) return;
  const dc = await window.discordAPI.get();
  (document.getElementById('dc-enabled')  as HTMLInputElement).checked = dc.enabled;
  (document.getElementById('dc-token')    as HTMLInputElement).value   = dc.token;
  (document.getElementById('dc-channels') as HTMLInputElement).value   = dc.allowedChannels;
  (document.getElementById('dc-proxy')    as HTMLInputElement).value   = dc.proxyUrl;
  await refreshDiscordStatus();
}

async function refreshDiscordStatus(): Promise<void> {
  if (!window.discordAPI) return;
  const status = await window.discordAPI.getStatus();
  const dot      = document.getElementById('dc-status-dot')  as HTMLElement;
  const listDot  = document.getElementById('dc-list-dot')    as HTMLElement | null;
  const text     = document.getElementById('dc-status-text') as HTMLElement;
  const cls = status === 'online' ? 's-status-on' : 's-status-off';
  dot.className      = `s-status-dot ${cls}`;
  if (listDot) listDot.className = `s-bridge-dot ${cls}`;
  text.textContent   = status === 'online' ? '已连接' : '未启动';
}

async function saveDiscordSettings(): Promise<void> {
  if (!window.discordAPI) return;
  const cfg: DiscordConfig = {
    enabled:         (document.getElementById('dc-enabled')  as HTMLInputElement).checked,
    token:           (document.getElementById('dc-token')    as HTMLInputElement).value.trim(),
    allowedChannels: (document.getElementById('dc-channels') as HTMLInputElement).value.trim(),
    proxyUrl:        (document.getElementById('dc-proxy')    as HTMLInputElement).value.trim(),
  };
  const btn = document.getElementById('dc-save-btn') as HTMLButtonElement;
  btn.textContent = '保存中…';
  btn.disabled = true;
  try {
    await window.discordAPI.save(cfg);
    btn.textContent = '✓ 已保存';
    // 给 bot 2 秒启动时间再刷新状态
    setTimeout(() => {
      void refreshDiscordStatus();
      btn.textContent = '保存并重启 Bot';
      btn.disabled = false;
    }, 2000);
  } catch (e) {
    btn.textContent = '保存失败';
    setTimeout(() => { btn.textContent = '保存并重启 Bot'; btn.disabled = false; }, 2000);
    console.error('[Discord save]', e);
  }
}

// ── WeChat UI ─────────────────────────────────────────

async function loadWeChatUI(): Promise<void> {
  if (!window.wechatAPI) return;
  const wc = await window.wechatAPI.get();
  (document.getElementById('wc-enabled') as HTMLInputElement).checked = wc.enabled;
  (document.getElementById('wc-chunk-delay') as HTMLInputElement).value = String(wc.sendChunkDelay ?? 0.35);
  
  // 显示账号信息
  if (wc.token && wc.accountId) {
    (document.getElementById('wc-account-id') as HTMLInputElement).value = wc.accountId;
    (document.getElementById('wc-token-preview') as HTMLInputElement).value = wc.token.slice(0, 8) + '***';
    (document.getElementById('wc-account-section') as HTMLElement).style.display = 'block';
    (document.getElementById('wc-qr-section') as HTMLElement).style.display = 'none';
  } else {
    (document.getElementById('wc-account-section') as HTMLElement).style.display = 'none';
    (document.getElementById('wc-qr-section') as HTMLElement).style.display = 'block';
  }
  
  await refreshWeChatStatus();
}

async function refreshWeChatStatus(): Promise<void> {
  if (!window.wechatAPI) return;
  const status = await window.wechatAPI.getStatus();
  const dot      = document.getElementById('wc-status-dot')  as HTMLElement;
  const listDot  = document.getElementById('wc-list-dot')    as HTMLElement | null;
  const text     = document.getElementById('wc-status-text') as HTMLElement;
  const cls = status === 'online' ? 's-status-on' : 's-status-off';
  dot.className      = `s-status-dot ${cls}`;
  if (listDot) listDot.className = `s-bridge-dot ${cls}`;
  text.textContent   = status === 'online' ? '已连接' : '未启动';
}

async function saveWeChatSettings(): Promise<void> {
  if (!window.wechatAPI) return;
  const cfg: WeChatConfig = {
    enabled: (document.getElementById('wc-enabled') as HTMLInputElement).checked,
    sendChunkDelay: parseFloat((document.getElementById('wc-chunk-delay') as HTMLInputElement).value),
  };
  const btn = document.getElementById('wc-save-btn') as HTMLButtonElement;
  btn.textContent = '保存中…';
  btn.disabled = true;
  try {
    await window.wechatAPI.save(cfg);
    btn.textContent = '✓ 已保存';
    setTimeout(() => {
      void refreshWeChatStatus();
      btn.textContent = '保存并重启 Bot';
      btn.disabled = false;
    }, 2000);
  } catch (e) {
    btn.textContent = '保存失败';
    setTimeout(() => { btn.textContent = '保存并重启 Bot'; btn.disabled = false; }, 2000);
    console.error('[WeChat save]', e);
  }
}

async function startWeChatQRLogin(): Promise<void> {
  if (!window.wechatAPI) return;
  
  const btn = document.getElementById('wc-qr-start-btn') as HTMLButtonElement;
  const display = document.getElementById('wc-qr-display') as HTMLElement;
  const statusText = document.getElementById('wc-qr-status') as HTMLElement;
  const img = document.getElementById('wc-qr-img') as HTMLImageElement;
  
  btn.disabled = true;
  btn.textContent = '启动中…';
  display.style.display = 'block';
  statusText.textContent = '正在获取二维码...';
  
  // 监听状态更新
  window.wechatAPI.onQRLoginUpdate((state: any) => {
    console.log('[WeChat QR]', state);
    if (state.qrcodeUrl) {
      img.src = state.qrcodeUrl;
    }
    if (state.status === 'pending') {
      statusText.textContent = '✨ 请使用微信扫描上方二维码';
      statusText.style.color = '#4CAF50';
    } else if (state.status === 'scanned') {
      statusText.textContent = '✅ 已扫码，请在微信里确认授权...';
      statusText.style.color = '#2196F3';
    } else if (state.status === 'confirmed') {
      statusText.textContent = '🎉 登录成功！正在保存凭证...';
      statusText.style.color = '#4CAF50';
      setTimeout(() => {
        void loadWeChatUI(); // 刷新 UI 显示账号信息
        display.style.display = 'none';
        btn.disabled = false;
        btn.textContent = '🔑 启动二维码登录';
      }, 2000);
    } else if (state.status === 'expired') {
      statusText.textContent = `⚠️ 二维码已过期：${state.error || '请重试'}`;
      statusText.style.color = '#FF9800';
      btn.disabled = false;
      btn.textContent = '🔄 重新获取二维码';
    } else if (state.status === 'error') {
      statusText.textContent = `❌ 登录失败：${state.error || '未知错误'}`;
      statusText.style.color = '#F44336';
      btn.disabled = false;
      btn.textContent = '🔄 重试';
    }
  });
  
  // 启动 QR 登录
  try {
    await window.wechatAPI.startQRLogin();
  } catch (err) {
    statusText.textContent = `❌ 启动失败：${err}`;
    statusText.style.color = '#F44336';
    btn.disabled = false;
    btn.textContent = '🔄 重试';
  }
}

// ── TTS UI ────────────────────────────────────────────

async function refreshTTSRuntimeStatus(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ttsAPI = (window as any).ttsAPI as { isEnabled(): Promise<boolean> } | undefined;
  const dot  = document.getElementById('tts-runtime-dot')  as HTMLElement | null;
  const text = document.getElementById('tts-runtime-text') as HTMLElement | null;
  if (!dot || !text) return;
  try {
    const enabled = ttsAPI ? await ttsAPI.isEnabled() : false;
    dot.className   = `s-status-dot ${enabled ? 's-status-on' : 's-status-err'}`;
    text.textContent = enabled
      ? '\u2713 \u5df2\u542f\u7528\uff08\u8bed\u97f3\u5c06\u5728\u56de\u590d\u540e\u81ea\u52a8\u64ad\u653e\uff09'
      : '\u26a0\ufe0f \u672a\u542f\u7528\uff08\u8bf7\u586b\u5199\u8868\u5355\u5e76\u70b9\u201c\u4fdd\u5b58\u8bbe\u7f6e\u201d\uff09';
  } catch {
    dot.className   = 's-status-dot s-status-off';
    text.textContent = '\u65e0\u6cd5\u83b7\u53d6\u72b6\u6001';
  }
}

// ── Memory UI ─────────────────────────────────────────

async function exportMemory(): Promise<void> {
  if (!window.memoryAPI) return;
  const btn = document.getElementById('memory-export-btn') as HTMLButtonElement | null;
  if (!btn) return;
  
  btn.textContent = '导出中…';
  btn.disabled = true;
  
  try {
    const result = await window.memoryAPI.export();
    if (result.success) {
      btn.textContent = '✓ 已导出';
      setTimeout(() => {
        btn.textContent = '📤 导出记忆';
        btn.disabled = false;
      }, 1800);
    } else {
      btn.textContent = '导出失败';
      setTimeout(() => {
        btn.textContent = '📤 导出记忆';
        btn.disabled = false;
      }, 2000);
    }
  } catch (e) {
    console.error('[Memory export]', e);
    btn.textContent = '导出失败';
    setTimeout(() => {
      btn.textContent = '📤 导出记忆';
      btn.disabled = false;
    }, 2000);
  }
}

async function importMemory(): Promise<void> {
  if (!window.memoryAPI) return;
  const btn = document.getElementById('memory-import-btn') as HTMLButtonElement | null;
  if (!btn) return;
  
  btn.textContent = '导入中…';
  btn.disabled = true;
  
  try {
    const result = await window.memoryAPI.import();
    if (result.success) {
      btn.textContent = '✓ 已导入';
      setTimeout(() => {
        btn.textContent = '📥 导入记忆';
        btn.disabled = false;
      }, 1800);
    } else {
      btn.textContent = '导入失败';
      setTimeout(() => {
        btn.textContent = '📥 导入记忆';
        btn.disabled = false;
      }, 2000);
    }
  } catch (e) {
    console.error('[Memory import]', e);
    btn.textContent = '导入失败';
    setTimeout(() => {
      btn.textContent = '📥 导入记忆';
      btn.disabled = false;
    }, 2000);
  }
}

async function loadTTSUI(): Promise<void> {
  if (!window.ttsSettingsAPI) return;
  const tts = await window.ttsSettingsAPI.get();
  (document.getElementById('tts-enabled')  as HTMLInputElement).checked  = tts.enabled;
  (document.getElementById('tts-url')      as HTMLInputElement).value    = tts.url;
  (document.getElementById('tts-apikey')   as HTMLInputElement).value    = tts.apiKey;
  (document.getElementById('tts-speaker')  as HTMLInputElement).value    = tts.speaker;
  (document.getElementById('tts-language') as HTMLSelectElement).value   = tts.language;
  void refreshTTSRuntimeStatus();
}

async function saveTTSSettings(): Promise<void> {
  if (!window.ttsSettingsAPI) return;
  const ttsCfg: TTSConfig = {
    enabled:  (document.getElementById('tts-enabled')  as HTMLInputElement).checked,
    url:      (document.getElementById('tts-url')      as HTMLInputElement).value.trim(),
    apiKey:   (document.getElementById('tts-apikey')   as HTMLInputElement).value.trim(),
    speaker:  (document.getElementById('tts-speaker')  as HTMLInputElement).value.trim(),
    language: (document.getElementById('tts-language') as HTMLSelectElement).value,
  };
  const btn = document.getElementById('tts-save-btn') as HTMLButtonElement;
  btn.textContent = '保存中…';
  btn.disabled = true;
  try {
    await window.ttsSettingsAPI.save(ttsCfg);
    btn.textContent = '✓ 已保存';
    void refreshTTSRuntimeStatus(); // 刷新运行时状态确认生效
    setTimeout(() => { btn.textContent = '保存设置'; btn.disabled = false; }, 1800);
  } catch (e) {
    btn.textContent = '保存失败';
    setTimeout(() => { btn.textContent = '保存设置'; btn.disabled = false; }, 2000);
    console.error('[TTS save]', e);
  }
}

async function runTTSHealthCheck(): Promise<void> {
  if (!window.ttsSettingsAPI) return;
  const url  = (document.getElementById('tts-url') as HTMLInputElement).value.trim();
  const dot  = document.getElementById('tts-status-dot')  as HTMLElement;
  const text = document.getElementById('tts-status-text') as HTMLElement;
  const btn  = document.getElementById('tts-test-btn')    as HTMLButtonElement;

  btn.disabled = true;
  btn.textContent = '测试中…';
  dot.className = 's-status-dot s-status-off';
  text.textContent = '连接中…';

  try {
    const result = await window.ttsSettingsAPI.test(url);
    if (result.ok) {
      dot.className = 's-status-dot s-status-on';
      text.textContent = `✓ 连接成功（HTTP ${result.status}）`;
    } else {
      dot.className = 's-status-dot s-status-err';
      text.textContent = result.error ?? `✗ HTTP ${result.status}`;
    }
  } catch (e) {
    dot.className = 's-status-dot s-status-err';
    text.textContent = `✗ ${String(e)}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 测试连接';
  }
}

// ── 保存（LLM） ────────────────────────────────────────

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

  renderProviderSelect(); // 刷新 active 标记
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
  renderProviderSelect();
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
  renderProviderSelect();
  renderForm();
  // 立即持久化，不依赖用户手动点保存
  void saveSettings();
}

// ── 设为当前 ──────────────────────────────────────────

function setActiveProvider(): void {
  if (!cfg || !editKey) return;
  syncFormToCfg();
  cfg.activeProvider = editKey;
  renderProviderSelect();
  renderForm();
}

// ── 面板开关 ──────────────────────────────────────────

export function openSettings(): void {
  savedWindowHeight = window.innerHeight;
  // 打开设置时确保窗口足够高（620px）以显示完整表单
  if (savedWindowHeight < 620) {
    window.electronAPI?.resizeWindow(620);
  }
  // 暂停 canvas 区域的 Electron 拖拽捕获，否则设置面板上半部分点击会被 OS 拦截
  document.getElementById('canvas-container')?.classList.add('drag-region-suspended');
  document.getElementById('settings-panel')?.classList.add('visible');
  void loadSettingsUI();
  void loadDiscordUI();
  void loadWeChatUI();
  void loadTTSUI();
}

export function closeSettings(): void {
  document.getElementById('settings-panel')?.classList.remove('visible');
  // 恢复 canvas 区域的拖拽功能
  document.getElementById('canvas-container')?.classList.remove('drag-region-suspended');
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

  // 记忆导出/导入
  document.getElementById('memory-export-btn')?.addEventListener('click', () => void exportMemory());
  document.getElementById('memory-import-btn')?.addEventListener('click', () => void importMemory());

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

  // ── 选项卡切换 ───────────────────────────────────────
  document.querySelectorAll<HTMLButtonElement>('.s-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      const target = tabBtn.dataset['tab'];
      document.querySelectorAll<HTMLButtonElement>('.s-tab').forEach((b) =>
        b.classList.toggle('s-tab-active', b === tabBtn)
      );
      document.querySelectorAll<HTMLElement>('.s-tab-pane').forEach((pane) => {
        const match = pane.id === `s-tab-${target}`;
        pane.classList.toggle('s-tab-pane-hidden', !match);
      });
    });
  });

  // ── 平台列表左侧切换 ──────────────────────────────
  document.querySelectorAll<HTMLElement>('.s-bridge-item').forEach((item) => {
    item.addEventListener('click', () => {
      const bridge = item.dataset['bridge'];
      // 切换激活项
      document.querySelectorAll<HTMLElement>('.s-bridge-item').forEach((el) =>
        el.classList.toggle('s-bridge-active', el === item)
      );
      // 切换详情面板
      document.querySelectorAll<HTMLElement>('.s-bridge-pane').forEach((pane) =>
        pane.classList.toggle('s-bridge-pane-hidden', pane.id !== `s-bridge-${bridge}`)
      );
    });
  });

  // ── Discord 表单事件 ─────────────────────────────────
  document.getElementById('dc-save-btn')?.addEventListener('click', () => void saveDiscordSettings());

  document.getElementById('dc-eye-btn')?.addEventListener('click', () => {
    const input = document.getElementById('dc-token') as HTMLInputElement;
    const btn   = document.getElementById('dc-eye-btn') as HTMLButtonElement;
    if (input.type === 'password') { input.type = 'text';     btn.textContent = '🙈'; }
    else                           { input.type = 'password'; btn.textContent = '👁'; }
  });

  // ── WeChat 表单事件 ──────────────────────────────────
  document.getElementById('wc-save-btn')?.addEventListener('click', () => void saveWeChatSettings());
  document.getElementById('wc-qr-start-btn')?.addEventListener('click', () => void startWeChatQRLogin());
  // ── TTS 表单事件 ─────────────────────────────────────
  document.getElementById('tts-save-btn')?.addEventListener('click', () => void saveTTSSettings());
  document.getElementById('tts-test-btn')?.addEventListener('click', () => void runTTSHealthCheck());

  document.getElementById('tts-eye-btn')?.addEventListener('click', () => {
    const input = document.getElementById('tts-apikey') as HTMLInputElement;
    const btn   = document.getElementById('tts-eye-btn') as HTMLButtonElement;
    if (input.type === 'password') { input.type = 'text';     btn.textContent = '\uD83D\uDE48'; }
    else                           { input.type = 'password'; btn.textContent = '\uD83D\uDC41'; }
  });
  // 防止面板内所有输入触发窗口拖动
  document.querySelectorAll('#settings-panel input, #settings-panel textarea').forEach((el) => {
    el.addEventListener('mousedown', (e) => e.stopPropagation());
  });
}
