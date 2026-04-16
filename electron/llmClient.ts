/**
 * 底层 LLM HTTP 客户端
 *
 * 纯粹的 /chat/completions API 调用，不依赖工具注册表。
 * 可被 aiService（主聊天循环）和 Agent 模块（Planner / Verifier）共同使用，
 * 避免循环依赖。
 */

import type { LLMProviderConfig } from './ai.config';
import { buildProviderExtraBody } from './utils/textUtils';
import type { ChatMessage, ToolSchema, ToolCall } from './tools/types';

// 重新导出，让调用方无需直接依赖 tools/types
export type { ChatMessage, ToolSchema, ToolCall };

export interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: 'stop' | 'tool_calls' | 'length' | string;
  }>;
  error?: { message: string };
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * 向 /chat/completions 发起单次请求，返回原始响应。
 *
 * @param provider - LLM Provider 配置（含 baseUrl / apiKey / model 等）
 * @param messages - 消息列表
 * @param tools    - 传入工具 schema 数组时启用 function calling；不传则禁用
 * @param signal   - 可选的 AbortSignal，用于中断请求
 */
export async function fetchCompletion(
  provider: LLMProviderConfig,
  messages: ChatMessage[],
  tools?: ToolSchema[],
  signal?: AbortSignal,
): Promise<ChatCompletionResponse> {
  const withTools = tools && tools.length > 0;

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      max_tokens: provider.maxTokens ?? 1024,
      temperature: provider.temperature ?? 0.85,
      ...(withTools ? { tools } : {}),
      // 推理参数 + 服务商扩展字段（统一由 buildProviderExtraBody 处理）
      ...buildProviderExtraBody(provider),
    }),
    signal, // 🆕 传递中断信号
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  if (data.error) throw new Error(data.error.message);
  return data;
}
