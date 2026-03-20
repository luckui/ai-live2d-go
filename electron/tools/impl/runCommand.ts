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
            description: '超时毫秒数，默认 15000（15 秒）。长耗时命令可适当调大。',
          },
          cwd: {
            type: 'string',
            description: '工作目录（绝对路径），默认使用进程当前目录。',
          },
        },
        required: ['command'],
      },
    },
  },

  async execute({ command, timeoutMs = 15000, cwd }) {
    return new Promise<string>((resolve) => {
      const isWin = process.platform === 'win32';
      const shell = isWin ? 'cmd.exe' : '/bin/sh';

      // Windows：在命令前加 chcp 65001 切换到 UTF-8，避免中文输出乱码
      // > nul 屏蔽 "Active code page: 65001" 这行提示
      const actualCommand = isWin ? `chcp 65001 > nul && ${command}` : command;

      exec(
        actualCommand,
        {
          shell,
          timeout: timeoutMs,
          cwd: cwd ?? process.cwd(),
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
