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
  speak(text: string, config: TTSAdapterConfig, signal?: AbortSignal): Promise<ArrayBuffer>;
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

  async speak(text: string, config: TTSAdapterConfig, signal?: AbortSignal): Promise<ArrayBuffer> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const resp = await fetch(`${this.baseUrl}/tts/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text,
        speaker:  config.speaker,
        language: config.language || 'auto',
      }),
      signal: signal ?? AbortSignal.timeout(180_000),
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
  /** 所有正在进行的 speak 请求的 AbortController，用于批量取消 */
  private _pendingControllers = new Set<AbortController>();

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

  /**
   * 取消所有正在进行的 speak 请求。
   * 新一轮 playTTS 开始时由渲染进程触发，避免旧请求堆积在服务器队列中。
   */
  abortAll(): void {
    for (const ctrl of this._pendingControllers) ctrl.abort();
    this._pendingControllers.clear();
    console.log('[TTS] abortAll: 已取消所有挂起的 speak 请求');
  }

  async speak(text: string): Promise<ArrayBuffer> {
    if (!this._adapter) {
      throw new Error('TTS 未启用');
    }
    const ctrl = new AbortController();
    // 单句最长 3 分钟（CPU 推理可能很慢）
    const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), 180_000);
    this._pendingControllers.add(ctrl);
    console.log(`[TTS] speak: url=${this._currentUrl}, speaker=${this._config.speaker}, lang=${this._config.language}, text="${text.slice(0, 50)}"`);
    try {
      return await this._adapter.speak(text, this._config, ctrl.signal);
    } finally {
      clearTimeout(timer);
      this._pendingControllers.delete(ctrl);
    }
  }

  async health(): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
    if (!this._currentUrl) {
      return { ok: false, error: 'TTS 未配置' };
    }

    // 探测策略：
    //   1. HEAD / — 最轻量，任何 HTTP 响应（含 404）均说明服务进程在线
    //   2. HEAD /health — 兼容有专用 health 端点的服务
    //   3. GET /health — 最后降级，获取响应体
    // GPT-SoVITS 等推理服务在 GPU 忙时 /health 会被阻塞，但 HEAD / 通常仍可达。
    // 任意 HTTP 状态码均视为"在线"，不要求 resp.ok。
    const TIMEOUT_MS = 3000;
    const probes: Array<{ method: string; path: string }> = [
      { method: 'HEAD', path: '/' },
      { method: 'HEAD', path: '/health' },
      { method: 'GET',  path: '/health' },
    ];

    for (const { method, path } of probes) {
      try {
        const resp = await fetch(`${this._currentUrl}${path}`, {
          method,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = method === 'GET' ? await resp.text().catch(() => '') : undefined;
        console.log(`[TTS] health: ${method} ${path} → ${resp.status}`);
        return { ok: true, status: resp.status, body: body?.slice(0, 200) };
      } catch {
        // 继续尝试下一个探针
      }
    }

    console.log(`[TTS] health: 所有探针均超时，服务不可达 (${this._currentUrl})`);
    return { ok: false, error: '服务不可达（所有探针超时）' };
  }
}

export const ttsService = new TTSService();
