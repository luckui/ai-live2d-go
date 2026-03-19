/**
 * Verifier：验证步骤执行结果，防止 AI 幻觉（自报成功实际失败）
 *
 * 每步执行完后：
 *   1. 截取当前页面截图（独立于 Executor 上下文）
 *   2. 将截图 + expectedOutcome + Executor 摘要发给 LLM 判断
 *   3. 返回 { judgement: 'pass'|'fail'|'uncertain', reason }
 *
 * 设计原则：
 *   - Verifier 与 Executor 使用独立的 LLM 调用，避免上下文污染
 *   - 若模型不支持视觉（截图注入失败），降级为纯文本验证
 *   - uncertain = 无法明确判断，由 Orchestrator 决定是否继续
 *
 * Phase 2 升级方向：
 *   - 支持指定专用 Verifier Provider（如强制用强力模型验证）
 *   - 支持 DOM 状态验证（不只依赖截图）
 */

import { nativeImage } from 'electron';
import type { LLMProviderConfig } from '../ai.config';
import { fetchCompletion } from '../llmClient';
import { stripThinkTags } from '../utils/textUtils';
import { browserSession } from '../tools/impl/browserSession';

export interface VerifyResult {
  judgement: 'pass' | 'fail' | 'uncertain';
  reason: string;
}

const VERIFIER_SYSTEM =
  '你是执行结果验证者。根据截图和执行摘要，判断指定步骤是否成功完成。\n' +
  '只输出以下 JSON 格式（不要输出任何其他内容）：\n' +
  '{ "judgement": "pass" | "fail" | "uncertain", "reason": "判断理由（中文，一句话）" }\n\n' +
  '判断标准：\n' +
  '- pass:      截图明确显示预期结果已达成\n' +
  '- fail:      截图明确显示操作失败、页面未变化、或出现错误提示\n' +
  '- uncertain: 截图无法明确判断（页面加载中、弹窗遮挡、截图不清晰等）';

/** 截取当前页面截图，返回 base64 字符串；失败返回 null */
async function takeScreenshot(): Promise<string | null> {
  const page = browserSession.currentPage;
  if (!page) return null;

  try {
    const rawBuffer = await page.screenshot({ type: 'png', fullPage: false });
    let img = nativeImage.createFromBuffer(rawBuffer);
    const { width } = img.getSize();
    if (width > 1280) {
      img = nativeImage.createFromBuffer(img.resize({ width: 1280 }).toPNG());
    }
    return img.toPNG().toString('base64');
  } catch {
    return null;
  }
}

export async function verifyStep(
  expectedOutcome: string,
  executorSummary: string,
  provider: LLMProviderConfig,
): Promise<VerifyResult> {
  // 没有浏览器页面（纯文本任务），直接根据摘要文字判断
  const page = browserSession.currentPage;
  if (!page) {
    return textOnlyVerify(expectedOutcome, executorSummary, provider);
  }

  const imageBase64 = await takeScreenshot();

  // 构造 Verifier 请求（有截图用视觉，无截图降级纯文本）
  try {
    const userContent = imageBase64
      ? [
          {
            type: 'text' as const,
            text: `预期结果：${expectedOutcome}\n执行摘要：${executorSummary}\n请看截图判断：`,
          },
          {
            type: 'image_url' as const,
            image_url: {
              url: `data:image/png;base64,${imageBase64}`,
              detail: 'low' as const,
            },
          },
        ]
      : `预期结果：${expectedOutcome}\n执行摘要：${executorSummary}\n请根据摘要判断是否成功：`;

    const data = await fetchCompletion(
      { ...provider, maxTokens: 256, temperature: 0.1 },
      [
        { role: 'system', content: VERIFIER_SYSTEM },
        { role: 'user', content: userContent },
      ],
    );

    return parseVerifyResponse(stripThinkTags(data.choices[0]?.message.content?.trim() ?? ''));
  } catch (e) {
    return {
      judgement: 'uncertain',
      reason: `Verifier 请求失败: ${(e as Error).message.slice(0, 100)}`,
    };
  }
}

/** 纯文本验证（无浏览器 / 模型不支持视觉时的降级路径） */
async function textOnlyVerify(
  expectedOutcome: string,
  executorSummary: string,
  provider: LLMProviderConfig,
): Promise<VerifyResult> {
  try {
    const data = await fetchCompletion(
      { ...provider, maxTokens: 128, temperature: 0.1 },
      [
        { role: 'system', content: VERIFIER_SYSTEM },
        {
          role: 'user',
          content: `预期结果：${expectedOutcome}\n执行摘要：${executorSummary}\n（无截图，请根据摘要文字判断）`,
        },
      ],
    );
    return parseVerifyResponse(stripThinkTags(data.choices[0]?.message.content?.trim() ?? ''));
  } catch {
    // 最终兜底：从摘要关键词判断
    return heuristicVerify(executorSummary);
  }
}

/** 解析 Verifier 输出的 JSON */
function parseVerifyResponse(raw: string): VerifyResult {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { judgement?: string; reason?: string };
      const judgement = (['pass', 'fail', 'uncertain'].includes(parsed.judgement ?? ''))
        ? (parsed.judgement as 'pass' | 'fail' | 'uncertain')
        : 'uncertain';
      return { judgement, reason: parsed.reason ?? raw.slice(0, 100) };
    } catch { /* fall through */ }
  }
  // 无 JSON 时关键词匹配
  return heuristicVerify(raw);
}

/** 关键词启发式判断（最后兜底） */
function heuristicVerify(text: string): VerifyResult {
  const lower = text.toLowerCase();
  if (lower.includes('成功') || lower.includes('完成') || lower.includes('pass')) {
    return { judgement: 'pass', reason: text.slice(0, 100) };
  }
  if (lower.includes('失败') || lower.includes('错误') || lower.includes('fail')) {
    return { judgement: 'fail', reason: text.slice(0, 100) };
  }
  return { judgement: 'uncertain', reason: text.slice(0, 100) };
}
