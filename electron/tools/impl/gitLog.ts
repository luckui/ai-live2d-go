/**
 * Git 操作工具 - git_log
 * 
 * 查看 Git 提交历史。
 * 打工人必备，用于追溯代码变更。
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition } from '../types';

const execAsync = promisify(exec);

interface GitLogParams {
  repo_path?: string;
  limit?: number;
  file_path?: string;
  author?: string;
  since?: string;
  oneline?: boolean;
}

async function execute(params: GitLogParams): Promise<string> {
  const {
    repo_path = '.',
    limit = 10,
    file_path,
    author,
    since,
    oneline = false,
  } = params;

  try {
    // 检查是否为 Git 仓库
    try {
      await execAsync('git rev-parse --git-dir', { cwd: repo_path });
    } catch {
      return `❌ 不是 Git 仓库: ${repo_path}`;
    }

    // 构建 git log 命令
    let cmd = `git log -${limit}`;

    if (oneline) {
      cmd += ' --oneline';
    } else {
      cmd += ' --pretty=format:"%h - %an (%ar): %s"';
    }

    if (author) {
      cmd += ` --author="${author}"`;
    }

    if (since) {
      cmd += ` --since="${since}"`;
    }

    if (file_path) {
      cmd += ` -- "${file_path}"`;
    }

    // 执行 git log
    const { stdout } = await execAsync(cmd, { cwd: repo_path });

    if (!stdout.trim()) {
      return [
        `📜 无提交历史`,
        ``,
        file_path ? `文件: ${file_path}` : '',
        author ? `作者: ${author}` : '',
        since ? `起始日期: ${since}` : '',
        ``,
        `没有找到匹配的提交记录。`,
      ].filter(Boolean).join('\n');
    }

    // 获取当前分支
    const { stdout: branchOutput } = await execAsync('git branch --show-current', { cwd: repo_path });
    const currentBranch = branchOutput.trim();

    // 统计提交数
    const commitCount = stdout.trim().split('\n').length;

    // 格式化输出
    const result = [
      `📜 Git 提交历史`,
      ``,
      `🌿 分支: ${currentBranch}`,
      `📊 显示: 最近 ${commitCount} 个提交`,
      file_path ? `📄 文件: ${file_path}` : '',
      author ? `👤 作者: ${author}` : '',
      since ? `📅 起始日期: ${since}` : '',
      ``,
      stdout.trim(),
    ].filter(Boolean);

    // 提示
    if (commitCount >= limit) {
      result.push('');
      result.push(`💡 提示：使用 limit 参数查看更多提交（当前 limit=${limit}）。`);
    }

    return result.join('\n');

  } catch (error: any) {
    return `❌ 获取 Git 提交历史失败: ${error.message}`;
  }
}

const tool: ToolDefinition<GitLogParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'git_log',
      description: '查看 Git 提交历史（支持过滤作者、日期、文件）',
      parameters: {
        type: 'object',
        properties: {
          repo_path: {
            type: 'string',
            description: '仓库路径（默认当前目录）',
          },
          limit: {
            type: 'number',
            description: '显示的提交数量（默认 10）',
          },
          file_path: {
            type: 'string',
            description: '指定文件路径（仅查看该文件的提交历史）',
          },
          author: {
            type: 'string',
            description: '过滤作者（如 John Doe）',
          },
          since: {
            type: 'string',
            description: '起始日期（如 2024-01-01, 1 week ago）',
          },
          oneline: {
            type: 'boolean',
            description: '是否使用单行模式（默认 false）',
          },
        },
        required: [],
      },
    },
  },
  execute,
};

export default tool;
