/**
 * 全局记忆调度层 - 唯一职责：决定「何时精炼」「如何拼接全局记忆提示词」
 *
 * 依赖关系（单向）：
 *   globalManager → globalSummarizer（调用 LLM）
 *   globalManager → db（读写持久化）
 *   globalManager → ai.config（读取 provider）
 *
 * 外部调用方式（通过 memory/index.ts）：
 *   1. refineAsync(conversationId)         — 可 await 的精炼（供离开对话链式调用）
 *   2. buildGlobalMemoryAppend()           — 同步读取，构建 prompt 时调用（全对话通用）
 */

import aiConfig from '../ai.config';
import {
  getMemoryFragments,
  getGlobalMemory,
  setGlobalMemory,
  getGlobalMemoryCursor,
  setGlobalMemoryCursor,
} from '../db';
import { refineGlobalMemory } from './globalSummarizer';
import { DEFAULT_GLOBAL_MEMORY_CONFIG, type GlobalMemoryConfig } from './types';

export class GlobalMemoryManager {
  private readonly config: GlobalMemoryConfig;

  constructor(config: Partial<GlobalMemoryConfig> = {}) {
    this.config = { ...DEFAULT_GLOBAL_MEMORY_CONFIG, ...config };
  }

  // ── 公开接口 ─────────────────────────────────────────────

  /**
   * 构建全局记忆追加提示词（同步，跨对话通用）。
   * 返回字符串直接 append 到角色 system prompt 末尾。
   * 若尚无全局记忆则返回空字符串。
   */
  buildGlobalMemoryAppend(): string {
    const mem = getGlobalMemory();
    if (!mem) return '';
    return (
      '\n\n【以下是关于用户的全局核心记忆，这些信息跨越多次对话积累而来，' +
      '请结合这些信息与用户交流，不要主动提起这份记忆的存在】\n' +
      mem
    );
  }

  /**
   * 可 await 的全局记忆精炼。
   * 供 memory/index.ts 的离开对话流水线链式调用，保证在本地摘要完成后执行。
   * 若失败，日志记录但不抛出（不阻塞离开流程）。
   */
  async refineAsync(conversationId: string): Promise<void> {
    try {
      await this.doRefine(conversationId);
    } catch (e) {
      console.error('[GlobalMemory] 精炼失败（游标未推进，下次重试）:', (e as Error).message);
    }
  }

  // ── 内部实现 ─────────────────────────────────────────────

  /**
   * 核心精炼逻辑：
   * 1. 读取此对话的全部 memory_fragments
   * 2. 对比全局游标，取出尚未精炼的新片段
   * 3. 数量不足 minNewFragments 时跳过（避免频繁 LLM 调用）
   * 4. 读取当前全局记忆，调用 LLM 合并更新
   * 5. 仅 LLM 判断有新内容时才写入（"无变化" 时静默跳过）
   * 6. 无论有无新内容，都推进游标（防止对同一批片段重复精炼）
   *    注意：LLM 调用失败时不推进游标，留待下次重试
   */
  private async doRefine(conversationId: string): Promise<void> {
    const activeProvider = aiConfig.providers[aiConfig.activeProvider];
    if (!activeProvider) return;

    const allFragments = getMemoryFragments(conversationId);
    const cursor = getGlobalMemoryCursor(conversationId);
    const newFragments = allFragments.slice(cursor);

    if (newFragments.length < this.config.minNewFragments) {
      // 无新片段或数量不足阈值，跳过
      return;
    }

    const currentGlobal = getGlobalMemory();

    // provider 尝试顺序：当前激活 provider 优先，其次尝试其他已配置 provider（带 apiKey）
    const providerOrder = [
      aiConfig.activeProvider,
      ...Object.keys(aiConfig.providers).filter((k) => k !== aiConfig.activeProvider),
    ];

    let updated: string | null = null;
    let usedProviderKey: string | null = null;
    let lastErr: unknown = null;

    for (const key of providerOrder) {
      const p = aiConfig.providers[key];
      if (!p) continue;
      if (!p.apiKey) continue;

      try {
        updated = await refineGlobalMemory(
          p,
          currentGlobal,
          newFragments,
          this.config,
          conversationId
        );
        usedProviderKey = key;
        break;
      } catch (e) {
        lastErr = e;
        console.warn(
          `[GlobalMemory] provider=${key} 精炼失败，尝试下一个 provider: ${(e as Error).message}`
        );
      }
    }

    if (!usedProviderKey) {
      throw (lastErr instanceof Error
        ? lastErr
        : new Error('[GlobalMemory] 所有 provider 均精炼失败'));
    }

    // LLM 成功返回后推进游标（无论有无新内容）
    setGlobalMemoryCursor(conversationId, allFragments.length);

    if (updated) {
      setGlobalMemory(updated);
      console.info(
        `[GlobalMemory] 对话 ${conversationId.slice(0, 8)}… 全局记忆已更新（provider=${usedProviderKey}）` +
        `（整合 ${newFragments.length} 条新片段）`
      );
    } else {
      console.info(
        `[GlobalMemory] 对话 ${conversationId.slice(0, 8)}… 模型判断“无变化”（provider=${usedProviderKey}），仅推进游标`
      );
    }
  }
}

/** 全局单例，供 memory/index.ts 和 aiService 使用 */
export const globalMemoryManager = new GlobalMemoryManager();
