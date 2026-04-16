/**
 * 文件操作工具 - list_directory
 * 
 * 列出目录内容（文件和子目录）。
 * 支持递归列出、文件类型过滤、大小统计。
 */

import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition } from '../types';

interface ListDirectoryParams {
  directory_path?: string;
  recursive?: boolean;
  file_glob?: string;
  show_hidden?: boolean;
  max_depth?: number;
}

interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  depth: number;
}

async function listDirectoryRecursive(
  dirPath: string,
  currentDepth: number,
  maxDepth: number,
  showHidden: boolean,
  fileGlob?: string,
): Promise<FileItem[]> {
  const items: FileItem[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // 跳过隐藏文件
      if (!showHidden && entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(process.cwd(), fullPath);

      if (entry.isDirectory()) {
        items.push({
          name: entry.name,
          path: relativePath,
          type: 'directory',
          depth: currentDepth,
        });

        // 递归列出子目录
        if (currentDepth < maxDepth) {
          const subItems = await listDirectoryRecursive(
            fullPath,
            currentDepth + 1,
            maxDepth,
            showHidden,
            fileGlob,
          );
          items.push(...subItems);
        }
      } else if (entry.isFile()) {
        // 文件名过滤
        if (fileGlob) {
          const pattern = fileGlob.replace(/\*/g, '.*').replace(/\?/g, '.');
          const regex = new RegExp(`^${pattern}$`, 'i');
          if (!regex.test(entry.name)) {
            continue;
          }
        }

        const stats = await fs.stat(fullPath);
        items.push({
          name: entry.name,
          path: relativePath,
          type: 'file',
          size: stats.size,
          depth: currentDepth,
        });
      }
    }
  } catch (error: any) {
    // 忽略无权限的目录
    if (error.code !== 'EACCES' && error.code !== 'EPERM') {
      throw error;
    }
  }

  return items;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function execute(params: ListDirectoryParams): Promise<string> {
  const {
    directory_path = '.',
    recursive = false,
    file_glob,
    show_hidden = false,
    max_depth = 3,
  } = params;

  try {
    // 解析路径
    const resolvedPath = path.isAbsolute(directory_path)
      ? directory_path
      : path.resolve(process.cwd(), directory_path);

    // 检查目录是否存在
    try {
      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        return `❌ 不是目录: ${directory_path}`;
      }
    } catch {
      return `❌ 目录不存在: ${directory_path}`;
    }

    // 列出目录内容
    const items = recursive
      ? await listDirectoryRecursive(resolvedPath, 0, max_depth, show_hidden, file_glob)
      : await listDirectoryRecursive(resolvedPath, 0, 0, show_hidden, file_glob);

    if (items.length === 0) {
      return `📁 目录为空: ${directory_path}`;
    }

    // 统计
    const fileCount = items.filter(item => item.type === 'file').length;
    const dirCount = items.filter(item => item.type === 'directory').length;
    const totalSize = items
      .filter(item => item.type === 'file')
      .reduce((sum, item) => sum + (item.size || 0), 0);

    // 格式化输出
    const lines = [
      `📁 目录: ${directory_path}`,
      `📊 统计: ${fileCount} 个文件, ${dirCount} 个目录, 总大小 ${formatSize(totalSize)}`,
      '',
    ];

    // 按类型和名称排序
    items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    // 输出列表
    for (const item of items) {
      const indent = '  '.repeat(item.depth);
      const icon = item.type === 'directory' ? '📁' : '📄';
      const size = item.size ? ` (${formatSize(item.size)})` : '';
      lines.push(`${indent}${icon} ${item.name}${size}`);
    }

    // 限制警告
    if (items.length >= 200) {
      lines.push('');
      lines.push('⚠️ 警告：文件数量过多，建议使用 file_glob 过滤或减少 max_depth。');
    }

    return lines.join('\n');

  } catch (error: any) {
    return `❌ 列出目录失败: ${error.message}`;
  }
}

const tool: ToolDefinition<ListDirectoryParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '列出目录内容（文件和子目录，支持递归和过滤）',
      parameters: {
        type: 'object',
        properties: {
          directory_path: {
            type: 'string',
            description: '要列出的目录路径（默认为当前工作目录）',
          },
          recursive: {
            type: 'boolean',
            description: '是否递归列出子目录（默认 false）',
          },
          file_glob: {
            type: 'string',
            description: '文件名模式过滤（如 *.ts, *.json）',
          },
          show_hidden: {
            type: 'boolean',
            description: '是否显示隐藏文件（以 . 开头，默认 false）',
          },
          max_depth: {
            type: 'number',
            description: '递归深度限制（默认 3）',
          },
        },
        required: [],
      },
    },
  },
  execute,
};

export default tool;
