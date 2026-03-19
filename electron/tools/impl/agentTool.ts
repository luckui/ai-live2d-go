/**
 * agent_start 工具 — 强制两阶段确认协议
 *
 * ══ 设计原则 ══════════════════════════════════════════════
 * 仅靠提示词要求 AI"先确认再调用"对小模型不可靠。
 * 因此工具本身强制实施两阶段协议，无法绕过：
 *
 * ── 第一阶段（不传 session_id）：
 *   AI 调用 → 运行 Planner 生成计划预览 → 返回预览 + 6位 session_id
 *   AI 必须将预览展示给用户并询问"是否开始执行？"
 *   用户同意 → 进入第二阶段；用户拒绝 → 结束
 *
 * ── 第二阶段（传 session_id）：
 *   AI 带上第一阶段返回的 session_id 再次调用
 *   工具校验 session_id → 运行 Orchestrator → 返回执行报告
 *
 * ── 完整触发时序 ─────────────────────────────────────────
 *   用户："帮我发评论"
 *   AI：  调用 agent_start({ goal: "..." })          ← 第一阶段
 *   工具：返回计划预览 + session_id: "a1b2c3"
 *   AI：  展示计划给用户："要开始吗？"
 *   用户："开始"
 *   AI：  调用 agent_start({ goal: "任意", session_id: "a1b2c3" })  ← 第二阶段
 *   工具：校验 session_id → 执行 → 返回报告
 */

import aiConfig from '../../ai.config';
import { createPlan } from '../../agent/planner';
import { runAgent } from '../../agent/orchestrator';
import type { ToolDefinition } from '../types';

interface AgentStartParams {
  goal: string;
  /**
   * 第二阶段令牌。
   * 第一阶段工具返回中会包含 "session_id: XXXXXX"，
   * 用户确认后调用第二阶段时，把这个 6 位 ID 传入此参数即可。
   * 第一阶段调用时不传此参数。
   */
  session_id?: string;
}

/** 模块级：存储待确认的 session */
interface PendingSession {
  id: string;
  goal: string;
  timestamp: number;
}
let _pending: PendingSession | null = null;

/** 第一阶段有效期（ms）：超时后 session_id 失效 */
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 分钟

/** 生成 6 位随机字母数字 ID */
function genSessionId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const agentStartTool: ToolDefinition<AgentStartParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'agent_start',
      description:
        '【两阶段 Agent 工具】\n\n' +
        '▶ 第一阶段（不传 session_id）：\n' +
        '  将目标分解为原子步骤，返回"任务规划预览"和一个 session_id（6位字母数字）。\n' +
        '  收到后，把计划展示给用户并询问"是否开始执行？"，等待用户确认。\n\n' +
        '▶ 第二阶段（用户确认后，传入 session_id）：\n' +
        '  把第一阶段返回的 session_id 传入，正式启动执行，返回执行报告。\n' +
        '  goal 参数可以是任意描述（不需要与第一阶段完全相同），系统以 session_id 为准。\n\n' +
        '⚠️ 禁止在没有 session_id 的情况下认为"用户已确认"而跳过第一阶段。',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: '任务目标描述。第一阶段填完整描述；第二阶段可简写，系统以 session_id 为准。',
          },
          session_id: {
            type: 'string',
            description:
              '第二阶段令牌。仅在第一阶段已完成、用户明确确认后传入。' +
              '值来自第一阶段工具返回中的 "session_id: XXXXXX" 字样（6位大写字母数字）。',
          },
        },
        required: ['goal'],
      },
    },
  },

  async execute({ goal, session_id }) {
    const provider = aiConfig.providers[aiConfig.activeProvider];
    if (!provider) return '❌ 未找到当前 AI Provider 配置，无法启动 Agent';

    // ── 第二阶段：凭 session_id 执行 ─────────────────────
    if (session_id) {
      const now = Date.now();
      if (
        !_pending ||
        _pending.id !== session_id.toUpperCase() ||
        now - _pending.timestamp > SESSION_TTL_MS
      ) {
        _pending = null;
        return (
          `❌ session_id "${session_id}" 无效或已过期（有效期 5 分钟）。\n` +
          `请重新调用 agent_start（不传 session_id）获取新的任务规划预览。`
        );
      }

      const realGoal = _pending.goal;
      _pending = null; // 消费掉，防止重复执行

      try {
        const summary = await runAgent(realGoal, provider);
        return summary;
      } catch (e) {
        return `❌ Agent 执行异常：${(e as Error).message}`;
      }
    }

    // ── 第一阶段：规划并生成 session_id ─────────────────
    try {
      const plan = await createPlan(goal, provider);
      const stepsText = plan.steps
        .map((s, i) => {
          const hints = s.toolHints?.length ? s.toolHints.join(', ') : '（未指定）';
          return (
            `  ${i + 1}. ${s.description}\n` +
            `     ├ 指令：${s.instruction}\n` +
            `     ├ 工具：${hints}\n` +
            `     └ 预期结果：${s.expectedOutcome}`
          );
        })
        .join('\n');

      const sid = genSessionId();
      _pending = { id: sid, goal, timestamp: Date.now() };

      return (
        `📋 **Agent 任务规划预览**\n\n` +
        `🎯 目标：${goal}\n\n` +
        `📝 执行步骤（共 ${plan.steps.length} 步）：\n${stepsText}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `session_id: ${sid}（有效期 5 分钟）\n\n` +
        `⚠️ 请将以上计划展示给用户，询问"是否开始执行？"\n` +
        `• 用户同意 → 调用 agent_start({ goal: "执行", session_id: "${sid}" })\n` +
        `• 用户拒绝 → 停止`
      );
    } catch (e) {
      return `❌ 任务规划失败：${(e as Error).message}`;
    }
  },
};

export default agentStartTool;
