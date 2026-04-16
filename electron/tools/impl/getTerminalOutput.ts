/**
 * 工具：get_terminal_output
 * 
 * 获取终端会话的累积输出（stdout + stderr）。
 */

import type { ToolDefinition } from '../types';
import { terminalManager } from '../terminalManager';

interface GetTerminalOutputParams {
  /** 终端会话 ID（由 start_terminal 返回的 UUID） */
  id: string;
}

const getTerminalOutputTool: ToolDefinition<GetTerminalOutputParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'get_terminal_output',
      description:
        '获取终端会话的累积输出（stdout + stderr）。\n' +
        '用于监控长时间运行的任务（如开发服务器）的输出。\n' +
        '【使用场景】\n' +
        '  • 检查开发服务器是否启动成功（查找 "Local: http://localhost:5173"）\n' +
        '  • 监控任务进度\n' +
        '  • 调试错误输出',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '终端会话 ID（由 start_terminal 返回的 UUID）',
          },
        },
        required: ['id'],
      },
    },
  },

  async execute({ id }) {
    const output = terminalManager.getOutput(id);
    return output;
  },
};

export default getTerminalOutputTool;
