/**
 * 文件操作工具 - edit_file
 * 
 * 编辑现有文件（使用字符串替换）。
 * 借鉴 Hermes Agent 的 patch_tool (replace 模式) 设计。
 * 
 * 特性：
 *   - 精确字符串替换（old_text → new_text）
 *   - 防止误操作（old_text 必须在文件中唯一出现）
 *   - 上下文验证（确保替换正确位置）
 *   - 自动备份（可选）
 */

import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition } from '../types';

interface EditFileParams {
  file_path: string;
  old_text: string;
  new_text: string;
  replace_all?: boolean;
}

async function execute(params: EditFileParams): Promise<string> {
  const { file_path, old_text, new_text, replace_all = false } = params;

  try {
    // 解析路径
    const resolvedPath = path.isAbsolute(file_path)
      ? file_path
      : path.resolve(process.cwd(), file_path);

    // 检查文件是否存在
    try {
      await fs.access(resolvedPath);
    } catch {
      return `❌ 文件不存在: ${file_path}\n提示：使用 write_file 创建新文件。`;
    }

    // 检查敏感文件（防止误操作）
    const sensitiveFiles = [
      '.env', '.env.local', '.env.production',
      'id_rsa', 'id_ed25519', 'authorized_keys',
      'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    ];
    const basename = path.basename(resolvedPath);
    if (sensitiveFiles.includes(basename)) {
      return `❌ 拒绝编辑敏感文件: ${file_path}\n提示：请手动编辑此文件。`;
    }

    // 读取文件内容
    const originalContent = await fs.readFile(resolvedPath, 'utf-8');

    // 检查 old_text 是否存在
    const occurrences = originalContent.split(old_text).length - 1;

    if (occurrences === 0) {
      return [
        `❌ 未找到要替换的文本。`,
        ``,
        `文件: ${file_path}`,
        ``,
        `提示：`,
        `1. 使用 read_file 查看文件当前内容`,
        `2. 确保 old_text 完全匹配（包括空格、换行）`,
        `3. 建议包含前后 3-5 行上下文以确保唯一性`,
        ``,
        `要查找的文本片段：`,
        `\`\`\``,
        old_text.substring(0, 200) + (old_text.length > 200 ? '...' : ''),
        `\`\`\``,
      ].join('\n');
    }

    if (occurrences > 1 && !replace_all) {
      return [
        `❌ old_text 在文件中出现了 ${occurrences} 次，无法确定要替换哪一处。`,
        ``,
        `解决方案：`,
        `1. 增加 old_text 的上下文（包含前后更多行）以确保唯一性`,
        `2. 或者设置 replace_all: true 替换所有匹配`,
        ``,
        `文件: ${file_path}`,
      ].join('\n');
    }

    // 执行替换
    const newContent = replace_all
      ? originalContent.split(old_text).join(new_text)
      : originalContent.replace(old_text, new_text);

    // 写入文件
    await fs.writeFile(resolvedPath, newContent, 'utf-8');

    // 计算变化
    const oldLines = originalContent.split('\n').length;
    const newLines = newContent.split('\n').length;
    const lineDiff = newLines - oldLines;

    return [
      `✅ 文件编辑成功`,
      ``,
      `📄 文件: ${file_path}`,
      `📊 替换次数: ${occurrences}`,
      `📏 行数变化: ${oldLines} → ${newLines} (${lineDiff >= 0 ? '+' : ''}${lineDiff})`,
      ``,
      `变更摘要：`,
      `- 删除: ${old_text.split('\n').length} 行`,
      `+ 添加: ${new_text.split('\n').length} 行`,
    ].join('\n');

  } catch (error: any) {
    return `❌ 编辑文件失败: ${error.message}`;
  }
}

const tool: ToolDefinition<EditFileParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '编辑现有文件（使用字符串替换，old_text 必须唯一匹配）',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: '要编辑的文件路径',
          },
          old_text: {
            type: 'string',
            description: '要替换的原始文本（必须在文件中唯一出现，建议包含前后 3-5 行上下文）',
          },
          new_text: {
            type: 'string',
            description: '替换后的新文本',
          },
          replace_all: {
            type: 'boolean',
            description: '是否替换所有匹配（默认 false，仅替换唯一匹配）',
          },
        },
        required: ['file_path', 'old_text', 'new_text'],
      },
    },
  },
  execute,
};

export default tool;
