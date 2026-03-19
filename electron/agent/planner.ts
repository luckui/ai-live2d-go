/**
 * Planner：将用户目标分解为有序的 AtomicStep 列表
 *
 * - 使用低温度（0.3）保证输出稳定性
 * - 注入当前可用工具清单，让 AI 规划出可执行的步骤
 * - JSON 解析失败时退化为单步计划（整个目标一次执行）
 *
 * Phase 2 升级方向：
 *   - 支持指定专用 Planner Provider（如强制用 doubao 做规划）
 *   - 支持用户审查并修改计划（交互式确认）
 */

import type { LLMProviderConfig } from '../ai.config';
import { fetchCompletion } from '../llmClient';
import { stripThinkTags } from '../utils/textUtils';
import { getAgentRegistry } from './agentRegistry';
import type { TaskPlan, AtomicStep } from './types';

/** 生成可用工具摘要，注入 Planner prompt */
function buildToolSummary(): string {
  const schemas = getAgentRegistry().getSchemasExcluding(['agent_start']);
  return schemas
    .map(s => `  - ${s.function.name}: ${s.function.description.slice(0, 80).replace(/\n/g, ' ')}`)
    .join('\n');
}

const PLANNER_SYSTEM = `你是任务规划专家。将用户目标分解为若干原子执行步骤，每步只做一件事。

可用工具列表：
{TOOL_SUMMARY}

【输出格式】严格输出以下 JSON，不要输出任何其他内容：
{
  "goal": "用户目标",
  "steps": [
    {
      "id": "step_1",
      "description": "步骤简短说明（中文，用户可见，15字以内）",
      "instruction": "给执行AI的详细操作指令：用什么工具、选什么元素、输入什么内容、预期看到什么",
      "expectedOutcome": "成功判断标准：截图里应该看到什么（页面跳转/元素出现/文字变化）",
      "toolHints": ["browser_find", "browser_click"],
      "retryLimit": 2
    }
  ]
}

【规划规则】
1. 每步只做一件事（单次操作或一组紧密关联的操作）
2. instruction 足够具体，假设执行者完全不知道背景
3. expectedOutcome 必须可视化验证（截图能判断）
4. 查找任何按钮/链接前，先用 browser_find(keyword) 定位元素（不需要区分是 button 还是 a 标签）
5. 表单填写：先 browser_get_inputs，再 browser_type / browser_type_rich
6. 每步操作后截图确认（toolHints 里加 browser_screenshot）
7. 严禁输出“询问用户/等待用户回复/请用户确认”等对话型步骤，步骤必须是可执行的浏览器操作
8. 对“去帖子并评论”这类组合任务，至少拆成 2-4 个步骤（找帖→进帖→评论→提交），禁止只给 1 步`;

const REPLANNER_SYSTEM = `你是任务重规划专家。前一个执行计划的某个步骤失败了，你需要从当前页面状态出发，制定新的补救计划以继续完成原始目标。

可用工具列表：
{TOOL_SUMMARY}

【输出格式】严格输出以下 JSON，不要输出任何其他内容（格式与初始规划相同）：
{
  "goal": "原始目标",
  "steps": [ { "id": "step_1", "description": "...", "instruction": "...", "expectedOutcome": "...", "toolHints": [], "retryLimit": 2 } ]
}

【重规划规则】
1. 只规划"剩余目标"，已成功的步骤不要重复
2. 从当前页面状态开始（第一步通常先截图确认当前状态）
3. 针对失败原因给出不同策略（如：换选择器、换点击方式、先处理遮挡弹窗）
4. 最多生成3步，保持计划简洁可执行`;

