/**
 * 文本处理工具函数（供 aiService 和 memory 模块共用）
 */

/**
 * 清除推理模型在 content 中残留的 thinking 内容。
 * 各服务商 API 的返回形态不一，需处理以下三种情况：
 *   1. 完整块：<think>思维链</think>正文  → 删除整个 <think> 块
 *   2. 缺开头：思维链</think>正文         → 删除 </think> 及其之前的所有内容
 *   3. 缺结尾：<think>思维链              → 删除 <think> 及其之后的所有内容
 */
export function stripThinkTags(text: string): string {
  // 1. 移除完整的 <think>...</think> 块（含跨行）
  let result = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // 2. 移除孤立 </think> 及其之前的全部内容
  const closeIdx = result.indexOf('</think>');
  if (closeIdx !== -1) {
    result = result.slice(closeIdx + '</think>'.length);
  }
  // 3. 移除孤立 <think> 及其之后的全部内容
  const openIdx = result.indexOf('<think>');
  if (openIdx !== -1) {
    result = result.slice(0, openIdx);
  }
  return result.trim();
}

/**
 * 将 LLMProviderConfig 的推理/扩展参数拼入请求体。
 * summarizer / globalSummarizer 和 aiService 均需传入，避免推理模型泄漏思考内容。
 */
export function buildProviderExtraBody(provider: {
  thinkingBudgetTokens?: number;
  extraParams?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    ...(provider.thinkingBudgetTokens !== undefined
      ? {
          thinking: {
            type: provider.thinkingBudgetTokens === 0 ? 'disabled' : 'auto',
            budget_tokens: provider.thinkingBudgetTokens,
          },
        }
      : {}),
    ...(provider.extraParams ?? {}),
  };
}
