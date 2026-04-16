/**
 * 工具：kill_terminal
 * 
 * 终止终端会话并清理资源。
 */

import type { ToolDefinition } from '../types';
import { terminalManager } from '../terminalManager';

interface KillTerminalParams {
  /** 终端会话 ID */
  id: string;
}

const killTerminalTool: ToolDefinition<KillTerminalParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'kill_terminal',
      description:
        '终止终端会话并清理资源。\n' +
        '【使用场景】\n' +
        '  • 停止开发服务器\n' +
        '  • 清理不再需要的后台任务\n' +
        '  • 释放端口占用\n' +
        '【注意】终止后无法恢复，ID 将失效。',
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
    try {
      await terminalManager.killTerminal(id);
      return `✅ 终端会话已终止: ${id}`;
    } catch (error: any) {
      return `❌ 终止终端失败: ${error.message}`;
    }
  },
};

export default killTerminalTool;
