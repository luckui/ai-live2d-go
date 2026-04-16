/// <reference types="node" />
/**
 * TTS 服务模块（主进程）
 *
 * 统一适配器：任何符合 POST /tts/generate 规范的 HTTP TTS 服务均可接入，
 * 无论是远程服务器、本地 tts-server、还是第三方 API，只要 URL 对就行。
 *
 * 环境变量（.env）：
 *   TTS_ENABLED=true
 *   TTS_URL=http://127.0.0.1:9880    ← 任意 TTS 服务地址（本地或远程皆可）
 *   TTS_SPEAKER=xiaoxiao              ← 音色名称
 *   TTS_LANGUAGE=Auto                 ← 可选，默认 Auto
 *   TTS_API_KEY=<key>                 ← 可选，Bearer Token 认证
 */

// ── 接口定义 ────────────────────────────────────────────────────────

export interface TTSAdapter {
  readonly name: string;
  speak(text: string, config: TTSAdapterConfig): Promise<ArrayBuffer>;
}

export interface TTSAdapterConfig {
  speaker: string;
  language: string;
}

// ── 统一 HTTP TTS 适配器 ────────────────────────────────────────────
// 规范：POST /tts/generate  body: { text, speaker, language }  → 音频流
//       GET  /health                                            → 健康检查

class HttpTTSAdapter implements TTSAdapter {
  readonly name: string;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string = '',
  ) {
    // 用 URL 来标识，方便调试
    this.name = `http-tts(${baseUrl})`;
  }

  async speak(text: string, config: TTSAdapterConfig): Promise<ArrayBuffer> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const resp = await fetch(`${this.baseUrl}/tts/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text,
        speaker:  config.speaker,
        language: config.language,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`TTS ${resp.status} [${this.baseUrl}]: ${errText.slice(0, 200)}`);
    }

    return resp.arrayBuffer();
  }
}

// ── TTS 服务单例 ────────────────────────────────────────────────────

class TTSService {
  private _ready = false;
  private _adapter: TTSAdapter | null = null;
  private _config: TTSAdapterConfig = { speaker: '', language: 'Auto' };

  private _init(): void {
    if (this._ready) return;
    this._ready = true;

    const enabled  = process.env['TTS_ENABLED']  === 'true';
    const url      = (process.env['TTS_URL']     ?? '').replace(/\/$/, '');
    const speaker  = process.env['TTS_SPEAKER']  ?? '';
    const language = process.env['TTS_LANGUAGE'] ?? 'Auto';
    const apiKey   = process.env['TTS_API_KEY']  ?? '';

    this._config = { speaker, language };

    if (enabled && url) {
      this._adapter = new HttpTTSAdapter(url, apiKey);
      console.info(`[TTS] 已启用: url=${url} speaker=${speaker || '(default)'}`);
    } else {
      this._adapter = null;
      if (enabled) {
        console.warn('[TTS] TTS_ENABLED=true 但 TTS_URL 未配置');
      }
    }
  }

  reset(): void {
    this._ready   = false;
    this._adapter = null;
  }

  get isEnabled(): boolean {
    this._init();
    return this._adapter !== null;
  }

  debugInfo() {
    return {
      TTS_ENABLED:  process.env['TTS_ENABLED'],
      TTS_URL:      process.env['TTS_URL'],
      TTS_SPEAKER:  process.env['TTS_SPEAKER'],
      TTS_LANGUAGE: process.env['TTS_LANGUAGE'],
      TTS_API_KEY:  process.env['TTS_API_KEY'] ? '***' : '(empty)',
      isEnabled:    this.isEnabled,
    };
  }

  async speak(text: string): Promise<ArrayBuffer> {
    this._init();
    if (!this._adapter) {
      throw new Error('TTS 未启用（检查 .env: TTS_ENABLED / TTS_URL）');
    }
    return this._adapter.speak(text, this._config);
  }

  async health(): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
    this._init();
    const url = (process.env['TTS_URL'] ?? '').replace(/\/$/, '');
    if (!url) return { ok: false, error: 'TTS_URL 未配置' };
    try {
      const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      const body = await resp.text().catch(() => '');
      return { ok: resp.ok, status: resp.status, body: body.slice(0, 200) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}

export const ttsService = new TTSService();
