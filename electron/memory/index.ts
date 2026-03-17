/**
 * 记忆模块统一导出入口
 *
 * 外部模块（aiService、main.ts 等）只从此处 import，
 * 不直接依赖各子模块的具体路径，方便未来内部重构。
 *
 * ── 公开 API 一览 ──────────────────────────────────────────
 *
 * memoryManager.buildMemoryAppend(id)          — 构建本对话记忆片段提示词
 * globalMemoryManager.buildGlobalMemoryAppend() — 构建全局记忆提示词
 * triggerConversationLeave(id)                 — 离开对话时调用，异步非阻塞
 * recordMessageActivity()                      — 每次发消息后调用，更新活跃时间戳
 * runStartupCatchUp(ids)                       — 启动时批量追赶历史遗留的未总结消息
 * startIdleScheduler(getActiveConvId, idleMs)  — 启动空闲定时器，空闲时自动后台总结
 */

export { memoryManager, MemoryManager } from './manager';
export { globalMemoryManager, GlobalMemoryManager } from './globalManager';
export type { MemoryConfig, GlobalMemoryConfig, SummarizeResult } from './types';
export { DEFAULT_MEMORY_CONFIG, DEFAULT_GLOBAL_MEMORY_CONFIG } from './types';

import { memoryManager } from './manager';
import { globalMemoryManager } from './globalManager';

/**
 * 离开对话时的完整记忆流水线（非阻塞触发，不等待完成）：
 *
 *   Step 1: forcePartialSummarize   — 补充总结窗口尾部剩余消息（< 10轮的尾巴）
 *   Step 2: refineAsync             — 将本对话新增片段精炼进全局记忆
 *
 * 两步串行保证 Step 2 能拿到 Step 1 刚产生的新片段。
 * main.ts 在检测到对话切换时调用此函数。
 */
export function triggerConversationLeave(conversationId: string): void {
  (async () => {
    await memoryManager.forcePartialSummarize(conversationId);
    await globalMemoryManager.refineAsync(conversationId);
  })().catch((e) =>
    console.error('[Memory] 离开对话流水线异常:', (e as Error).message)
  );
}

// ── 后台调度 ─────────────────────────────────────────────────────

/** 最近一次消息发送的时间戳，用于空闲检测 */
let _lastActivityMs = 0;

/**
 * 记录消息活跃时间（在 aiService 每次发消息后调用）。
 * 供空闲定时器判断是否达到触发阈值。
 */
export function recordMessageActivity(): void {
  _lastActivityMs = Date.now();
}

/**
 * 启动时批量追赶：扫描传入的所有对话 ID，
 * 对每个对话补充上次遗留的未总结消息，并精炼进全局记忆。
 *
 * 建议在 app.whenReady 之后延迟 3 秒调用，避免阻塞 UI 启动。
 */
export async function runStartupCatchUp(conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0) return;
  console.info(`[Memory] 启动追赶开始（共 ${conversationIds.length} 条对话）`);
  for (const id of conversationIds) {
    try {
      await memoryManager.catchUpAsync(id);
      await globalMemoryManager.refineAsync(id);
    } catch (e) {
      console.error(`[Memory] 启动追赶失败 ${id.slice(0, 8)}…:`, (e as Error).message);
    }
  }
  console.info('[Memory] 启动追赶完成');
}

/**
 * 启动空闲调度器：每分钟检测一次，当距离上次发消息超过 idleMs 毫秒时，
 * 对当前活跃对话执行一次追赶式总结，然后重置计时器。
 *
 * 这样无论对话多长，只要用户停下来 10 分钟，记忆就会被后台整理好，
 * 对话热路径中完全不再有总结 LLM 调用。
 *
 * @param getActiveConvId 返回当前活跃对话 ID 的函数（main.ts 传入）
 * @param idleMs          空闲阈值，默认 10 分钟
 */
export function startIdleScheduler(
  getActiveConvId: () => string | null,
  idleMs = 10 * 60 * 1000
): void {
  const CHECK_INTERVAL = 60 * 1000; // 每分钟检查一次
  setInterval(async () => {
    if (_lastActivityMs === 0) return;                       // 本次启动内尚无任何消息
    if (Date.now() - _lastActivityMs < idleMs) return;      // 未达空闲阈值
    _lastActivityMs = 0;                                     // 重置，等待下次活跃
    const convId = getActiveConvId();
    if (!convId) return;
    try {
      console.info(`[Memory] 空闲触发后台总结（对话 ${convId.slice(0, 8)}…）`);
      await memoryManager.catchUpAsync(convId);
      await globalMemoryManager.refineAsync(convId);
    } catch (e) {
      console.error('[Memory] 空闲总结异常:', (e as Error).message);
    }
  }, CHECK_INTERVAL);
}
