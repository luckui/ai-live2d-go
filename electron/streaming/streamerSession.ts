import aiConfig from '../ai.config';
import { fetchCompletion } from '../llmClient';
import type { EphemeralLiveCredentials, LiveEvent, StreamerReply, StreamerSessionConfig, StreamerStatus } from './types';
import { DanmuPool } from './danmuPool';
import { createPlatformAdapter, type PlatformAdapter } from './platforms';
import { SESSION_SYSTEM_PROMPT } from './streamerPrompts';

class StreamerSessionManager {
  private config: StreamerSessionConfig | null = null;
  private startedAt = 0;
  private pool = new DanmuPool();
  private replies: StreamerReply[] = [];
  private timer: NodeJS.Timeout | null = null;
  private runningGeneration = false;
  private lastError: string | undefined;
  private adapterStatus = 'not-connected';
  private credentials: EphemeralLiveCredentials | null = null;
  private adapter: PlatformAdapter | null = null;

  start(config: StreamerSessionConfig, credentials?: EphemeralLiveCredentials): StreamerStatus {
    this.stop();
    this.config = {
      ...config,
      autoReply: config.autoReply ?? false,
    };
    this.credentials = credentials ?? null;
    this.startedAt = Date.now();
    this.pool = new DanmuPool();
    this.replies = [];
    this.lastError = undefined;
    this.adapterStatus = 'connecting...';

    // 启动平台适配器
    try {
      this.adapter = createPlatformAdapter(this.config, credentials?.cookie);
      
      this.adapter.on('connected', () => {
        this.adapterStatus = 'connected';
        console.log('[StreamerSession] Platform adapter connected');
      });

      this.adapter.on('authenticated', () => {
        this.adapterStatus = 'authenticated (active)';
        console.log('[StreamerSession] Platform adapter authenticated');
      });

      this.adapter.on('event', (event) => {
        this.ingest(event);
      });

      this.adapter.on('error', (err) => {
        this.lastError = err.message;
        // 只打印 message，避免 Error 对象中潜在的网络请求细节（含 URL/headers）被暴露
        console.error('[StreamerSession] Platform adapter error:', err.message);
      });

      this.adapter.on('disconnected', () => {
        this.adapterStatus = 'disconnected (reconnecting...)';
        console.warn('[StreamerSession] Platform adapter disconnected');
      });

      // 异步启动（不阻塞）
      void this.adapter.start();
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.adapterStatus = 'failed';
      console.error('[StreamerSession] Failed to start adapter:', err);
    }

    // 注意：不在 session 内部启动 flush timer。
    // streamerController 是唯一编排者，负责 poll → 生成 → TTS 的完整流程。
    // 若在此处也定时 flushDue，会抢先消费 pool 但无法触发 TTS，导致弹幕被吞。

    return this.status();
  }

  stop(): StreamerStatus {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.adapter) {
      this.adapter.stop();
      this.adapter.removeAllListeners();
      this.adapter = null;
    }

    this.config = null;
    this.credentials = null;
    this.startedAt = 0;
    this.adapterStatus = 'stopped';
    return this.status();
  }

  status(): StreamerStatus {
    const snap = this.pool.snapshot();
    return {
      running: !!this.config,
      platform: this.config?.platform,
      roomId: this.config?.roomId,
      topic: this.config?.topic,
      startedAt: this.startedAt || undefined,
      adapterStatus: this.adapterStatus,
      credentials: {
        required: true,
        present: !!this.credentials,
        persisted: false,
      },
      queue: snap,
      replies: this.replies.length,
      lastError: this.lastError,
    };
  }

  ingest(event: LiveEvent): { accepted: boolean; reason?: string; status: StreamerStatus } {
    if (!this.config) {
      return { accepted: false, reason: 'streamer-not-running', status: this.status() };
    }
    const result = this.pool.ingest(event);
    
    if (result.accepted) {
      const snap = this.pool.snapshot();
      console.log(`[StreamerSession] Event ingested: type=${event.type}, uname=${event.uname || '(none)'}, queue=${snap.pendingDanmu}+${snap.pendingPriority}`);
    } else {
      // 详细说明拒绝原因
      const reasonMsg = {
        'empty': '内容为空',
        'duplicate': '90秒内重复',
        'user-rate-limit': '用户限流（同一用户500ms内只能发1条）',
      }[result.reason || ''] || result.reason || 'unknown';
      console.log(`[StreamerSession] Event rejected: type=${event.type}, uname=${event.uname || '(none)'}, reason=${reasonMsg}`);
    }
    
    return { accepted: result.accepted, reason: result.reason, status: this.status() };
  }

  async flushOnce(): Promise<StreamerReply | null> {
    return this.flushDue(true);
  }

  setAutoReply(enabled: boolean): boolean {
    if (!this.config) {
      console.warn('[StreamerSession] setAutoReply: no active session');
      return false;
    }
    this.config.autoReply = enabled;
    console.log(`[StreamerSession] autoReply 已${enabled ? '开启' : '关闭'}`);
    return true;
  }

  setTopic(topic: string): boolean {
    if (!this.config) {
      console.warn('[StreamerSession] setTopic: no active session');
      return false;
    }
    this.config.topic = topic;
    console.log(`[StreamerSession] topic updated: "${topic}"`);
    return true;
  }

  listReplies(limit = 10): StreamerReply[] {
    return this.replies.slice(-limit);
  }

  private async flushDue(force = false): Promise<StreamerReply | null> {
    if (!this.config || this.runningGeneration) return null;

    // autoReply 检查放在 nextReply 之前，避免事件被 pop 后又不生成 AI/TTS 造成丢弹幕
    if (!this.config.autoReply && !force) {
      console.log('[StreamerSession] autoReply=false and not forced, skipping');
      return null;
    }

    const next = this.pool.nextReply(this.config.topic);
    if (!next) return null;

    console.log(`[StreamerSession] flushDue called: force=${force}, autoReply=${this.config.autoReply}, kind=${next.kind}, events=${next.eventIds?.length || 0}`);

    // funded_request 不走简单 LLM 回复，直接透传给 streamerController 处理工具循环
    if (next.kind === 'funded_request') {
      console.log(`[StreamerSession] funded_request → 透传给 streamerController`);
      this.replies.push(next);
      return next;
    }

    this.runningGeneration = true;
    try {
      const provider = aiConfig.providers[aiConfig.activeProvider];
      if (!provider) throw new Error(`missing provider: ${aiConfig.activeProvider}`);
      
      console.log(`[StreamerSession] Calling AI (provider=${aiConfig.activeProvider}, prompt length=${next.prompt.length})...`);
      console.log(`[StreamerSession] Prompt preview: ${next.prompt.slice(0, 200)}...`);
      
      const data = await fetchCompletion(provider, [
        { role: 'system', content: SESSION_SYSTEM_PROMPT },
        { role: 'user', content: next.prompt },
      ]);
      next.reply = data.choices[0]?.message.content?.trim() ?? '';
      
      console.log(`[StreamerSession] AI replied: ${next.reply?.slice(0, 100) || '(empty)'}...`);
      
      this.replies.push(next);
      return next;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error('[StreamerSession] AI generation failed:', this.lastError);
      this.replies.push(next);
      return next;
    } finally {
      this.runningGeneration = false;
    }
  }
}

export const streamerSession = new StreamerSessionManager();
