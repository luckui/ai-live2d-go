/**
 * 记忆模块统一导出入口
 *
 * 外部模块（aiService、main.ts 等）只从此处 import，
 * 不直接依赖各子模块的具体路径，方便未来内部重构。
 *
 * ── 公开 API 一览 ──────────────────────────────────────────
 *
 * memoryManager.triggerCheckAndSummarize(id)  — AI 回复后触发，异步非阻塞
 * memoryManager.buildMemoryAppend(id)         — 构建本对话记忆片段提示词
 * globalMemoryManager.buildGlobalMemoryAppend()— 构建全局记忆提示词
 * triggerConversationLeave(id)                — 离开对话时调用，异步非阻塞
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
 *   Step 1: forcePartialSummarize   — 补充总结窗口尾部剩余消息（< 30轮的尾巴）
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
