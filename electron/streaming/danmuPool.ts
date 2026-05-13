import type { LiveEvent, SanitizedLiveEvent, StreamerReply } from './types';
import { formatUntrustedEvent, sanitizeLiveEvent } from './danmuSafety';
import { giftCreditLedger } from './giftCreditLedger';
import {
  ROLE_IDENTITY,
  SECURITY_RULE_EXTENDED,
  DANMU_OUTPUT_INSTRUCTION,
  FUNDED_JUDGE_RULES,
  danmuModeHint,
  danmuGiftRule,
  type DanmuMode,
} from './streamerPrompts';

const WINDOW_MS = 60_000;
const DEDUPE_TTL_MS = 90_000;
const USER_MIN_INTERVAL_MS = 500; // 同一用户最小间隔：500ms（原 1.5s 太严格）

export class DanmuPool {
  private danmu: SanitizedLiveEvent[] = [];
  private priority: SanitizedLiveEvent[] = [];
  private recentTimestamps: number[] = [];
  private recentFingerprints = new Map<string, number>();
  private lastUserMessageAt = new Map<string, number>();
  private replySeq = 0;

  ingest(event: LiveEvent): { accepted: boolean; reason?: string; event?: SanitizedLiveEvent } {
    const sanitized = sanitizeLiveEvent(event);
    const now = sanitized.ts || Date.now();
    this.prune(now);
    this.recentTimestamps.push(now);

    if (sanitized.type === 'gift' || sanitized.type === 'super_chat' || sanitized.type === 'guard') {
      // 礼物/SC/舞闹 → 尝试发放信用（SC 必有附言自带请求，也可带价占位）
      const uid = sanitized.uid ?? sanitized.uname;
      giftCreditLedger.tryCredit(
        uid,
        sanitized.uname,
        sanitized.giftName,
        sanitized.giftValue ?? 0,
      );
      this.priority.push(sanitized);
      return { accepted: true, event: sanitized };
    }

    if (!sanitized.text && sanitized.type === 'danmu') {
      return { accepted: false, reason: 'empty' };
    }

    const seenAt = this.recentFingerprints.get(sanitized.fingerprint);
    if (seenAt && now - seenAt < DEDUPE_TTL_MS) {
      return { accepted: false, reason: 'duplicate' };
    }

    const uid = sanitized.uid ?? sanitized.uname;
    const lastAt = this.lastUserMessageAt.get(uid);
    if (lastAt && now - lastAt < USER_MIN_INTERVAL_MS) {
      return { accepted: false, reason: 'user-rate-limit' };
    }

    this.recentFingerprints.set(sanitized.fingerprint, now);
    this.lastUserMessageAt.set(uid, now);

    // 有礼物信用的观众：将其弹幕标记为 funded_request，放入优先队列
    const credit = giftCreditLedger.getCredit(uid);
    if (credit) {
      sanitized.fundedByUid = uid; // 动态添加标记，供 nextReply 识别
      this.priority.push(sanitized);
      console.log(`[DanmuPool] funded_request: uid=${uid} uname=${sanitized.uname} text="${sanitized.text.slice(0, 40)}"`);
    } else {
      this.danmu.push(sanitized);
    }
    return { accepted: true, event: sanitized };
  }

  get pendingDanmu(): number {
    return this.danmu.length;
  }

  get pendingPriority(): number {
    return this.priority.length;
  }

  get recentPerMinute(): number {
    this.prune(Date.now());
    return this.recentTimestamps.length;
  }

  get mode(): 'single' | 'batch' | 'summary' {
    const rpm = this.recentPerMinute;
    if (rpm <= 8) return 'single';
    if (rpm <= 40) return 'batch';
    return 'summary';
  }

  nextReply(topic?: string): StreamerReply | null {
    const priority = this.priority.shift();
    if (priority) {
      // funded_request：有礼物信用驱动的弹幕，路由给主 Agent 执行工具
      if (priority.fundedByUid) {
        const credit = giftCreditLedger.getCredit(priority.fundedByUid);
        if (credit) {
          return this.buildFundedRequest(priority, credit, topic);
        }
      }
      return this.buildReply('gift_thanks', [priority], topic);
    }

    if (!this.danmu.length) return null;

    const mode = this.mode;
    if (mode === 'single') {
      return this.buildReply('danmu_single', [this.danmu.shift()!], topic);
    }

    const take = mode === 'batch' ? Math.min(6, this.danmu.length) : Math.min(14, this.danmu.length);
    const events = this.danmu.splice(0, take);
    return this.buildReply(mode === 'batch' ? 'danmu_batch' : 'danmu_batch', events, topic);
  }

  snapshot() {
    return {
      pendingDanmu: this.pendingDanmu,
      pendingPriority: this.pendingPriority,
      recentPerMinute: this.recentPerMinute,
      mode: this.mode,
    };
  }

  private buildFundedRequest(event: SanitizedLiveEvent, credit: import('./giftCreditLedger').GiftCredit, topic?: string): StreamerReply {
    const prompt = [
      `观众 ${credit.uname} 送出了 ${credit.giftName}（价值 ${credit.giftValue} 电池），发了一条弹幕：`,
      '',
      `"${event.text}"`,
      '',
      `直播主题：${topic ?? '自由聊天'}`,
      '',
      FUNDED_JUDGE_RULES,
    ].join('\n');

    return {
      id: `reply-${Date.now()}-${++this.replySeq}`,
      createdAt: Date.now(),
      kind: 'funded_request',
      prompt,
      eventIds: [event.id],
      fundedBy: {
        uid: credit.uid,
        uname: credit.uname,
        giftName: credit.giftName,
        giftValue: credit.giftValue,
      },
    };
  }

  private buildReply(kind: StreamerReply['kind'], events: SanitizedLiveEvent[], topic?: string): StreamerReply {
    const prompt = [
      ROLE_IDENTITY,
      topic ? `本场主题：${topic}` : '本场主题：自由聊天。',
      danmuModeHint(this.mode as DanmuMode),
      danmuGiftRule(kind === 'gift_thanks'),
      '',
      SECURITY_RULE_EXTENDED,
      '',
      '<untrusted_live_events>',
      ...events.map(formatUntrustedEvent),
      '</untrusted_live_events>',
      '',
      DANMU_OUTPUT_INSTRUCTION,
    ].join('\n');

    return {
      id: `reply-${Date.now()}-${++this.replySeq}`,
      createdAt: Date.now(),
      kind,
      prompt,
      eventIds: events.map(e => e.id),
    };
  }

  private prune(now: number): void {
    this.recentTimestamps = this.recentTimestamps.filter(ts => now - ts <= WINDOW_MS);
    for (const [key, ts] of this.recentFingerprints) {
      if (now - ts > DEDUPE_TTL_MS) this.recentFingerprints.delete(key);
    }
    for (const [key, ts] of this.lastUserMessageAt) {
      if (now - ts > WINDOW_MS) this.lastUserMessageAt.delete(key);
    }
  }
}
