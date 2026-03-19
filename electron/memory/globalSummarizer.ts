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
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── 提示词 ────────────────────────────────────────────────

const REFINE_SYSTEM_PROMPT =
  `你是一个长期记忆整理助手。你的任务是维护一份关于用户的全局核心记忆档案，并在有新信息时将其合并更新。` +
  `\n只输出最终记忆正文或“无变化”，禁止输出思考过程、步骤、工具说明、英文标题。` +
  `\n禁止输出任何提示词回显内容，例如 Role/Task/Input/Constraints 等字段。` +
  `\n优先使用中文，按要点精炼输出。`;

const RESCUE_SYSTEM_PROMPT =
  `你是中文用户画像整理器。` +
  `\n只输出一段中文记忆正文，不要 Markdown，不要项目符号，不要英文字段名，不要解释。` +
  `\n只保留用户稳定信息：身份、长期偏好、长期目标、重要事件。`;

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
  // 超长不直接判污染：先在主流程做裁剪。
  // 仅对“极端超长”做兜底拦截（通常是思考内容泄漏）。
  if (text.length > maxChars * 10) return true;
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

function sanitizeRefineOutput(text: string): string {
  const markerRegex = /(Thinking Process|thinking process|Analyze the|\*\*Analyze|# Tools|raise_exception|task:\s*Extract|1\.\s*\*\*Analyze)/i;
  const promptEchoRegex = /(\*\*\s*(Role|Task|Input|Constraints?)\s*:?\s*\*\*|\b(Role|Task|Input|Constraints?)\s*:)/i;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*•]\s+/, ''))
    .filter(Boolean)
    .filter((l) => !/^```/.test(l))
    .filter((l) => !/^#{1,6}\s*/.test(l))
    // 关键：只要一行中出现污染关键词，就整行剔除（不要求出现在行首）
    .filter((l) => !markerRegex.test(l))
    // 过滤提示词回显元信息
    .filter((l) => !promptEchoRegex.test(l));

  return lines.join('\n').trim();
}

function looksLikePromptEcho(text: string): boolean {
  const badMarkers = [
    /\bLanguage\s*:/i,
    /\bWord\s*Count\s*:/i,
    /\bContent\s*Focus\s*:/i,
    /\bRules\s*:/i,
    /\bRole\s*:/i,
    /\bTask\s*:/i,
    /\bInput\s*:/i,
    /\bConstraints?\s*:/i,
    /Only\s+output\s+Chinese\s+text/i,
    /No\s+explanations?/i,
    /Word\s+Count/i,
    /Content\s+Focus/i,
    /Length\s*:\s*Under\s*\d+/i,
  ];
  return badMarkers.some((r) => r.test(text));
}

function looksInvalidGlobalMemory(text: string): boolean {
  if (!text) return true;
  if (looksLikePromptEcho(text)) return true;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const ascii = (text.match(/[A-Za-z]/g) || []).length;
  // 全局记忆应以中文事实为主，若英文比例过高通常是模板回显
  if (ascii > 0 && cjk > 0 && ascii / (ascii + cjk) > 0.35) return true;
  // 纯英文也不接受
  if (cjk < 8) return true;
  return false;
}

function buildRescueUserPrompt(
  current: string | null,
  newFragments: MemoryFragment[],
  maxChars: number
): string {
  const currentSection = current
    ? `当前全局记忆（可参考但不要复述规则）：\n${current}`
    : '当前全局记忆为空。';

  const fragmentsSection = newFragments
    .map((f, i) => `片段${i + 1}：${f.content}`)
    .join('\n');

  return [
    currentSection,
    '',
    '请基于以下片段输出“用户核心记忆正文”（只要正文，不要标题/列表/规则说明）：',
    fragmentsSection,
    '',
    `要求：中文；不超过${maxChars}字；仅保留稳定身份、偏好、长期计划、重要事件；去掉天气/网页瞬时信息。`,
  ].join('\n');
}

function buildHeuristicFallback(newFragments: MemoryFragment[], maxChars: number): string | null {
  const chunks: string[] = [];
  for (const f of newFragments) {
    const parts = (f.content || '').split(/[。；\n]/).map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      if (/用户|助手|Hiyori|luck|luckui|GeoLingua|华东师范|研究生|B站|UP主|开发/.test(p)) {
        chunks.push(p);
      }
    }
  }

  const uniq = Array.from(new Set(chunks));
  if (uniq.length === 0) return null;

  let text = uniq.join('；');
  if (text.length > maxChars) text = text.slice(0, maxChars);
  return text.trim();
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
  config: GlobalMemoryConfig,
  debugTag?: string
): Promise<string | null> {
  const reqUrl = `${provider.baseUrl}/chat/completions`;

  const RETRYABLE = new Set([429, 502, 503, 504]);
  const MAX_ATTEMPTS = 3;
  let response: Response | null = null;
  let lastErr: unknown = null;

  async function requestWithRetry(messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<Response> {
    const reqBody = JSON.stringify({
      model: provider.model,
      messages,
      max_tokens: config.refinementMaxTokens,
      temperature: config.refinementTemperature,
      // 透传推理参数（防止思考内容污染全局记忆）
      ...buildProviderExtraBody(provider),
    });

    let localResponse: Response | null = null;
    let localErr: unknown = null;

    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      try {
        localResponse = await fetch(reqUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${provider.apiKey}`,
          },
          body: reqBody,
        });

        if (localResponse.ok) return localResponse;

        if (!RETRYABLE.has(localResponse.status) || i === MAX_ATTEMPTS) {
          throw new Error(`全局记忆精炼 HTTP ${localResponse.status}: ${await localResponse.text()}`);
        }

        const waitMs = i * 800;
        console.warn(`[GlobalMemory] 精炼请求失败（HTTP ${localResponse.status}），${waitMs}ms 后重试（${i}/${MAX_ATTEMPTS}）`);
        await new Promise((r) => setTimeout(r, waitMs));
      } catch (e) {
        localErr = e;
        if (i === MAX_ATTEMPTS) break;
        const waitMs = i * 800;
        console.warn(`[GlobalMemory] 精炼请求异常，${waitMs}ms 后重试（${i}/${MAX_ATTEMPTS}）: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    throw (localErr instanceof Error
      ? localErr
      : new Error('[GlobalMemory] 精炼请求失败（无可用响应）'));
  }

  for (let i = 1; i <= 1; i++) {
    try {
      response = await requestWithRetry([
        { role: 'system', content: REFINE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildRefineUserPrompt(current, newFragments, config.globalMemoryMaxChars),
        },
      ]);
      break;
    } catch (e) {
      lastErr = e;
      break;
    }
  }

  if (!response?.ok) {
    throw (lastErr instanceof Error
      ? lastErr
      : new Error('[GlobalMemory] 精炼请求失败（无可用响应）'));
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    error?: { message: string };
  };

  if (data.error) throw new Error(data.error.message);

  const raw = data.choices[0]?.message.content?.trim() ?? '';
  let text = sanitizeRefineOutput(stripThinkTags(raw)).trim();

  // 模板回显修复：若像“Language/Rules/Task”等模板字段，发起一次救援重试
  if (text && looksLikePromptEcho(text)) {
    console.warn('[GlobalMemory] 检测到提示词模板回显，执行二次精炼重试');
    const retryResp = await requestWithRetry([
      { role: 'system', content: RESCUE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildRescueUserPrompt(current, newFragments, config.globalMemoryMaxChars),
      },
    ]);

    const retryData = (await retryResp.json()) as {
      choices: Array<{ message: { content: string } }>;
      error?: { message: string };
    };
    if (retryData.error) throw new Error(retryData.error.message);

    const retryRaw = retryData.choices[0]?.message.content?.trim() ?? '';
    text = sanitizeRefineOutput(stripThinkTags(retryRaw)).trim();
  }

  if (!text || text === '无变化') return null;

  // 长度治理：允许模型偶发超长，先裁剪再进入污染检测。
  if (text.length > config.globalMemoryMaxChars) {
    console.warn(
      `[GlobalMemory] 精炼结果超长（${text.length}），将裁剪到 ${config.globalMemoryMaxChars} 字`
    );
    text = text.slice(0, config.globalMemoryMaxChars);
  }

  // 如果结果不合格（模板回显/英文比例过高），使用本地兜底摘要，避免把垃圾写入全局记忆
  if (looksInvalidGlobalMemory(text)) {
    const fallback = buildHeuristicFallback(newFragments, config.globalMemoryMaxChars);
    if (fallback) {
      console.warn('[GlobalMemory] 精炼结果不合格，已启用本地兜底摘要');
      return fallback;
    }
  }

  // 污染检测：全局记忆不应含 LLM 思考/指令关键词
  // 先做一次“二次清洗”再判，尽量挽救可用正文。
  if (isRefinePolluted(text, config.globalMemoryMaxChars)) {
    text = sanitizeRefineOutput(text);
  }

  if (isRefinePolluted(text, config.globalMemoryMaxChars)) {
    const appdata = process.env['APPDATA'];
    if (appdata) {
      const dir = join(appdata, 'live2d-desktop-pet', 'global-refine-debug');
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const tag = debugTag ? debugTag.slice(0, 8) : 'unknown';
      const file = join(dir, `${stamp}-${tag}.txt`);
      const payload = [
        `time=${new Date().toISOString()}`,
        `provider=${provider.name} model=${provider.model}`,
        `raw_len=${raw.length}`,
        `stripped_len=${stripThinkTags(raw).length}`,
        `final_len=${text.length}`,
        '',
        '===== RAW =====',
        raw,
        '',
        '===== STRIPPED =====',
        stripThinkTags(raw),
        '',
        '===== FINAL(TEXT) =====',
        text,
      ].join('\n');
      writeFileSync(file, payload, 'utf8');
      console.warn(`[GlobalMemory] 已写入污染调试文件: ${file}`);
    }

    // 关键修复：污染结果必须视为失败并抛错，避免上层推进 global_mem_cursor
    // 否则会出现“全局记忆为空，但游标已前进，永远不再重试”的状态。
    const markers = [
      'Thinking Process',
      'thinking process',
      'Analyze the',
      '**Analyze',
      '# Tools',
      'raise_exception',
    ].filter((m) => text.includes(m));
    const preview = text.slice(0, 160).replace(/\r?\n/g, ' ');
    throw new Error(
      `[GlobalMemory] 精炼结果疑似污染（长度: ${text.length}, 命中: ${markers.join('|') || 'unknown'}）` +
      `，预览: ${preview}`
    );
  }
  if (!text || text === '无变化') return null;

  // 最终兜底：依然不合格则拒绝写入，等待下次重试
  if (looksInvalidGlobalMemory(text)) {
    throw new Error('[GlobalMemory] 精炼结果不合格（疑似模板回显/英文结构），本轮不写入');
  }
  return text;
}
