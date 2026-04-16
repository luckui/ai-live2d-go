/**
 * 原子工具：run_command
 *
 * 通过 child_process.execFile / exec 执行任意命令行命令，
 * 返回 stdout + stderr 合并输出（截取前 4000 字符）。
 *
 * 特性：
 *   - 跨平台：Windows 走 cmd.exe /c，macOS/Linux 走 /bin/sh -c
 *   - 超时保护（默认 15 秒）
 *   - 非零退出码不抛出异常，而是在结果中注明
 *   - 输出过长时截断，防止塞满 context
 */

import { exec } from 'child_process';
import type { ToolDefinition } from '../types';

interface RunCommandParams {
  /** 要执行的命令（Shell 语法） */
  command: string;
  /** 超时毫秒，默认 15000 */
  timeoutMs?: number;
  /** 工作目录，默认继承当前进程 cwd */
  cwd?: string;
  /** 额外环境变量，会与当前 process.env 合并 */
  env?: Record<string, string>;
}

const runCommandTool: ToolDefinition<RunCommandParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        '在系统 Shell 中执行一条命令行命令，返回 stdout + stderr 合并输出。\n' +
        '跨平台：Windows 用 cmd.exe /c 执行，macOS/Linux 用 /bin/sh -c 执行。\n' +
        '非零退出码不报错，输出中会注明退出码。\n' +
        '【适用场景】查询系统信息（python --version、conda env list、node -v 等）、\n' +
        '执行脚本、读取命令行工具输出等。\n' +
        '【⚠️ 工作目录】需要在特定目录执行时，必须用 cwd 参数指定绝对路径，\n' +
        '  不要用 cd 切换目录！cmd.exe 的 cd 不能跨盘符（如从 D: 切到 C:）。\n' +
        '  ❌ 错误：command="cd C:\\Users\\xxx && npm init"\n' +
        '  ✅ 正确：command="npm init -y", cwd="C:\\Users\\xxx"\n' +
        '【⚠️ 交互式命令】脚手架/初始化命令（npm create、npx create-xxx）必须传 env={"CI":"true"} 跳过交互！\n' +
        '  ✅ 正确：command="npm create vite@latest . -- --template vanilla", cwd="项目路径", env={"CI":"true"}\n' +
        '  ❌ 错误：不传 env，交互式命令会静默失败（Operation cancelled）。\n' +
        '【注意】避免执行破坏性命令（rm -rf、format 等），该工具不做安全检查。\n' +
        '【提示】不确定命令写法时，先调用 read_manual(topic="命令行操作") 查阅规范，\n' +
        '        或调用 read_manual() 列出全部说明书主题。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的 Shell 命令，例如："python --version"、"conda env list"、"node -v"',
          },
          timeoutMs: {
            type: 'number',
            description: '超时毫秒数，默认 30000（30 秒）。WMI 类命令（Get-CimInstance）在有断开网络盘时可能需要 30~60 秒，可传 60000。',
          },
          cwd: {
            type: 'string',
            description: '工作目录（绝对路径）。⚠️ 必须用此参数指定目录，不要在 command 中用 cd！cmd.exe 的 cd 无法跨盘符。',
          },
          env: {
            type: 'object',
            description: '额外环境变量（key-value 对象），会与系统环境变量合并。\n' +
              '⚠️ 脚手架/初始化命令（npm create vite、npx create-xxx）必须传 {"CI": "true"} 跳过交互提示！\n' +
              '示例：env={"CI": "true", "NODE_ENV": "production"}',
          },
        },
        required: ['command'],
      },
    },
  },

  async execute({ command, timeoutMs = 30000, cwd, env }) {
    // 检测常驻进程命令（开发服务器、HTTP 服务器等）
    const longRunningPatterns = [
      /npm\s+run\s+(dev|start|serve)/i,
      /python\s+-m\s+(http\.server|SimpleHTTPServer)/i,
      /node\s+.*server/i,
      /vite\s+(--)?(?!build)/i,  // vite 但不是 vite build
      /webpack-dev-server/i,
      /ng\s+serve/i,  // Angular CLI
    ];

    const isLongRunning = longRunningPatterns.some(pattern => pattern.test(command));

    if (isLongRunning) {
      return (
        '❌ 检测到常驻进程命令（开发服务器 / HTTP 服务器），此工具会超时失败！\n' +
        `命令：${command}\n\n` +
        '【正确做法】用 start_terminal 工具启动并监控输出：\n' +
        `  start_terminal({ command: "${command.replace(/"/g, '\\"')}", cwd: "项目目录绝对路径" })\n\n` +
        '该工具会异步启动进程、持续监控输出，返回 UUID 用于后续操作：\n' +
        '  • get_terminal_output({ id }) - 获取累积输出\n' +
        '  • send_to_terminal({ id, input }) - 发送交互式输入\n' +
        '  • kill_terminal({ id }) - 终止进程'
      );
    }

    return new Promise<string>((resolve) => {
      const isWin = process.platform === 'win32';
      const shell = isWin ? 'cmd.exe' : '/bin/sh';

      // Windows：在命令前加 chcp 65001 切换到 UTF-8，避免中文输出乱码
      // > nul 屏蔽 "Active code page: 65001" 这行提示
      const actualCommand = isWin ? `chcp 65001 > nul && ${command}` : command;

      // 合并环境变量：用户传入的 env 覆盖系统 env
      const mergedEnv = env ? { ...process.env, ...env } : process.env;

      exec(
        actualCommand,
        {
          shell,
          timeout: timeoutMs,
          cwd: cwd ?? process.cwd(),
          env: mergedEnv,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,  // 1MB 缓冲
          windowsHide: true,
        },
        (err, stdout, stderr) => {
          const out = (stdout ?? '').trim();
          const errText = (stderr ?? '').trim();
          const combined = [out, errText].filter(Boolean).join('\n');

          if (err?.killed || err?.signal === 'SIGTERM') {
            resolve(`⏱️ 命令超时（>${timeoutMs}ms）：${command}`);
            return;
          }

          const exitCode = err?.code ?? 0;

          if (exitCode !== 0) {
            // 非零退出码：用 ❌ 开头，让 AI 明确知道命令失败，需要查阅说明书后重试
            const output = `❌ 命令执行失败（退出码 ${exitCode}）\n命令：${command}\n输出：\n${combined || '（无输出）'}`.slice(0, 4000);
            resolve(output + '\n\n【操作指引】命令失败，请立即调用 read_manual 查阅正确写法后重试，不要向用户解释错误。');
            return;
          }

          const output = combined
            ? combined.slice(0, 4000)
            : '（退出码 0，命令正常完成，但没有产生任何输出。' +
              '对于 Get-ChildItem / dir / find 等查找命令，无输出即代表没有找到任何匹配项，结果是确定的"未找到"，不是不确定。）';

          // 乱码检测：U+FFFD 替换字符（GBK 字节被 UTF-8 解析失败时产生）
          // 阈值 3 个以上视为乱码（单个偶发不算）
          const garbageCount = (output.match(/\uFFFD/g) ?? []).length;
          const garbageHint = garbageCount >= 3
            ? '\n\n⚠️【编码警告】输出含乱码字符（可能是 GBK 命令输出未正确转 UTF-8）。' +
              '如需理解输出内容，请调用 read_manual(topic="命令行操作") 查阅无乱码的替代命令（如改用 powershell -Command "Get-CimInstance ..."）。'
            : '';

          resolve(`✅ ${output}${garbageHint}`);
        },
      );
    });
  },
};

export default runCommandTool;
