/**
 * Git 操作工具 - git_diff
 * 
 * 查看 Git 差异（对比工作区、暂存区、提交记录）。
 * 打工人必备，用于审查代码改动。
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition } from '../types';

const execAsync = promisify(exec);

interface GitDiffParams {
  repo_path?: string;
  target?: 'working' | 'staged' | 'commit';
  file_path?: string;
  commit?: string;
  context_lines?: number;
}

async function execute(params: GitDiffParams): Promise<string> {
  const {
    repo_path = '.',
    target = 'working',
    file_path,
    commit,
    context_lines = 3,
  } = params;

  try {
    // 检查是否为 Git 仓库
    try {
      await execAsync('git rev-parse --git-dir', { cwd: repo_path });
    } catch {
      return `❌ 不是 Git 仓库: ${repo_path}`;
    }

    // 构建 git diff 命令
    let cmd = `git diff --unified=${context_lines}`;

    switch (target) {
      case 'working':
        // 工作区 vs 暂存区（未暂存的更改）
        break;
      case 'staged':
        // 暂存区 vs HEAD（已暂存的更改）
        cmd += ' --staged';
        break;
      case 'commit':
        // 提交记录
        if (commit) {
          cmd += ` ${commit}`;
        } else {
          return `❌ target=commit 时必须指定 commit 参数（如 'HEAD~1'）`;
        }
        break;
    }

    if (file_path) {
      cmd += ` -- "${file_path}"`;
    }

    // 执行 git diff
    const { stdout } = await execAsync(cmd, { cwd: repo_path, maxBuffer: 10 * 1024 * 1024 });

    if (!stdout.trim()) {
      const targetDesc = {
        working: '工作区（未暂存）',
        staged: '暂存区（已暂存）',
        commit: `提交 ${commit}`,
      }[target];
      
      return [
        `✅ 无差异`,
        ``,
        `对比目标: ${targetDesc}`,
        file_path ? `文件: ${file_path}` : '',
        ``,
        `没有需要查看的差异。`,
      ].filter(Boolean).join('\n');
    }

    // 统计差异
    const additions = (stdout.match(/^\+(?!\+)/gm) || []).length;
    const deletions = (stdout.match(/^-(?!-)/gm) || []).length;
    const filesChanged = new Set(
      (stdout.match(/^diff --git a\/.+ b\/(.+)$/gm) || [])
        .map(line => line.split(' b/')[1])
    ).size;

    // 格式化输出
    const targetDesc = {
      working: '工作区（未暂存的更改）',
      staged: '暂存区（已暂存的更改）',
      commit: `提交 ${commit}`,
    }[target];

    const result = [
      `📊 Git 差异对比`,
      ``,
      `对比目标: ${targetDesc}`,
      file_path ? `文件: ${file_path}` : '',
      ``,
      `📈 统计: ${filesChanged} 个文件, +${additions} 行, -${deletions} 行`,
      ``,
      '```diff',
      stdout.trim(),
      '```',
    ].filter(Boolean);

    // 大差异警告
    if (stdout.length > 50000) {
      result.push('');
      result.push('⚠️ 差异内容过大，建议指定 file_path 查看单个文件的差异。');
    }

    return result.join('\n');

  } catch (error: any) {
    return `❌ 获取 Git 差异失败: ${error.message}`;
  }
}

const tool: ToolDefinition<GitDiffParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'git_diff',
      description: '查看 Git 差异（对比工作区、暂存区、提交记录）',
      parameters: {
        type: 'object',
        properties: {
          repo_path: {
            type: 'string',
            description: '仓库路径（默认当前目录）',
          },
          target: {
            type: 'string',
            enum: ['working', 'staged', 'commit'],
            description: '对比目标：working（工作区）、staged（暂存区）、commit（提交记录）',
          },
          file_path: {
            type: 'string',
            description: '指定文件路径（仅查看该文件的差异）',
          },
          commit: {
            type: 'string',
            description: '提交哈希（target=commit 时使用，如 HEAD~1）',
          },
          context_lines: {
            type: 'number',
            description: '上下文行数（默认 3）',
          },
        },
        required: [],
      },
    },
  },
  execute,
};

export default tool;
