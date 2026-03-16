/// <reference types="node" />
import aiConfig, { LLMProviderConfig } from './ai.config';
import { addMessage, getRecentContext, getMessages, renameConversation } from './db';

// ── 内部类型 ──────────────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ── OpenAI-compatible 请求 ────────────────────────────────

async function callOpenAICompatible(
  provider: LLMProviderConfig,
  messages: ChatMessage[]
): Promise<string> {
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
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    error?: { message: string };
  };

  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content.trim();
}

// ── 主接口 ────────────────────────────────────────────────

/**
 * 发送消息并返回 AI 回复。
 * - 自动保存 user / assistant 消息至 SQLite
 * - 维护 contextWindowRounds 轮短期记忆
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
  const messages: ChatMessage[] = [
    ...(provider.systemPrompt
      ? [{ role: 'system' as const, content: provider.systemPrompt }]
      : []),
    ...context.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

  // 3. 调用 AI
  let replyContent: string;
  try {
    replyContent = await callOpenAICompatible(provider, messages);
  } catch (e) {
    replyContent = `（请求失败：${(e as Error).message}）`;
  }

  // 4. 保存 AI 回复
  const saved = addMessage({
    conversation_id: conversationId,
    role: 'assistant',
    content: replyContent,
  });

  // 5. 首轮对话自动用用户首句命名
  const allUserMsgs = getMessages(conversationId).filter((m) => m.role === 'user');
  if (allUserMsgs.length === 1) {
    const title = userContent.length > 18 ? userContent.slice(0, 18) + '…' : userContent;
    renameConversation(conversationId, title);
  }

  return { content: replyContent, created_at: saved.created_at };
}