export async function createPlan(goal: string, provider: LLMProviderConfig): Promise<TaskPlan> {
  const template = buildTemplatePlan(goal);

  const systemPrompt = PLANNER_SYSTEM.replace('{TOOL_SUMMARY}', buildToolSummary());

  let rawJson: string;
  try {
    const data = await fetchCompletion(
      { ...provider, maxTokens: 2048, temperature: 0.3 },
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请为以下目标制定执行计划：\n${goal}` },
      ],
    );
    rawJson = stripThinkTags(data.choices[0]?.message.content?.trim() ?? '');
  } catch (e) {
    console.error('[Planner] LLM 请求失败，退化为单步计划:', e);
    return fallbackPlan(goal);
  }

  // 提取 JSON 块（可能被包裹在 ```json ... ``` 中）
  const jsonMatch = rawJson.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn('[Planner] 未找到 JSON 结构，退化为单步计划。输出前200字:', rawJson.slice(0, 200));
    return fallbackPlan(goal);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { goal?: string; steps?: Partial<AtomicStep>[] };
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      console.warn('[Planner] steps 为空，退化为单步计划');
      return template ?? fallbackPlan(goal);
    }

    const plan: TaskPlan = {
      goal,
      steps: parsed.steps.map((s, i) => ({
        id:              s.id              ?? `step_${i + 1}`,
        description:     s.description     ?? `步骤 ${i + 1}`,
        instruction:     s.instruction     ?? goal,
        expectedOutcome: s.expectedOutcome ?? '操作完成，页面无报错',
        toolHints:       s.toolHints,
        retryLimit:      s.retryLimit      ?? 2,
      })),
      createdAt: Date.now(),
    };
    return sanitizePlan(plan, goal) ?? template ?? fallbackPlan(goal);
  } catch {
    console.warn('[Planner] JSON.parse 失败，退化为单步计划');
    return template ?? fallbackPlan(goal);
  }
}

/** 规划失败时的兜底：整个目标作为单步直接执行 */
function fallbackPlan(goal: string): TaskPlan {
  return {
    goal,
    steps: [{
      id: 'step_1',
      description: goal.slice(0, 30),
      instruction: goal,
      expectedOutcome: '任务完成，页面状态符合预期',
      retryLimit: 2,
    }],
    createdAt: Date.now(),
  };
}

/** 判断步骤是否是“不可执行”的对话型描述 */
function isConversationStep(s: AtomicStep): boolean {
  const text = `${s.description}\n${s.instruction}`.toLowerCase();
  return /(询问用户|让用户|请用户|等待用户|用户回复|确认用户|ask\s*user|wait\s*for\s*user|clarify)/i.test(text);
}

/** 对解析出的计划做安全清洗；若计划不可用返回 null */
function sanitizePlan(plan: TaskPlan, goal: string): TaskPlan | null {
  let steps = plan.steps.filter((s) => !isConversationStep(s));

  // 评论类组合任务至少 2 步，否则判定为低质量计划
  const isPostCommentGoal = /(帖子|贴子).*(评论|回复)|(评论|回复).*(帖子|贴子)/.test(goal);
  if (isPostCommentGoal && steps.length < 2) return null;

  if (steps.length === 0) return null;

  steps = steps.map((s, i) => ({
    ...s,
    id: s.id || `step_${i + 1}`,
    description: s.description || `步骤 ${i + 1}`,
    instruction: s.instruction || goal,
    expectedOutcome: s.expectedOutcome || '操作完成，页面无报错',
    retryLimit: s.retryLimit ?? 2,
  }));

  return { ...plan, steps, createdAt: Date.now() };
}

/** 常见目标模板：去指定帖子并评论 */
function buildTemplatePlan(goal: string): TaskPlan | null {
  if (!/(帖子|贴子).*(评论|回复)|(评论|回复).*(帖子|贴子)/.test(goal)) return null;

  const titleMatch = goal.match(/帖子[“"'「『]?([^”"'」』]+)[”"'」』]?/);
  const commentMatch = goal.match(/评论(?:一句|一条|：|:)?[“"'「『]?([^”"'」』]+)[”"'」』]?/);
  const postTitle = titleMatch?.[1]?.trim() ?? '目标帖子';
  const commentText = commentMatch?.[1]?.trim() ?? '已读，支持一下！';

  return {
    goal,
    steps: [
      {
        id: 'step_1',
        description: '站内定位目标帖子',
        instruction:
          `先调用 browser_get_state 确认仍在当前网站；禁止用 browser_open 做全网搜索。` +
          `然后调用 browser_find(keyword="${postTitle}") 查找帖子标题或相关链接；` +
          `如页面有站内搜索框，优先 browser_find("搜索") + browser_type 输入"${postTitle}"后再查找。`,
        expectedOutcome: `页面中能看到标题包含“${postTitle}”的帖子条目或链接`,
        toolHints: ['browser_get_state', 'browser_find', 'browser_type', 'browser_screenshot'],
        retryLimit: 2,
      },
      {
        id: 'step_2',
        description: '进入帖子详情页',
        instruction:
          `点击标题为“${postTitle}”的帖子链接进入详情。若 browser_click 失败，` +
          `立即调用 browser_get_links 获取对应 href，再用 browser_open(href) 直接进入，避免反复点击。`,
        expectedOutcome: `页面 URL 或正文区域显示已进入帖子“${postTitle}”详情`,
        toolHints: ['browser_find', 'browser_click', 'browser_get_links', 'browser_open', 'browser_screenshot'],
        retryLimit: 2,
      },
      {
        id: 'step_3',
        description: '输入并提交评论',
        instruction:
          `调用 browser_find(keyword="评论") 定位评论入口/输入框；` +
          `普通输入框用 browser_type，富文本用 browser_type_rich，输入“${commentText}”；` +
          `再定位并点击“发布/提交/发送”按钮。`,
        expectedOutcome: `页面出现“${commentText}”评论内容或出现评论发布成功提示`,
        toolHints: ['browser_find', 'browser_get_inputs', 'browser_type', 'browser_type_rich', 'browser_click', 'browser_screenshot'],
        retryLimit: 2,
      },
    ],
    createdAt: Date.now(),
  };
}

/**
 * 步骤失败后重规划：基于当前状态和失败上下文，生成补救计划
 *
 * @param goal             原始目标
 * @param provider         LLM 配置
 * @param completedDescs   已成功步骤的描述列表
 * @param failedDesc       失败步骤的描述
 * @param failureReason    Verifier 给出的失败原因
 */
export async function replanFromFailure(
  goal: string,
  provider: LLMProviderConfig,
  completedDescs: string[],
  failedDesc: string,
  failureReason: string,
): Promise<TaskPlan> {
  const systemPrompt = REPLANNER_SYSTEM.replace('{TOOL_SUMMARY}', buildToolSummary());

  const completedSummary = completedDescs.length > 0
    ? `已完成步骤：\n${completedDescs.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}`
    : '尚未完成任何步骤';

  const userMsg =
    `原始目标：${goal}\n\n` +
    `${completedSummary}\n\n` +
    `失败步骤：${failedDesc}\n` +
    `失败原因：${failureReason}\n\n` +
    `请从当前页面状态出发，制定补救计划以继续完成原始目标中尚未完成的部分。`;

  let rawJson: string;
  try {
    const data = await fetchCompletion(
      { ...provider, maxTokens: 1024, temperature: 0.3 },
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
    );
    rawJson = stripThinkTags(data.choices[0]?.message.content?.trim() ?? '');
  } catch (e) {
    console.error('[Replanner] LLM 请求失败，退化为单步兜底:', e);
    return fallbackPlan(goal);
  }

  const jsonMatch = rawJson.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn('[Replanner] 未找到 JSON，退化为单步兜底');
    return fallbackPlan(goal);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { goal?: string; steps?: Partial<AtomicStep>[] };
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) return fallbackPlan(goal);

    return {
      goal,
      steps: parsed.steps.map((s, i) => ({
        id:              s.id              ?? `replan_${i + 1}`,
        description:     s.description     ?? `补救步骤 ${i + 1}`,
        instruction:     s.instruction     ?? goal,
        expectedOutcome: s.expectedOutcome ?? '操作完成，页面无报错',
        toolHints:       s.toolHints,
        retryLimit:      s.retryLimit      ?? 1,
      })),
      createdAt: Date.now(),
    };
  } catch {
    console.warn('[Replanner] JSON.parse 失败，退化为单步兜底');
    return fallbackPlan(goal);
  }
}
