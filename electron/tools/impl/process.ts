/**
 * 工具：process
 *
 * 管理后台进程（由 run_command background=true 启动）。
 * 参考 Hermes Agent 的 process 工具设计。
 *
 * 动作：
 *   - poll：检查状态 + 最近输出
 *   - log：完整输出日志
 *   - kill：终止进程
 *   - send：向 stdin 发送输入
 *   - list：列出所有后台进程
 */

import type { ToolDefinition } from '../types';
import { terminalManager } from '../terminalManager';

interface ProcessParams {
  /** 操作类型 */
  action: 'poll' | 'log' | 'kill' | 'send' | 'list';
  /** 后台进程的 session_id（list 操作不需要） */
  session_id?: string;
  /** 要发送的数据（send 操作专用，自动追加换行） */
  data?: string;
}

const processTool: ToolDefinition<ProcessParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'process',
      description:
        '管理后台进程（由 run_command background=true 启动）。\n' +
        '\n' +
        '【动作】\n' +
        '  • poll — 检查进程状态 + 最近输出（最常用）\n' +
        '  • log  — 获取完整输出日志\n' +
        '  • kill — 终止进程（SIGTERM → 3s 后 SIGKILL）\n' +
        '  • send — 向 stdin 发送输入（自动追加换行）\n' +
        '  • list — 列出所有后台进程\n' +
        '\n' +
        '【典型流程】\n' +
        '  1. run_command({ command: "npm run dev", cwd: "...", background: true }) → session_id\n' +
        '  2. process({ action: "poll", session_id })  → 检查是否启动成功\n' +
        '  3. browser_open → 验证页面\n' +
        '  4. process({ action: "kill", session_id })  → 完成后关停',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['poll', 'log', 'kill', 'send', 'list'],
            description: '操作类型：poll=检查状态, log=完整日志, kill=终止, send=发送输入, list=列出全部',
          },
          session_id: {
            type: 'string',
            description: '后台进程的 session_id（由 run_command background=true 返回）。list 操作不需要此参数。',
          },
          data: {
            type: 'string',
            description: 'send 操作专用：要发送到 stdin 的数据（自动追加换行符）。',
          },
        },
        required: ['action'],
      },
    },
  },

  async execute({ action, session_id, data }) {
    // list 不需要 session_id
    if (action === 'list') {
      const terminals = terminalManager.listTerminals();
      if (terminals.length === 0) {
        return '没有运行中的后台进程。';
      }

      const lines = terminals.map(t => {
        const status = t.isAlive ? '🟢 运行中' : '⚫ 已退出';
        const uptime = Math.round(t.uptime / 1000);
        return `  ${status} | ${t.id} | PID ${t.pid} | ${t.command} | ${uptime}s`;
      });

      return `后台进程列表（${terminals.length} 个）：\n${lines.join('\n')}`;
    }

    // 其他操作需要 session_id
    if (!session_id) {
      return '❌ 缺少 session_id 参数。请提供 run_command(background=true) 返回的 session_id。';
    }

    switch (action) {
      case 'poll': {
        const output = terminalManager.getOutput(session_id);
        return output;
      }

      case 'log': {
        const output = terminalManager.getOutput(session_id);
        return output;
      }

      case 'kill': {
        try {
          await terminalManager.killTerminal(session_id);
          return `✅ 进程已终止: ${session_id}`;
        } catch (error: any) {
          return `❌ 终止失败: ${error.message}`;
        }
      }

      case 'send': {
        if (!data) {
          return '❌ send 操作需要 data 参数（要发送的输入内容）。';
        }
        try {
          terminalManager.sendInput(session_id, data);
          return `✅ 已发送: "${data}"`;
        } catch (error: any) {
          return `❌ 发送失败: ${error.message}`;
        }
      }

      default:
        return `❌ 未知操作: ${action}。可用: poll, log, kill, send, list`;
    }
  },
};

export default processTool;
