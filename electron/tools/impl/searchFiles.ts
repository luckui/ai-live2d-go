/**
 * 文件操作工具 - search_files
 * 
 * 在文件中搜索文本内容（类似 grep）。
 * 借鉴 Hermes Agent 的 search_tool 设计。
 * 
 * 特性：
 *   - 支持正则表达式
 *   - 支持文件名模式过滤
 *   - 显示匹配行的上下文
 *   - 限制结果数量防止 Token 爆炸
 */

import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition } from '../types';

interface SearchFilesParams {
  pattern: string;
  search_path?: string;
  file_glob?: string;
  is_regex?: boolean;
  ignore_case?: boolean;
  context_lines?: number;
  max_results?: number;
}

interface SearchMatch {
  file: string;
  line: number;
  content: string;
  context_before: string[];
  context_after: string[];
}

async function searchInFile(
  filePath: string,
  pattern: string | RegExp,
  contextLines: number,
): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const regex = typeof pattern === 'string' 
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      : pattern;

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matches.push({
          file: path.relative(process.cwd(), filePath),
          line: i + 1,
          content: lines[i],
          context_before: lines.slice(Math.max(0, i - contextLines), i),
          context_after: lines.slice(i + 1, i + 1 + contextLines),
        });
      }
    }
  } catch (error: any) {
    // 忽略读取错误（可能是二进制文件或无权限）
  }

  return matches;
}

async function searchDirectory(
  dirPath: string,
  pattern: string | RegExp,
  fileGlob: string | undefined,
  contextLines: number,
  maxResults: number,
): Promise<SearchMatch[]> {
  const allMatches: SearchMatch[] = [];

  async function walkDir(currentPath: string) {
    if (allMatches.length >= maxResults) return;

    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        if (allMatches.length >= maxResults) break;

        // 跳过隐藏文件和 node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }

        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (entry.isFile()) {
          // 文件名过滤
          if (fileGlob) {
            const globPattern = fileGlob.replace(/\*/g, '.*').replace(/\?/g, '.');
            const regex = new RegExp(`^${globPattern}$`, 'i');
            if (!regex.test(entry.name)) {
              continue;
            }
          }

          // 跳过二进制文件
          const binaryExtensions = [
            '.exe', '.dll', '.so', '.bin', '.jpg', '.jpeg', '.png', '.gif',
            '.mp4', '.avi', '.mp3', '.wav', '.zip', '.tar', '.gz', '.pdf',
          ];
          const ext = path.extname(fullPath).toLowerCase();
          if (binaryExtensions.includes(ext)) {
            continue;
          }

          const matches = await searchInFile(fullPath, pattern, contextLines);
          allMatches.push(...matches.slice(0, maxResults - allMatches.length));
        }
      }
    } catch (error: any) {
      // 忽略无权限的目录
    }
  }

  await walkDir(dirPath);
  return allMatches;
}

async function execute(params: SearchFilesParams): Promise<string> {
  const {
    pattern,
    search_path = '.',
    file_glob,
    is_regex = false,
    ignore_case = true,
    context_lines = 2,
    max_results = 50,
  } = params;

  try {
    // 解析路径
    const resolvedPath = path.isAbsolute(search_path)
      ? search_path
      : path.resolve(process.cwd(), search_path);

    // 检查路径是否存在
    try {
      await fs.access(resolvedPath);
    } catch {
      return `❌ 路径不存在: ${search_path}`;
    }

    // 构建搜索模式
    const searchPattern = is_regex
      ? new RegExp(pattern, ignore_case ? 'i' : '')
      : pattern;

    // 执行搜索
    const matches = await searchDirectory(
      resolvedPath,
      searchPattern,
      file_glob,
      context_lines,
      max_results,
    );

    if (matches.length === 0) {
      return [
        `🔍 未找到匹配项`,
        ``,
        `搜索模式: ${pattern}`,
        `搜索路径: ${search_path}`,
        file_glob ? `文件过滤: ${file_glob}` : '',
      ].filter(Boolean).join('\n');
    }

    // 格式化结果
    const lines = [
      `🔍 搜索结果 (找到 ${matches.length} 个匹配${matches.length >= max_results ? `，已截断到 ${max_results}` : ''})`,
      ``,
      `搜索模式: ${pattern}`,
      `搜索路径: ${search_path}`,
      file_glob ? `文件过滤: ${file_glob}` : '',
      ``,
    ].filter(Boolean);

    for (const match of matches) {
      lines.push(`📄 ${match.file}:${match.line}`);
      
      // 显示上下文
      if (match.context_before.length > 0) {
        match.context_before.forEach((line, i) => {
          const lineNum = match.line - match.context_before.length + i;
          lines.push(`  ${lineNum.toString().padStart(4, ' ')} | ${line}`);
        });
      }

      // 显示匹配行（高亮）
      lines.push(`> ${match.line.toString().padStart(4, ' ')} | ${match.content}`);

      // 显示下文
      if (match.context_after.length > 0) {
        match.context_after.forEach((line, i) => {
          const lineNum = match.line + i + 1;
          lines.push(`  ${lineNum.toString().padStart(4, ' ')} | ${line}`);
        });
      }

      lines.push('');
    }

    // 截断警告
    if (matches.length >= max_results) {
      lines.push('⚠️ 结果已截断，使用更具体的 pattern 或 file_glob 缩小范围。');
    }

    return lines.join('\n');

  } catch (error: any) {
    return `❌ 搜索失败: ${error.message}`;
  }
}

const tool: ToolDefinition<SearchFilesParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'search_files',
      description: '在文件中搜索文本内容（支持正则表达式和文件过滤）',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: '要搜索的文本或正则表达式',
          },
          search_path: {
            type: 'string',
            description: '搜索路径（默认当前目录）',
          },
          file_glob: {
            type: 'string',
            description: '文件名模式（如 *.ts, *.json）',
          },
          is_regex: {
            type: 'boolean',
            description: '是否使用正则表达式（默认 false，普通文本搜索）',
          },
          ignore_case: {
            type: 'boolean',
            description: '是否忽略大小写（默认 true）',
          },
          context_lines: {
            type: 'number',
            description: '显示匹配行的上下文行数（默认 2）',
          },
          max_results: {
            type: 'number',
            description: '最大结果数量（默认 50）',
          },
        },
        required: ['pattern'],
      },
    },
  },
  execute,
};

export default tool;
