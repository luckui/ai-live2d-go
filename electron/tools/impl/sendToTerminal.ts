/**
 * 工具：send_to_terminal
 * 
 * 向终端会话发送交互式输入。
 */

import type { ToolDefinition } from '../types';
import { terminalManager } from '../terminalManager';

interface SendToTerminalParams {
  /** 终端会话 ID */
  id: string;
  /** 要发送的输入（会自动追加换行符） */
  input: string;
}

const sendToTerminalTool: ToolDefinition<SendToTerminalParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'send_to_terminal',
      description:
        '向终端会话发送交互式输入。\n' +
        '【使用场景】\n' +
        '  • 回答交互式提示（如 npm create 的选项）\n' +
        '  • 控制运行中的程序（如按 Ctrl+C 发送 "\\x03"）\n' +
        '【注意】输入会自动追加换行符（Enter），无需手动添加。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '终端会话 ID（由 start_terminal 返回的 UUID）',
          },
          input: {
            type: 'string',
            description: '要发送的输入内容（会自动追加换行符）',
          },
        },
        required: ['id', 'input'],
      },
    },
  },

  async execute({ id, input }) {
    try {
      terminalManager.sendInput(id, input);
      return `✅ 已发送输入到终端 ${id}: "${input}"`;
    } catch (error: any) {
      return `❌ 发送输入失败: ${error.message}`;
    }
  },
};

export default sendToTerminalTool;
