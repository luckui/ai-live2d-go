/**
 * GiftCreditLedger — 礼物信用台账
 *
 * 当观众送出金额达到阈值的礼物时，为其记录一次"请求信用"。
 * 带有信用的观众发出的弹幕会被标记为 funded_request，
 * 路由给主 Agent 执行工具（如看视频、互动操作等）。
 *
 * 配置（.env）：
 *   GIFT_MIN_VALUE_FOR_REQUEST=30   礼物最小金额（B站电池，约10电池=1元），默认 30
 *   GIFT_CREDIT_TTL_MS=300000       credit 有效期（ms），默认 5 分钟
 */

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

export interface GiftCredit {
  uid: string;
  uname: string;
  giftName: string;
  giftValue: number;    // 礼物价值（电池数）
  grantedAt: number;    // 授予时间戳
  consumed: boolean;    // 是否已被消费
}

class GiftCreditLedger {
  private credits = new Map<string, GiftCredit>();

  get minValue(): number {
    return envInt('GIFT_MIN_VALUE_FOR_REQUEST', 30);
  }

  get ttlMs(): number {
    return envInt('GIFT_CREDIT_TTL_MS', 300_000);
  }

  /**
   * 收到礼物时调用，若金额达到阈值则发放信用
   */
  tryCredit(uid: string, uname: string, giftName: string, giftValue: number): boolean {
    if (giftValue < this.minValue) return false;

    const now = Date.now();
    const existing = this.credits.get(uid);

    // 已有未消费的 credit 时累加价值（防止多次刷礼物绕过单次限制）
    if (existing && !existing.consumed) {
      existing.giftValue += giftValue;
      existing.grantedAt = now; // 刷新有效期
      console.log(`[GiftCredit] 累加信用: uid=${uid} uname=${uname} totalValue=${existing.giftValue}`);
      return true;
    }

    this.credits.set(uid, {
      uid,
      uname,
      giftName,
      giftValue,
      grantedAt: now,
      consumed: false,
    });
    console.log(`[GiftCredit] 发放信用: uid=${uid} uname=${uname} giftName=${giftName} value=${giftValue} (threshold=${this.minValue})`);
    return true;
  }

  /**
   * 检查某用户是否有可用的未消费信用
   */
  hasCredit(uid: string): boolean {
    this.prune();
    const c = this.credits.get(uid);
    return !!c && !c.consumed;
  }

  /**
   * 获取信用详情（返回 null 表示无有效信用）
   */
  getCredit(uid: string): GiftCredit | null {
    this.prune();
    const c = this.credits.get(uid);
    return c && !c.consumed ? c : null;
  }

  /**
   * 消费一次信用（请求已交给主 Agent 处理）
   */
  consume(uid: string): void {
    const c = this.credits.get(uid);
    if (c) {
      c.consumed = true;
      console.log(`[GiftCredit] 消费信用: uid=${uid} uname=${c.uname}`);
    }
  }

  /**
   * 列出所有活跃信用（供 status 查询）
   */
  listActive(): GiftCredit[] {
    this.prune();
    return [...this.credits.values()].filter(c => !c.consumed);
  }

  /** 清理过期信用 */
  private prune(): void {
    const now = Date.now();
    for (const [uid, c] of this.credits) {
      if (now - c.grantedAt > this.ttlMs || c.consumed) {
        this.credits.delete(uid);
      }
    }
  }
}

export const giftCreditLedger = new GiftCreditLedger();
