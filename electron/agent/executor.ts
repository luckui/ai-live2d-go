/**
 * Executor：执行单个 AtomicStep
 *
 * 使用独立的工具调用循环（排除 agent_start 工具，防止递归调用）。
 * 按照步骤指令操作浏览器，返回执行结果摘要供 Verifier 使用。
 *
 * Phase 2 升级方向：
 *   - 支持传入不同 Provider（如轻量模型执行，强力模型验证）
 *   - 支持步骤级别的超时控制
 */

import type { LLMProviderConfig } from '../ai.config';
import { fetchCompletion } from '../llmClient';
import { stripThinkTags } from '../utils/textUtils';
import { isToolImageResult } from '../tools/types';
import type { ChatMessage, ContentPart } from '../tools/types';
import { getAgentRegistry } from './agentRegistry';
import type { AtomicStep } from './types';

/** 单步执行的最大工具调用轮数（低于主聊天的 10 轮，因为步骤是原子的） */
const STEP_MAX_ROUNDS = 6;

/** Executor 系统提示：专注执行，禁止自言自语 */
const EXECUTOR_SYSTEM =
  '你是专注的任务执行者。严格执行被分配的单一步骤，完成后用一句话报告结果，然后停止。\n' +
  '规则：\n' +
  '1. 直接调用工具执行操作，禁止在正文输出推理过程或自言自语\n' +
  '2. 步骤完成（或确认无法完成）后立即停止，不要做额外操作\n' +
  '3. 遇到表单先调用 browser_get_inputs，遇到按钮先调用 browser_get_buttons\n' +
  '4. 操作完成后调用 browser_screenshot 截图确认结果\n' +
  '5. 禁止导航到任务目标中未提及的网站（如搜索引擎、其他域名）；\n' +
  '   当前页面找不到所需内容时，报告"失败：页面未找到目标元素"，不要自行寻找替代方案\n' +
  '6. 若点击帖子标题(<a>)失败1次，不要反复点击：立即调用 browser_get_links 找对应 href，再 browser_open(href) 进入\n' +
  '7. 最终回复只需一句话：成功/失败 + 简短说明';

export async function executeStep(
  step: AtomicStep,
  provider: LLMProviderConfig,
): Promise<string> {
  const registry = getAgentRegistry();
  // 排除 agent_start 工具，防止 Executor 递归触发新的 Agent
  const tools = registry.getSchemasExcluding(['agent_start']);

  const toolHintsNote = step.toolHints?.length
    ? `\n💡 建议使用的工具：${step.toolHints.join(', ')}`
    : '';

  const msgBuf: ChatMessage[] = [
    { role: 'system', content: EXECUTOR_SYSTEM },
    {
      role: 'user',
      content: `当前步骤：${step.instruction}${toolHintsNote}\n\n成功标准：${step.expectedOutcome}`,
    },
  ];

  for (let round = 0; round < STEP_MAX_ROUNDS; round++) {
    const data = await fetchCompletion(provider, msgBuf, tools);
    const choice = data.choices[0];

    // 无工具调用 → 返回最终文本摘要
    if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls?.length) {
      return stripThinkTags(choice.message.content?.trim() ?? '（步骤执行完成，无文字输出）');
    }

    // 追加 assistant 消息
    msgBuf.push({
      role: 'assistant',
      content: choice.message.content,
      tool_calls: choice.message.tool_calls,
    });

    // 并行执行本轮所有工具
    const execResults = await Promise.all(
      choice.message.tool_calls.map(async (tc) => ({
        tc,
        result: await registry.execute(tc.function.name, tc.function.arguments),
      }))
    );

    // 回填结果
    for (const { tc, result } of execResults) {
      if (isToolImageResult(result)) {
        msgBuf.push({ role: 'tool', tool_call_id: tc.id, content: result.text });
        const imageParts: ContentPart[] = [
          { type: 'text', text: '（截图如下，请根据截图判断步骤是否完成）' },
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
        msgBuf.push({ role: 'tool', tool_call_id: tc.id, content: result as string });
      }
    }

    // 每轮回填后提醒保持简洁
    msgBuf.push({
      role: 'user',
      content: '【系统】根据工具结果，继续执行下一步或报告完成。禁止输出推理过程。',
    });
  }

  return `（步骤 ${step.id} 达到最大执行轮数 ${STEP_MAX_ROUNDS}，最终状态未确认）`;
}
