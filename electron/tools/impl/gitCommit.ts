/**
 * Git 操作工具 - git_commit
 * 
 * 提交暂存的更改到 Git 仓库。
 * 打工人必备，用于保存工作进度。
 * 
 * 安全性：需要用户确认（通过 AI 提示）
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition } from '../types';

const execAsync = promisify(exec);

interface GitCommitParams {
  message: string;
  repo_path?: string;
  add_all?: boolean;
  allow_empty?: boolean;
}

async function execute(params: GitCommitParams): Promise<string> {
  const {
    message,
    repo_path = '.',
    add_all = false,
    allow_empty = false,
  } = params;

  try {
    // 检查是否为 Git 仓库
    try {
      await execAsync('git rev-parse --git-dir', { cwd: repo_path });
    } catch {
      return `❌ 不是 Git 仓库: ${repo_path}`;
    }

    // 检查提交信息
    if (!message.trim()) {
      return `❌ 提交信息不能为空`;
    }

    // 如果 add_all=true，先暂存所有更改
    if (add_all) {
      await execAsync('git add .', { cwd: repo_path });
    }

    // 检查是否有暂存的更改
    const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: repo_path });
    const stagedFiles = statusOutput
      .split('\n')
      .filter(line => line && (line[0] === 'A' || line[0] === 'M' || line[0] === 'D'));

    if (stagedFiles.length === 0 && !allow_empty) {
      return [
        `❌ 没有暂存的更改`,
        ``,
        `提示：`,
        `1. 使用 run_command("git add <file>") 暂存文件`,
        `2. 或设置 add_all: true 暂存所有更改`,
        `3. 或设置 allow_empty: true 允许空提交`,
      ].join('\n');
    }

    // 执行提交
    const commitCmd = allow_empty
      ? `git commit --allow-empty -m "${message.replace(/"/g, '\\"')}"`
      : `git commit -m "${message.replace(/"/g, '\\"')}"`;

    const { stdout: commitOutput } = await execAsync(commitCmd, { cwd: repo_path });

    // 获取提交哈希
    const { stdout: hashOutput } = await execAsync('git rev-parse HEAD', { cwd: repo_path });
    const commitHash = hashOutput.trim().substring(0, 7);

    // 获取当前分支
    const { stdout: branchOutput } = await execAsync('git branch --show-current', { cwd: repo_path });
    const currentBranch = branchOutput.trim();

    return [
      `✅ Git 提交成功`,
      ``,
      `🌿 分支: ${currentBranch}`,
      `📝 提交: ${commitHash}`,
      `💬 信息: ${message}`,
      ``,
      `暂存文件数: ${stagedFiles.length}`,
      ``,
      '详细信息:',
      '```',
      commitOutput.trim(),
      '```',
      ``,
      `💡 提示：使用 git_log 查看提交历史。`,
    ].join('\n');

  } catch (error: any) {
    return `❌ Git 提交失败: ${error.message}`;
  }
}

const tool: ToolDefinition<GitCommitParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'git_commit',
      description: '提交暂存的更改到 Git 仓库（需要先暂存文件）',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: '提交信息（简洁描述本次更改）',
          },
          repo_path: {
            type: 'string',
            description: '仓库路径（默认当前目录）',
          },
          add_all: {
            type: 'boolean',
            description: '是否暂存所有更改（相当于 git add .，默认 false）',
          },
          allow_empty: {
            type: 'boolean',
            description: '是否允许空提交（默认 false）',
          },
        },
        required: ['message'],
      },
    },
  },
  execute,
};

export default tool;
