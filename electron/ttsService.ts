/// <reference types="node" />
/**
 * TTS 服务模块（主进程）
 *
 * 采用适配器模式，便于日后接入更多 TTS 服务商：
 *   - MyTTSAdapter   当前自建 FastAPI TTS（POST /tts，返回 WAV 流）
 *   - (future) EdgeTTSAdapter
 *   - (future) AzureTTSAdapter
 *   - (future) OpenAITTSAdapter
 *
 * 环境变量（.env）：
 *   TTS_ENABLED=true
 *   TTS_URL=http://8.153.95.187      ← 服务根地址，不含路径
 *   TTS_SPEAKER=bailu                ← 音色名称，通过 GET /speakers 查询可用值
 *   TTS_LANGUAGE=Auto                ← 可选，默认 Auto
 *   TTS_API_KEY=<key>                ← Bearer Token 认证
 */

// ── Adapter 接口（所有 TTS 服务商实现此接口）────────────────────────

export interface TTSAdapter {
  readonly name: string;
  /** 合成文本，返回 WAV 音频的 ArrayBuffer */
  speak(text: string, config: TTSAdapterConfig): Promise<ArrayBuffer>;
}

export interface TTSAdapterConfig {
  speaker: string;
  language: string;
}

// ── MyTTSAdapter：当前自建 FastAPI TTS ──────────────────────────────
// 接口规范见 example_tts.txt：
//   POST /tts   body: { text, speaker, language, ... }  → WAV 流
//   GET  /speakers                                       → 音色列表

class MyTTSAdapter implements TTSAdapter {
  readonly name = 'my-tts';

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string, // Bearer Token，空则不加头
  ) {}

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
      signal: AbortSignal.timeout(120_000), // TTS 合成最长 120 秒
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`TTS API ${resp.status}: ${errText.slice(0, 200)}`);
    }

    return resp.arrayBuffer();
  }
}

// ── TTS 服务单例 ────────────────────────────────────────────────────

class TTSService {
  // 不在构造函数里读 env，避免 dotenv.config() 未执行时就初始化
  // 每次访问 isEnabled / speak() 时懒加载

  private _ready = false;
  private _adapter: TTSAdapter | null = null;
  private _config: { speaker: string; language: string } = { speaker: '', language: 'Auto' };

  private _init(): void {
    if (this._ready) return;
    this._ready = true;

    const enabled  = process.env['TTS_ENABLED']  === 'true';
    const url      = (process.env['TTS_URL']     ?? '').replace(/\/$/, '');
    const speaker  = process.env['TTS_SPEAKER']  ?? '';
    const language = process.env['TTS_LANGUAGE'] ?? 'Auto';
    const apiKey   = process.env['TTS_API_KEY']  ?? '';

    console.info(`[TTS] init: enabled=${enabled} url="${url}" speaker="${speaker}" auth=${apiKey ? 'Bearer ***' : 'none'}`);

    this._config = { speaker, language };

    if (enabled && url && speaker) {
      this._adapter = new MyTTSAdapter(url, apiKey);
      console.info(`[TTS] 已启用 ${this._adapter.name}，speaker=${speaker}`);
    } else {
      this._adapter = null;
      if (enabled) {
        console.warn('[TTS] TTS_ENABLED=true 但 TTS_URL 或 TTS_SPEAKER 未配置，TTS 已禁用');
      } else {
        console.info('[TTS] TTS_ENABLED != true，TTS 未启用');
      }
    }
  }

  /** 重置服务，下次访问时重新读取 env（UI 保存配置后调用）*/
  reset(): void {
    this._ready   = false;
    this._adapter = null;
  }

  get isEnabled(): boolean {
    this._init();
    return this._adapter !== null;
  }

  /** 主进程 debug 用：返回当前 env 读到的原始值 */
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

  /** 合成文本并返回 WAV ArrayBuffer */
  async speak(text: string): Promise<ArrayBuffer> {
    this._init();
    if (!this._adapter) {
      throw new Error('TTS 未启用（检查 .env 中的 TTS_ENABLED / TTS_URL / TTS_SPEAKER）');
    }
    return this._adapter.speak(text, this._config);
  }

  /** 健康检查：GET /health */
  async health(): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
    this._init();
    const url = (process.env['TTS_URL'] ?? '').replace(/\/$/, '');
    if (!url) return { ok: false, error: 'TTS_URL 未配置' };
    try {
      const resp = await fetch(`${url}/health/`, { signal: AbortSignal.timeout(5000) });
      const body = await resp.text().catch(() => '');
      return { ok: resp.ok, status: resp.status, body: body.slice(0, 200) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}

export const ttsService = new TTSService();
