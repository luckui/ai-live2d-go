/**
 * 记忆总结层 - 唯一职责：调用 LLM 对一批对话消息生成精简摘要
 *
 * 完全无状态、无副作用，不依赖 DB，方便单独测试和替换实现。
 * 若未来需要换用更专门的摘要模型，只需改此文件。
 */

import type { LLMProviderConfig } from '../ai.config';
import type { DBMessage } from '../db';
import type { MemoryConfig, SummarizeResult } from './types';

// ── 提示词 ────────────────────────────────────────────────

/**
 * 摘要提示词设计原则：
 * 1. 角色定位明确（记忆整理助手，不是对话角色）
 * 2. 强调精简，给出字数上限
 * 3. 明确"无意义则回复'无'"，防止产生废话记忆
 * 4. 输出格式自由（不要求固定格式，让模型自然组织语言）
 */
const SUMMARY_SYSTEM_PROMPT = `你是一个对话记忆整理助手。你的任务是从一段对话记录中提炼出值得长期记忆的核心信息。`;

const SUMMARY_USER_TEMPLATE = (conversationText: string) => `
请阅读以下对话记录（约30轮），按照以下要求提炼长期记忆：

【要求】
- 总字数严格不超过150字，越精简越好
- 只记录有实际价值的信息，例如：用户的姓名、职业、兴趣爱好、明确表达的偏好、重要问题的结论、用户完成/计划的重要事项
- 完全忽略：日常问候、无意义闲聊、重复内容、工具调用过程、临时性的话题
- 如果这段对话没有任何值得长期记忆的内容，只回复"无"，不要附加任何解释

【对话记录】
${conversationText}
`.trim();

// ── 核心函数 ──────────────────────────────────────────────

/**
 * 对一批 DBMessage 调用 LLM 生成摘要。
 *
 * @param provider - 使用的 LLM 配置（与主对话相同 provider，不引入额外成本）
 * @param messages - 待总结的消息列表（仅 user / assistant）
 * @param config   - 记忆模块配置
 * @returns        - 精简摘要字符串，或 null（对话无有效信息）
 * @throws         - 网络/API 错误时抛出，由 manager 捕获处理
 */
export async function summarizeMessages(
  provider: LLMProviderConfig,
  messages: DBMessage[],
  config: MemoryConfig
): Promise<SummarizeResult> {
  if (messages.length === 0) return null;

  // 构建对话文本，截断过长消息内容防止 token 超限
  const conversationText = messages
    .map((m) => {
      const role = m.role === 'user' ? '用户' : '助手';
      const content =
        m.content.length > config.messageContentMaxLength
          ? m.content.slice(0, config.messageContentMaxLength) + '…'
          : m.content;
      return `${role}: ${content}`;
    })
    .join('\n');

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: SUMMARY_USER_TEMPLATE(conversationText) },
      ],
      max_tokens: config.summaryMaxTokens,
      temperature: config.summaryTemperature,
      // 总结不需要工具调用
    }),
  });

  if (!response.ok) {
    throw new Error(`记忆总结 HTTP ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    error?: { message: string };
  };

  if (data.error) throw new Error(data.error.message);

  const text = data.choices[0]?.message.content?.trim() ?? '';
  // "无" 或空白 → 无有效记忆
  if (!text || text === '无') return null;
  return text;
}
