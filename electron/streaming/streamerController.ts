/**
 * Streamer 主控循环
 * 协调 streamerSession、TTS、Live2D 的自动化工作流
 * 
 * 职责：
 * 1. 定期检查弹幕池（优先队列 + 普通弹幕）
 * 2. 自动生成回复（调用 AI）
 * 3. 自动触发 TTS 朗读
 * 4. 自动控制 Live2D 情绪/动作
 * 5. 主动开口（距上次发言 > threshold 且无待处理弹幕）
 */

import { EventEmitter } from 'events';
import { streamerSession } from './streamerSession';
import type { StreamerReply } from './types';
import { playTTSAudio } from '../main';
import { sendLive2DCommand } from '../live2dBridge';

export interface StreamerControllerConfig {
  /** 主动开口阈值（毫秒），默认 45 秒 */
  idleThresholdMs?: number;
  /** 检查间隔（毫秒），默认 3 秒 */
  checkIntervalMs?: number;
  /** 是否自动朗读回复（默认 true） */
  autoTTS?: boolean;
  /** 是否自动控制 Live2D（默认 true） */
  autoLive2D?: boolean;
}

class StreamerControllerManager extends EventEmitter {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private lastSpeakAt = 0;
  private config: Required<StreamerControllerConfig> = {
    idleThresholdMs: 45_000,
    checkIntervalMs: 3_000,
    autoTTS: true,
    autoLive2D: true,
  };

