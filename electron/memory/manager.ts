/**
 * 记忆调度层 - 唯一职责：决定「何时总结」「如何拼接记忆提示词」
 *
 * 依赖关系（单向）：
 *   manager → summarizer（调用 LLM）
 *   manager → db（读写持久化）
 *   manager → ai.config（读取 provider）
 *
 * aiService 只需调用两个公开方法：
 *   1. triggerCheckAndSummarize(conversationId) — 后台异步，AI 回复后触发
 *   2. buildMemoryAppend(conversationId)        — 同步读取，构建 prompt 时调用
 */

import aiConfig from '../ai.config';
import {
  getMemoryFragments,
  addMemoryFragment,
  countNonSystemMessages,
  getMessagesInRange,
  getMemoryCursor,
  setMemoryCursor,
} from '../db';
import { summarizeMessages } from './summarizer';
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from './types';

export class MemoryManager {
  private readonly config: MemoryConfig;

  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
  }

  // ── 公开接口 ─────────────────────────────────────────────

  /** 全局单例，供 aiService 直接使用 */
  triggerCheckAndSummarize(conversationId: string): void {
    this.checkAndSummarize(conversationId).catch((e) =>
      console.error('[Memory] 后台总结异常:', e)
    );
  }

  /**
   * 可 await 的追赶式总结，供启动批处理和空闲调度器调用。
   * 与 triggerCheckAndSummarize 逻辑相同，但可以被 await。
   */
  async catchUpAsync(conversationId: string): Promise<void> {
    await this.checkAndSummarize(conversationId);
  }

  /**
   * 离开对话时调用：对窗口尾部不足整窗的剩余消息执行一次部分总结。
   *
   * 触发条件：未总结的消息数 ≥ leaveMinRounds*2（且 < 完整窗口大小，
   *            因为整窗口已由 triggerCheckAndSummarize 处理）。
   * 供 memory/index.ts 的离开流水线 await，保证在全局精炼前完成。
   * 失败时不推进游标，静默返回（不阻塞离开流程）。
   */
  async forcePartialSummarize(conversationId: string): Promise<void> {
    const provider = aiConfig.providers[aiConfig.activeProvider];
    if (!provider) return;

    const fullBatchSize = this.config.summaryWindowRounds * 2;
    const minMessages = this.config.leaveMinRounds * 2;

    const total = countNonSystemMessages(conversationId);
    const cursor = getMemoryCursor(conversationId);
    const unsummarized = total - cursor;

    // 已被正常窗口处理（>=fullBatch）或不足最低触发阈值 → 跳过
    if (unsummarized >= fullBatchSize || unsummarized < minMessages) return;

    const batch = getMessagesInRange(conversationId, cursor, unsummarized);

    let summary: string | null = null;
    try {
      summary = await summarizeMessages(provider, batch, this.config);
    } catch (e) {
      console.error('[Memory] forcePartialSummarize 调用失败（游标不推进）:', (e as Error).message);
      return;
    }

    const newCursor = cursor + unsummarized;
    if (summary) {
      addMemoryFragment({
        conversation_id: conversationId,
        content: summary,
        msg_offset_end: newCursor,
      });
      console.info(
        `[Memory] 对话 ${conversationId.slice(0, 8)}… 离开时补充摘要（消息 ${cursor + 1}-${newCursor}）`
      );
    } else {
      console.info(
        `[Memory] 对话 ${conversationId.slice(0, 8)}… 离开时剩余消息无有效记忆，跳过`
      );
    }
    setMemoryCursor(conversationId, newCursor);
  }

  /**
   * 构建记忆追加提示词（同步）。
   * 返回的字符串直接 append 到角色 system prompt 末尾。
   * 若无历史记忆则返回空字符串，不产生任何影响。
   */
  buildMemoryAppend(conversationId: string): string {
    const fragments = getMemoryFragments(conversationId);
    if (fragments.length === 0) return '';

    const memoriesText = fragments.map((f) => f.content).join('\n');
    return (
      '\n\n【以下是你与用户过去对话积累的长期记忆，请结合这些信息与用户交流，但不要主动提起这份记忆本身】\n' +
      memoriesText
    );
  }

  // ── 内部实现 ─────────────────────────────────────────────

  /**
   * 检查并执行记忆总结（可能一次总结多个窗口以追赶进度）。
   *
   * 逻辑：
   * 1. 统计当前对话的 user+assistant 消息总数
   * 2. 对比「已总结游标」，差值 >= 一个窗口（windowRounds*2 条）时触发
   * 3. 调用 LLM 总结 → 有内容则存入 memory_fragments，无内容则静默跳过
   * 4. 无论有无内容，都推进游标（避免对同一批消息反复尝试）
   * 5. 循环处理，直到剩余未总结消息不足一个窗口
   */
  private async checkAndSummarize(conversationId: string): Promise<void> {
    const provider = aiConfig.providers[aiConfig.activeProvider];
    if (!provider) return;

    const batchSize = this.config.summaryWindowRounds * 2; // 1轮 = 2条消息

    // 循环处理：一次可能追赶多个窗口（例如导入历史对话后）
    while (true) {
      const total = countNonSystemMessages(conversationId);
      const cursor = getMemoryCursor(conversationId);
      const unsummarized = total - cursor;

      if (unsummarized < batchSize) break; // 未满一个窗口，等待下次触发

      const batch = getMessagesInRange(conversationId, cursor, batchSize);

      let summary: string | null = null;
      try {
        summary = await summarizeMessages(provider, batch, this.config);
      } catch (e) {
        // LLM 调用失败：不推进游标，下次 AI 回复后重试
        console.error('[Memory] LLM 总结调用失败（将在下次重试）:', (e as Error).message);
        break;
      }

      const newCursor = cursor + batchSize;

      if (summary) {
        // 有有效记忆 → 持久化
        addMemoryFragment({
          conversation_id: conversationId,
          content: summary,
          msg_offset_end: newCursor,
        });
        console.info(
          `[Memory] 对话 ${conversationId.slice(0, 8)}… 新增记忆片段（消息 ${cursor + 1}-${newCursor}）`
        );
      } else {
        // 纯闲聊，无有效记忆 → 静默跳过，游标仍然推进
        console.info(
          `[Memory] 对话 ${conversationId.slice(0, 8)}… 消息 ${cursor + 1}-${newCursor} 无有效记忆，跳过`
        );
      }

      // 无论有无摘要，都推进游标，防止对同一批消息无限重试
      setMemoryCursor(conversationId, newCursor);
    }
  }
}

/** 全局单例，供 aiService 直接使用 */
export const memoryManager = new MemoryManager();
