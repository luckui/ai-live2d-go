/**
 * 代码执行工具 - execute_node
 * 
 * 在沙箱环境中执行 Node.js/TypeScript 代码。
 * 
 * 特性：
 *   - 超时保护（默认 30 秒）
 *   - 捕获 stdout/stderr
 *   - 支持 TypeScript（使用 tsx）
 *   - 支持 npm 包（需提前安装）
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ToolDefinition } from '../types';

const execAsync = promisify(exec);

interface ExecuteNodeParams {
  code: string;
  timeout?: number;
  use_typescript?: boolean;
}

async function execute(params: ExecuteNodeParams): Promise<string> {
  const { code, timeout = 30, use_typescript = false } = params;

  try {
    // 创建临时文件
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-exec-'));
    const ext = use_typescript ? '.ts' : '.js';
    const scriptPath = path.join(tmpDir, `script${ext}`);

    // 写入代码
    await fs.writeFile(scriptPath, code, 'utf-8');

    try {
      // 选择运行命令
      const cmd = use_typescript
        ? `npx tsx "${scriptPath}"`  // 使用 tsx 执行 TypeScript
        : `node "${scriptPath}"`;

      // 执行代码
      const startTime = Date.now();
      const { stdout, stderr } = await execAsync(cmd, {
        timeout: timeout * 1000,
        maxBuffer: 10 * 1024 * 1024, // 10MB 输出限制
      });
      const duration = Date.now() - startTime;

      // 构建结果
      const result = [
        `✅ Node.js 代码执行成功`,
        ``,
        `⏱️ 执行时间: ${duration}ms`,
      ];

      if (stdout.trim()) {
        result.push('');
        result.push('📤 标准输出:');
        result.push('```');
        result.push(stdout.trim());
        result.push('```');
      }

      if (stderr.trim()) {
        result.push('');
        result.push('⚠️ 标准错误:');
        result.push('```');
        result.push(stderr.trim());
        result.push('```');
      }

      if (!stdout.trim() && !stderr.trim()) {
        result.push('');
        result.push('(无输出)');
      }

      return result.join('\n');

    } finally {
      // 清理临时文件
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // 忽略清理错误
      }
    }

  } catch (error: any) {
    if (error.killed || error.signal === 'SIGTERM') {
      return `❌ Node.js 代码执行超时（超过 ${timeout} 秒）`;
    }

    return [
      `❌ Node.js 代码执行失败`,
      ``,
      `错误信息:`,
      error.message,
      ``,
      error.stderr ? `标准错误:\n${error.stderr}` : '',
    ].filter(Boolean).join('\n');
  }
}

const tool: ToolDefinition<ExecuteNodeParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'execute_node',
      description: '执行 Node.js/TypeScript 代码（支持超时控制）',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: '要执行的 Node.js/TypeScript 代码',
          },
          timeout: {
            type: 'number',
            description: '超时时间（秒，默认 30）',
          },
          use_typescript: {
            type: 'boolean',
            description: '是否使用 TypeScript（默认 false）',
          },
        },
        required: ['code'],
      },
    },
  },
  execute,
};

export default tool;
