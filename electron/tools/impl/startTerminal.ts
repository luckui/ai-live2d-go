/**
 * 工具：start_terminal
 * 
 * 启动持久化终端会话，返回唯一 ID 用于后续操作。
 * 
 * 用途：
 *   - 启动开发服务器（npm run dev）
 *   - 启动 HTTP 服务器（python -m http.server）
 *   - 运行需要持续监控的长时间任务
 * 
 * 特性：
 *   - 跨平台（Windows/Linux/macOS）
 *   - 返回 UUID 用于后续 get/send/kill 操作
 *   - 异步启动，不阻塞
 *   - 持续收集输出到缓冲区
 */

import type { ToolDefinition } from '../types';
import { terminalManager } from '../terminalManager';

interface StartTerminalParams {
  /** 要执行的命令 */
  command: string;
  /** 工作目录（绝对路径） */
  cwd: string;
  /** 环境变量（可选，会与系统环境变量合并） */
  env?: Record<string, string>;
  /** 初始检测超时（毫秒，默认 5000），检测到输出或超时后返回 */
  timeout?: number;
}

const startTerminalTool: ToolDefinition<StartTerminalParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'start_terminal',
      description:
        '启动持久化终端会话，返回唯一 ID 用于后续操作（获取输出、发送输入、终止）。\n' +
        '适用于需要持续运行的命令（开发服务器、HTTP 服务器、监控任务等）。\n' +
        '进程在后台异步运行，不阻塞后续操作。\n' +
        '【适用场景】\n' +
        '  • npm run dev / npm start（Vite / Next.js / Webpack）\n' +
        '  • python -m http.server 8080\n' +
        '  • 任何需要持续监控输出的长时间任务\n' +
        '【后续操作】\n' +
        '  • 用 get_terminal_output({ id }) 获取累积输出\n' +
        '  • 用 send_to_terminal({ id, input }) 发送交互式输入\n' +
        '  • 用 kill_terminal({ id }) 终止进程\n' +
        '【注意】返回的 ID 是 UUID，不是 PID！必须保存此 ID 用于后续操作。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的命令，如 "npm run dev"、"python -m http.server 8080"',
          },
          cwd: {
            type: 'string',
            description: '工作目录（绝对路径），必须是项目根目录',
          },
          env: {
            type: 'object',
            description:
              '环境变量（key-value 对象，可选），会与系统环境变量合并。\n' +
              '示例：{"CI": "true", "NODE_ENV": "development"}',
          },
          timeout: {
            type: 'number',
            description: '初始检测超时（毫秒，默认 5000）。超时后返回已收集的输出',
          },
        },
        required: ['command', 'cwd'],
      },
    },
  },

  async execute({ command, cwd, env, timeout = 5000 }) {
    try {
      const { id, output } = await terminalManager.startTerminal(
        command,
        cwd,
        env,
        timeout
      );

      const result = [
        `✅ 终端会话已启动`,
        ``,
        `🆔 会话 ID: ${id}`,
        `📍 工作目录: ${cwd}`,
        `⌨️  命令: ${command}`,
        ``,
        `📤 初始输出:`,
        output || '（无输出）',
        ``,
        `⚠️ 【重要】后续操作是强制性的，不是可选建议！`,
        ``,
        `必须按以下顺序执行（缺一不可）：`,
        `  1️⃣ 等待 3-5 秒（给服务器启动时间）`,
        `  2️⃣ get_terminal_output({ id: "${id}" })  ← 检查启动状态`,
        `  3️⃣ 在输出中查找服务器地址（如 "Local: http://localhost:5173"）`,
        `  4️⃣ browser_open(url="找到的地址")  ← 验证页面可访问`,
        `  5️⃣ browser_screenshot() + browser_read_page()  ← 检查控制台错误`,
        ``,
        `❌ 禁止：看到此消息就认为"启动成功"并汇报给用户`,
        `✅ 正确：完成上述 5 步验证后，再汇报结果`,
        ``,
        `📌 其他操作:`,
        `  • 发送输入: send_to_terminal({ id: "${id}", input: "..." })`,
        `  • 终止进程: kill_terminal({ id: "${id}" })`,
      ].join('\n');

      return result;
    } catch (error: any) {
      return `❌ 启动终端失败: ${error.message}`;
    }
  },
};

export default startTerminalTool;