  /**
   * 启动主控循环
   */
  start(config?: StreamerControllerConfig): void {
    if (this.running) {
      console.warn('[StreamerController] Already running');
      return;
    }

    this.config = {
      ...this.config,
      ...config,
    };

    this.running = true;
    this.lastSpeakAt = Date.now();

    console.log('[StreamerController] Started with config:', this.config);

    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.checkIntervalMs);
  }

  /**
   * 停止主控循环
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    console.log('[StreamerController] Stopped');
  }

  /**
   * 获取运行状态
   */
  getStatus() {
    return {
      running: this.running,
      lastSpeakAt: this.lastSpeakAt,
      idleDurationMs: Date.now() - this.lastSpeakAt,
      config: this.config,
    };
  }

  /**
   * 主循环 tick
   */
  private async tick(): Promise<void> {
    if (!this.running) return;

    const status = streamerSession.status();
    if (!status.running) return;

    // 1. 检查是否有待处理的弹幕/礼物
    const hasPending = status.queue.pendingDanmu > 0 || status.queue.pendingPriority > 0;

    if (hasPending) {
      // 有弹幕：生成并朗读回复
      await this.processReply();
    } else {
      // 无弹幕：检查是否需要主动开口
      await this.checkProactiveSpeak();
    }
  }

  /**
   * 处理一条回复（生成 + TTS + Live2D）
   */
  private async processReply(): Promise<void> {
    try {
      console.log('[StreamerController] Processing reply from queue...');
      const reply = await streamerSession.flushOnce();
      if (!reply) {
        console.log('[StreamerController] No reply generated (queue might be empty)');
        return;
      }

      console.log(`[StreamerController] Generated reply (kind=${reply.kind}): ${reply.reply?.slice(0, 80) || '(empty)'}`);
      console.log(`[StreamerController] Reply events: ${reply.eventIds?.length || 0} items, prompt length: ${reply.prompt?.length || 0} chars`);

      // 更新发言时间
      this.lastSpeakAt = Date.now();

      // 自动 TTS 朗读
      if (this.config.autoTTS && reply.reply) {
        console.log(`[StreamerController] Speaking via TTS: ${reply.reply.slice(0, 50)}...`);
        await this.speakText(reply.reply);
      } else if (!reply.reply) {
        console.warn('[StreamerController] Reply text is empty, skipping TTS');
      }

      // 自动 Live2D 控制
      if (this.config.autoLive2D) {
        this.controlLive2D(reply);
      }

      this.emit('reply', reply);
    } catch (err) {
      console.error('[StreamerController] Process reply error:', err);
    }
  }

  /**
   * 检查是否需要主动开口
   */
  private async checkProactiveSpeak(): Promise<void> {
    const idleDuration = Date.now() - this.lastSpeakAt;
    if (idleDuration < this.config.idleThresholdMs) return;

    try {
      console.log(`[StreamerController] Idle for ${Math.floor(idleDuration / 1000)}s, checking proactive speak...`);

      const status = streamerSession.status();
      const topic = status.topic || '自由聊天';

      // 构造主动开口 prompt
      const proactivePrompt = [
        '你是正在 B 站直播的 Live2D 主播 Hiyori。',
        `本场主题：${topic}`,
        '',
        `现在直播间没有弹幕已经超过 ${Math.floor(idleDuration / 1000)} 秒了。`,
        '你可以主动抛一个与主题相关的话题，或者自言自语一下活跃气氛。',
        '不要问太深的问题，轻松自然即可，控制在 60 字内。',
      ].join('\n');

      // 这里可以调用 AI 生成主动开口内容
      // 为了简化，暂时使用预设话题
      const proactiveText = await this.generateProactiveText(proactivePrompt);

      if (proactiveText) {
        console.log(`[StreamerController] Proactive: ${proactiveText}`);
        this.lastSpeakAt = Date.now();

        if (this.config.autoTTS) {
          await this.speakText(proactiveText);
        }

        if (this.config.autoLive2D) {
          this.setRandomExpression();
        }

        this.emit('proactive', proactiveText);
      } else {
        // 即使没有生成文本，也要重置计时器，避免重复触发
        console.log('[StreamerController] Proactive speak disabled (generateProactiveText returned null)');
        this.lastSpeakAt = Date.now();
      }
    } catch (err) {
      console.error('[StreamerController] Proactive speak error:', err);
      // 出错也要重置计时器
      this.lastSpeakAt = Date.now();
    }
  }

  /**
   * 生成主动开口文本（调用 AI）
   */
  private async generateProactiveText(prompt: string): Promise<string | null> {
    try {
      // TODO: 调用 AI 生成（可以复用 streamerSession 的生成逻辑）
      // 暂时返回 null，让主动开口逻辑不执行
      return null;
    } catch {
      return null;
    }
  }

  /**
   * TTS 朗读文本
   */
  private async speakText(text: string): Promise<void> {
    try {
      // 清理文本（移除特殊标记）
      const cleanText = text
        .replace(/【.*?】/g, '')
        .replace(/\[.*?\]/g, '')
        .trim();

      if (!cleanText) return;

      // 播放 TTS 音频（自动发送到渲染进程）
      const success = await playTTSAudio(cleanText);
      if (!success) {
        console.log('[StreamerController] TTS playback failed or skipped');
      }
    } catch (err) {
      console.error('[StreamerController] TTS error:', err);
    }
  }

  /**
   * 控制 Live2D（根据回复内容）
   */
  private controlLive2D(reply: StreamerReply): void {
    try {
      // 根据回复类型设置情绪
      switch (reply.kind) {
        case 'gift_thanks':
          // 礼物感谢：开心表情
          sendLive2DCommand({ type: 'emotion', emotion: 'happy', playMotion: true });
          break;

        case 'danmu_single':
        case 'danmu_batch':
          // 普通弹幕：随机表情
          this.setRandomExpression();
          break;

        case 'topic_control':
          // 控场：专注表情
          sendLive2DCommand({ type: 'emotion', emotion: 'neutral' });
          break;
      }
    } catch (err) {
      console.error('[StreamerController] Live2D control error:', err);
    }
  }

  /**
   * 设置随机表情
   */
  private setRandomExpression(): void {
    const emotions: Array<'neutral' | 'happy' | 'shy' | 'surprised'> = ['neutral', 'happy', 'shy', 'surprised'];
    const random = emotions[Math.floor(Math.random() * emotions.length)];
    sendLive2DCommand({ type: 'emotion', emotion: random });
  }
}

export const streamerController = new StreamerControllerManager();
