/// <reference types="node" />
import aiConfig, { LLMProviderConfig } from './ai.config';
import { addMessage, getRecentContext, getMessages, renameConversation } from './db';
import { toolRegistry } from './tools/index';
import type { ChatMessage, ContentPart, ToolCall } from './tools/types';
import { isToolImageResult } from './tools/types';
import { memoryManager, globalMemoryManager, recordMessageActivity } from './memory/index';
import { stripThinkTags, buildProviderExtraBody } from './utils/textUtils';

// ── OpenAI /chat/completions 响应类型 ─────────────────────

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: 'stop' | 'tool_calls' | 'length' | string;
  }>;
  error?: { message: string };
}

// ── 工具调用循环 ──────────────────────────────────────────

/** 单次向 /chat/completions 发起请求，返回原始响应 */
async function fetchCompletion(
  provider: LLMProviderConfig,
  messages: ChatMessage[],
  withTools: boolean
): Promise<ChatCompletionResponse> {
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
      ...(withTools ? { tools: toolRegistry.getSchemas() } : {}),
      // 推理参数 + 服务商扩展字段（统一由 buildProviderExtraBody 处理）
      ...buildProviderExtraBody(provider),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  if (data.error) throw new Error(data.error.message);
  return data;
}

/**
 * 调用 LLM 并自动处理工具调用循环。
 *
 * - 若 toolRegistry 为空，直接发起单次请求
 * - 若 LLM 返回 finish_reason === 'tool_calls'，并行执行所有工具，
 *   将结果以 `tool` 角色回填，再次请求，直到得到最终回复
 * - 设有最大循环轮数保护，防止意外死循环
 */
async function callWithToolLoop(
  provider: LLMProviderConfig,
  messages: ChatMessage[]
): Promise<string> {
  const withTools = !toolRegistry.isEmpty;
  // 在副本上操作，不污染调用方的数组
  const msgBuf: ChatMessage[] = [...messages];

  const MAX_ROUNDS = 10;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const data = await fetchCompletion(provider, msgBuf, withTools);
    const choice = data.choices[0];

    // ── 无工具调用 → 返回最终文本 ──
    if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls?.length) {
      return stripThinkTags(choice.message.content?.trim() ?? '');
    }

    // ── 有工具调用 → 追加 assistant 消息 ──
    msgBuf.push({
      role: 'assistant',
      content: choice.message.content,
      tool_calls: choice.message.tool_calls,
    });

    // ── 并行执行本轮所有工具 ──
    const execResults = await Promise.all(
      choice.message.tool_calls.map(async (tc) => ({
        tc,
        result: await toolRegistry.execute(tc.function.name, tc.function.arguments),
      }))
    );

    // ── 回填结果：普通文本 → tool 消息；图像 → tool 消息 + user 多模态消息 ──
    for (const { tc, result } of execResults) {
      if (isToolImageResult(result)) {
        // 1. tool 消息（文字描述，让模型知道工具已执行）
        msgBuf.push({ role: 'tool', tool_call_id: tc.id, content: result.text });
        // 2. user 多模态消息（注入图像，让视觉模型能"看到"截图）
        const imageParts: ContentPart[] = [
          { type: 'text', text: '（以下是截取的屏幕截图，请结合图像内容回答用户的问题）' },
          {
            type: 'image_url',
            image_url: {
              url: `data:${result.mimeType};base64,${result.imageBase64}`,
              detail: 'low',
            },
          },
        ];
        msgBuf.push({ role: 'user', content: imageParts });
      } else {
        // 普通文本结果
        msgBuf.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
    }
    // 继续循环，带上工具结果再请求
  }

  throw new Error(`工具调用轮数超过上限 (${MAX_ROUNDS})，请检查工具或模型配置`);
}

// ── 主接口 ────────────────────────────────────────────────

/**
 * 发送消息并返回 AI 回复。
 * - 自动保存 user / assistant 消息至 SQLite
 * - 维护 contextWindowRounds 轮短期记忆
 * - 若 toolRegistry 注册了工具，自动启用 Function Calling 并处理多轮工具循环
 * - 第一轮对话自动以用户首句命名对话
 */
export async function sendChatMessage(
  conversationId: string,
  userContent: string
): Promise<{ content: string; created_at: number }> {
  const provider = aiConfig.providers[aiConfig.activeProvider];
  if (!provider) throw new Error(`未找到 provider: ${aiConfig.activeProvider}`);

  // 1. 保存用户消息
  addMessage({ conversation_id: conversationId, role: 'user', content: userContent });

  // 2. 构建上下文（含刚保存的 user 消息）
  const context = getRecentContext(conversationId, aiConfig.contextWindowRounds);

  // 将本对话历史片段 + 全局核心记忆 一并 append 到角色提示词末尾
  const memoryAppend =
    memoryManager.buildMemoryAppend(conversationId) +
    globalMemoryManager.buildGlobalMemoryAppend();
  const systemContent = (provider.systemPrompt ?? '') + memoryAppend;

  const messages: ChatMessage[] = [
    ...(systemContent ? [{ role: 'system' as const, content: systemContent }] : []),
    ...context.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

  // 3. 调用 AI（含工具调用循环）
  let replyContent: string;
  try {
    replyContent = await callWithToolLoop(provider, messages);
  } catch (e) {
    replyContent = `（请求失败：${(e as Error).message}）`;
  }

  // 4. 保存 AI 最终回复
  const saved = addMessage({
    conversation_id: conversationId,
    role: 'assistant',
    content: replyContent,
  });

  // 记录消息活跃时间（供空闲调度器判断何时触发后台总结，不再在热路径调用 LLM）
  recordMessageActivity();

  // 6. 首轮对话自动用用户首句命名
  const allUserMsgs = getMessages(conversationId).filter((m) => m.role === 'user');
  if (allUserMsgs.length === 1) {
    const title = userContent.length > 18 ? userContent.slice(0, 18) + '…' : userContent;
    renameConversation(conversationId, title);
  }

  return { content: replyContent, created_at: saved.created_at };
}
