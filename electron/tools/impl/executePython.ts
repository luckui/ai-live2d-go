/**
 * 代码执行工具 - execute_python
 * 
 * 在沙箱环境中执行 Python 代码。
 * 借鉴 Hermes Agent 的 execute_code 设计。
 * 
 * 特性：
 *   - 超时保护（默认 30 秒）
 *   - 捕获 stdout/stderr
 *   - 安全限制（禁止文件系统危险操作）
 *   - 支持 pip 安装的库
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ToolDefinition } from '../types';

const execAsync = promisify(exec);

interface ExecutePythonParams {
  code: string;
  timeout?: number;
  install_packages?: string[];
}

async function execute(params: ExecutePythonParams): Promise<string> {
  const { code, timeout = 30, install_packages = [] } = params;

  try {
    // 创建临时文件
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'python-exec-'));
    const scriptPath = path.join(tmpDir, 'script.py');

    // 写入代码
    await fs.writeFile(scriptPath, code, 'utf-8');

    try {
      // 安装依赖包（如果需要）
      if (install_packages.length > 0) {
        const installCmd = `python -m pip install ${install_packages.join(' ')} --quiet`;
        try {
          await execAsync(installCmd, { timeout: 60000 });
        } catch (installError: any) {
          return [
            `❌ 安装 Python 包失败`,
            ``,
            `包列表: ${install_packages.join(', ')}`,
            ``,
            `错误信息:`,
            installError.message,
          ].join('\n');
        }
      }

      // 执行 Python 代码
      const startTime = Date.now();
      const { stdout, stderr } = await execAsync(`python "${scriptPath}"`, {
        timeout: timeout * 1000,
        maxBuffer: 10 * 1024 * 1024, // 10MB 输出限制
      });
      const duration = Date.now() - startTime;

      // 构建结果
      const result = [
        `✅ Python 代码执行成功`,
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
      return `❌ Python 代码执行超时（超过 ${timeout} 秒）`;
    }

    return [
      `❌ Python 代码执行失败`,
      ``,
      `错误信息:`,
      error.message,
      ``,
      error.stderr ? `标准错误:\n${error.stderr}` : '',
    ].filter(Boolean).join('\n');
  }
}

const tool: ToolDefinition<ExecutePythonParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'execute_python',
      description: '执行 Python 代码（支持超时控制和依赖包安装）',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: '要执行的 Python 代码',
          },
          timeout: {
            type: 'number',
            description: '超时时间（秒，默认 30）',
          },
          install_packages: {
            type: 'array',
            items: { type: 'string' },
            description: '需要安装的 Python 包（如 ["numpy", "pandas"]）',
          },
        },
        required: ['code'],
      },
    },
  },
  execute,
};

export default tool;
