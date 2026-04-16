/**
 * 工具: switch_agent_mode
 *
 * AI 主动切换 Agent 模式（Chat/Agent/Agent-Debug）
 * 
 * 使用场景：
 *   - Chat 模式下检测到需要更多工具，自动升级到 Agent 模式
 *   - 完成复杂任务后，自动降级到 Chat 模式节省资源
 *   - 调试时切换到 Agent-Debug 模式暴露底层工具
 * 
 * 与 request_agent_mode 的区别：
 *   - request_agent_mode: 向用户请求（返回 SkillPauseResult，等待用户响应）
 *   - switch_agent_mode: AI 直接切换（立即生效）
 */

import type { ToolDefinition } from '../types';
import { setAgentMode, getAgentMode } from '../../agentMode';
import { BrowserWindow } from 'electron';

interface SwitchAgentModeParams {
  /** 目标模式：chat | agent | agent-debug | developer */
  target_mode: 'chat' | 'agent' | 'agent-debug' | 'developer';
  /** 切换原因（向用户说明） */
  reason: string;
}

const switchAgentMode: ToolDefinition<SwitchAgentModeParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'switch_agent_mode',
      description:
        'AI 主动切换 Agent 模式（Chat/Agent/Agent-Debug/Developer）。\n' +
        '【使用场景】\n' +
        '  • Chat → Agent: 检测到需要自动化能力（如网页点击、文件编辑）\n' +
        '  • Agent → Chat: 完成复杂任务后降级节省资源\n' +
        '  • 任何 → Agent-Debug: 调试时暴露底层工具\n' +
        '  • 任何 → Developer: 软件工程模式（方法论驱动，强制 TDD/Plan/Debug 流程）\n' +
        '【注意事项】\n' +
        '  • 切换后立即生效，无需用户确认\n' +
        '  • Developer 模式会切换系统提示词为软件工程师人设\n' +
        '  • 升级前应向用户说明原因（通过 reason 参数）\n' +
        '  • 不要频繁切换（影响用户体验）',
      parameters: {
        type: 'object',
        properties: {
          target_mode: {
            type: 'string',
            enum: ['chat', 'agent', 'agent-debug', 'developer'],
            description: '目标模式：chat（轻量）| agent（全功能）| agent-debug（调试）| developer（软件工程师）',
          },
          reason: {
            type: 'string',
            description: '切换原因，向用户说明（如："需要自动点击网页元素，已切换到 Agent 模式"）',
          },
        },
        required: ['target_mode', 'reason'],
      },
    },
  },

  async execute({ target_mode, reason }) {
    const currentMode = getAgentMode();

    // 已经是目标模式，无需切换
    if (currentMode === target_mode) {
      return `✅ 当前已处于 ${target_mode.toUpperCase()} 模式，无需切换。`;
    }

    // 执行切换
    setAgentMode(target_mode);
    console.log(`[Agent Mode] AI 主动切换: ${currentMode} → ${target_mode}`);
    console.log(`[Agent Mode] 切换原因: ${reason}`);

    // 通知前端更新 UI
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.send('agent-mode:changed', target_mode);
    }

    // 返回成功消息（AI 会向用户说明）
    const modeNames: Record<string, string> = {
      chat: 'Chat 模式（轻量对话）',
      agent: 'Agent 模式（全功能自动化）',
      'agent-debug': 'Agent-Debug 模式（开发者调试）',
      developer: 'Developer 模式（软件工程师 — 方法论驱动）',
    };

    return (
      `✅ 已切换到 ${modeNames[target_mode]}\n` +
      `📌 切换原因：${reason}\n` +
      `🔧 可用工具数量已更新，请继续任务。`
    );
  },
};

export default switchAgentMode;
