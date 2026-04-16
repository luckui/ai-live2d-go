/**
 * Git 操作工具 - git_status
 * 
 * 查看 Git 仓库状态（修改、暂存、未跟踪文件）。
 * 打工人必备，用于确认代码改动。
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolDefinition } from '../types';

const execAsync = promisify(exec);

interface GitStatusParams {
  repo_path?: string;
  show_untracked?: boolean;
}

async function execute(params: GitStatusParams): Promise<string> {
  const { repo_path = '.', show_untracked = true } = params;

  try {
    // 检查是否为 Git 仓库
    try {
      await execAsync('git rev-parse --git-dir', { cwd: repo_path });
    } catch {
      return `❌ 不是 Git 仓库: ${repo_path}\n提示：使用 git init 初始化仓库。`;
    }

    // 获取状态
    const { stdout } = await execAsync(
      show_untracked ? 'git status --porcelain' : 'git status --porcelain --untracked-files=no',
      { cwd: repo_path }
    );

    // 获取当前分支
    const { stdout: branchOutput } = await execAsync('git branch --show-current', { cwd: repo_path });
    const currentBranch = branchOutput.trim();

    // 解析状态
    const lines = stdout.trim().split('\n').filter(line => line);
    
    if (lines.length === 0) {
      return [
        `✅ Git 工作区干净`,
        ``,
        `🌿 当前分支: ${currentBranch}`,
        ``,
        `没有需要提交的更改。`,
      ].join('\n');
    }

    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];
    const deleted: string[] = [];

    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3);

      if (status === '??') {
        untracked.push(file);
      } else if (status[0] === 'A' || status[0] === 'M') {
        staged.push(file);
      } else if (status[1] === 'M') {
        modified.push(file);
      } else if (status[1] === 'D') {
        deleted.push(file);
      }
    }

    // 格式化输出
    const result = [
      `📊 Git 状态`,
      ``,
      `🌿 当前分支: ${currentBranch}`,
      ``,
    ];

    if (staged.length > 0) {
      result.push('✅ 已暂存的更改:');
      staged.forEach(file => result.push(`   + ${file}`));
      result.push('');
    }

    if (modified.length > 0) {
      result.push('📝 未暂存的更改:');
      modified.forEach(file => result.push(`   M ${file}`));
      result.push('');
    }

    if (deleted.length > 0) {
      result.push('🗑️ 已删除:');
      deleted.forEach(file => result.push(`   D ${file}`));
      result.push('');
    }

    if (untracked.length > 0) {
      result.push('❓ 未跟踪的文件:');
      untracked.forEach(file => result.push(`   ? ${file}`));
      result.push('');
    }

    // 提示
    if (staged.length > 0) {
      result.push('💡 提示：使用 git_commit 提交已暂存的更改。');
    } else if (modified.length > 0) {
      result.push('💡 提示：使用 run_command("git add <file>") 暂存更改。');
    }

    return result.join('\n');

  } catch (error: any) {
    return `❌ 获取 Git 状态失败: ${error.message}`;
  }
}

const tool: ToolDefinition<GitStatusParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'git_status',
      description: '查看 Git 仓库状态（修改、暂存、未跟踪文件）',
      parameters: {
        type: 'object',
        properties: {
          repo_path: {
            type: 'string',
            description: '仓库路径（默认当前目录）',
          },
          show_untracked: {
            type: 'boolean',
            description: '是否显示未跟踪文件（默认 true）',
          },
        },
        required: [],
      },
    },
  },
  execute,
};

export default tool;
