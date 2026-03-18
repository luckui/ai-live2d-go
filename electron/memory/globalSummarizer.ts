/**
 * 全局记忆精炼层 - 唯一职责：调用 LLM 将新片段合并进全局核心记忆
 *
 * 完全无状态、无副作用，不依赖 DB，方便独立测试和替换。
 * 若未来需要换用更专业的摘要模型，只需改此文件。
 */

import type { LLMProviderConfig } from '../ai.config';
import type { MemoryFragment } from '../db';
import type { GlobalMemoryConfig } from './types';
import { stripThinkTags, buildProviderExtraBody } from '../utils/textUtils';

// ── 提示词 ────────────────────────────────────────────────

const REFINE_SYSTEM_PROMPT = `你是一个长期记忆整理助手。你的任务是维护一份关于用户的全局核心记忆档案，并在有新信息时将其合并更新。`;

function buildRefineUserPrompt(
  current: string | null,
  newFragments: MemoryFragment[],
  maxChars: number
): string {
  const currentSection = current
    ? `【当前全局记忆档案】\n${current}`
    : `【当前全局记忆档案】\n（尚无全局记忆，请从下方新片段中提炼）`;

  const fragmentsSection = newFragments
    .map((f, i) => `片段 ${i + 1}：${f.content}`)
    .join('\n');

  return `
${currentSection}

【需要整合的新对话记忆片段】
${fragmentsSection}

【任务要求】
请将新片段中有价值的信息合并进全局记忆档案，重点记录：
- 用户的身份信息（姓名、年龄、职业、所在地等）
- 用户的长期兴趣、习惯、偏好
- 用户的情感状态或重大心理变化
- 具有纪念意义或难以忘怀的重要事件
- 用户明确表达希望被记住的事情

【规则】
- 总字数严格不超过 ${maxChars} 字，精简是核心要求
- 已在当前档案中的信息无需重复写入，只写新增或更新的部分
- 如果新片段中没有任何值得纳入全局记忆的内容，只回复"无变化"
- 直接输出记忆档案全文（合并后），不要加任何解释性前缀
`.trim();
}

// ── 污染检测 ──────────────────────────────────────────────

function isRefinePolluted(text: string, maxChars: number): boolean {
  if (text.length > maxChars * 4) return true;
  const pollutionMarkers = [
    'Thinking Process',
    'thinking process',
    'Analyze the',
    '**Analyze',
    '# Tools',
    'raise_exception',
  ];
  return pollutionMarkers.some((marker) => text.includes(marker));
}

// ── 核心函数 ──────────────────────────────────────────────

/**
 * 将新片段精炼合并进全局记忆。
 *
 * @param provider     - LLM 配置
 * @param current      - 当前全局记忆文本（null 表示尚无）
 * @param newFragments - 本次新增的对话记忆片段列表
 * @param config       - 全局记忆配置
 * @returns            - 更新后的全局记忆全文，或 null（无需变化）
 */
export async function refineGlobalMemory(
  provider: LLMProviderConfig,
  current: string | null,
  newFragments: MemoryFragment[],
  config: GlobalMemoryConfig
): Promise<string | null> {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: REFINE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildRefineUserPrompt(current, newFragments, config.globalMemoryMaxChars),
        },
      ],
      max_tokens: config.refinementMaxTokens,
      temperature: config.refinementTemperature,
      // 透传推理参数（防止思考内容污染全局记忆）
      ...buildProviderExtraBody(provider),
    }),
  });

  if (!response.ok) {
    throw new Error(`全局记忆精炼 HTTP ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    error?: { message: string };
  };

  if (data.error) throw new Error(data.error.message);

  const raw = data.choices[0]?.message.content?.trim() ?? '';
  const text = stripThinkTags(raw);
  if (!text || text === '无变化') return null;
  // 污染检测：全局记忆不应含 LLM 思考/指令关键词
  if (isRefinePolluted(text, config.globalMemoryMaxChars)) {
    console.warn('[GlobalMemory] 精炼结果疑似被思考内容污染，已丢弃（长度:', text.length, '）');
    return null;
  }
  return text;
}
