/// <reference types="node" />
/**
 * TTS 服务模块（主进程）
 *
 * 统一适配器：任何符合 POST /tts/generate 规范的 HTTP TTS 服务均可接入。
 * 不再读取 process.env，改为由 main.ts 调用 configure(provider) 注入配置。
 */

import type { TTSProviderConfig } from './tts.config';

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

class HttpTTSAdapter implements TTSAdapter {
  readonly name: string;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string = '',
  ) {
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
  private _adapter: TTSAdapter | null = null;
  private _config: TTSAdapterConfig = { speaker: '', language: 'Auto' };
  private _currentUrl = '';

  /**
   * 配置当前 TTS provider。传 null 则禁用。
   */
  configure(provider: TTSProviderConfig | null): void {
    if (provider) {
      const url = provider.baseUrl.replace(/\/$/, '');
      this._adapter = new HttpTTSAdapter(url, provider.apiKey);
      this._config = { speaker: provider.speaker, language: provider.language };
      this._currentUrl = url;
      console.info(`[TTS] 已配置: url=${url} speaker=${provider.speaker}`);
    } else {
      this._adapter = null;
      this._config = { speaker: '', language: 'Auto' };
      this._currentUrl = '';
      console.info('[TTS] 已禁用');
    }
  }

  get isEnabled(): boolean {
    return this._adapter !== null;
  }

  get currentUrl(): string {
    return this._currentUrl;
  }

  async speak(text: string): Promise<ArrayBuffer> {
    if (!this._adapter) {
      throw new Error('TTS 未启用');
    }
    console.log(`[TTS] speak: url=${this._currentUrl}, speaker=${this._config.speaker}, lang=${this._config.language}, text="${text.slice(0, 50)}"`);
    return this._adapter.speak(text, this._config);
  }

  async health(): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
    if (!this._currentUrl) {
      console.log('[TTS] health: 未配置 URL');
      return { ok: false, error: 'TTS 未配置' };
    }
    try {
      console.log(`[TTS] health: 检查 ${this._currentUrl}/health`);
      const resp = await fetch(`${this._currentUrl}/health`, { signal: AbortSignal.timeout(5000) });
      const body = await resp.text().catch(() => '');
      console.log(`[TTS] health: status=${resp.status}, ok=${resp.ok}`);
      return { ok: resp.ok, status: resp.status, body: body.slice(0, 200) };
    } catch (e) {
      console.warn(`[TTS] health: 失败 - ${String(e)}`);
      return { ok: false, error: String(e) };
    }
  }
}

export const ttsService = new TTSService();
