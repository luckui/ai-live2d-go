/**
 * 文件操作工具 - read_file
 * 
 * 读取文件内容，支持行范围读取、大文件分页。
 * 借鉴 Hermes Agent 的 read_file_tool 设计。
 * 
 * 特性：
 *   - 行范围读取（startLine, endLine）
 *   - 大文件保护（最大 10000 行警告）
 *   - 二进制文件检测
 *   - 行号显示
 */

import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition } from '../types';

interface ReadFileParams {
  file_path: string;
  start_line?: number;
  end_line?: number;
}

async function execute(params: ReadFileParams): Promise<string> {
  const { file_path, start_line = 1, end_line } = params;

  try {
    // 解析路径
    const resolvedPath = path.isAbsolute(file_path)
      ? file_path
      : path.resolve(process.cwd(), file_path);

    // 检查文件是否存在
    try {
      await fs.access(resolvedPath);
    } catch {
      return `❌ 文件不存在: ${file_path}`;
    }

    // 检查是否为二进制文件（简单检测：通过扩展名）
    const binaryExtensions = [
      '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp',
      '.mp4', '.avi', '.mov', '.mkv', '.mp3', '.wav',
      '.zip', '.tar', '.gz', '.rar', '.7z',
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    ];
    const ext = path.extname(resolvedPath).toLowerCase();
    if (binaryExtensions.includes(ext)) {
      // 按类型给出不同的引导提示
      const docExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'];
      const imgExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

      let hint: string;
      if (docExtensions.includes(ext)) {
        // 根据扩展名给出一步到位的 python -c 命令
        const escapedPath = file_path.replace(/\\/g, '\\\\');
        let pySnippet = '';
        if (ext === '.docx' || ext === '.doc') {
          pySnippet = `from docx import Document; print('\\n'.join(p.text for p in Document(r'${escapedPath}').paragraphs))`;
        } else if (ext === '.pdf') {
          pySnippet = `import pymupdf; doc=pymupdf.open(r'${escapedPath}'); [print(p.get_text()) for p in doc]`;
        } else if (ext === '.xlsx' || ext === '.xls') {
          pySnippet = `from openpyxl import load_workbook; wb=load_workbook(r'${escapedPath}',data_only=True); [print('\\t'.join(str(c) if c else '' for c in row)) for ws in wb for row in ws.iter_rows(values_only=True)]`;
        } else {
          pySnippet = `from pptx import Presentation; prs=Presentation(r'${escapedPath}'); [print(s.text) for sl in prs.slides for s in sl.shapes if s.has_text_frame]`;
        }
        hint = [
          `❌ 无法直接读取文档文件: ${file_path} (${ext})`,
          '',
          '💡 一步提取（直接复制执行，run_command 会返回 stdout）：',
          `   run_command({ command: "python -c \\"${pySnippet}\\"" })`,
          '',
          '   ⚠️ 脚本必须 print()！run_command 直接返回输出，无需写临时文件再读取。',
          '   ⚠️ 首次需安装依赖：run_command({ command: "pip install python-docx pymupdf openpyxl python-pptx" })',
          '   📖 更多格式详见 read_manual("文档读取")',
        ].join('\n');
      } else if (imgExtensions.includes(ext)) {
        hint = `❌ 无法读取图片文件: ${file_path} (${ext})\n提示：使用 take_screenshot 工具查看图片。`;
      } else {
        hint = `❌ 无法读取二进制文件: ${file_path} (${ext})`;
      }
      return hint;
    }

    // 读取文件内容
    const content = await fs.readFile(resolvedPath, 'utf-8');
    const lines = content.split('\n');
    const totalLines = lines.length;

    // 验证行号范围
    if (start_line > totalLines) {
      return `❌ 起始行号 ${start_line} 超出文件范围（文件共 ${totalLines} 行）`;
    }

    const effectiveEndLine = end_line
      ? Math.min(end_line, totalLines)
      : totalLines;

    if (start_line > effectiveEndLine) {
      return `❌ 起始行号 ${start_line} 大于结束行号 ${effectiveEndLine}`;
    }

    // 提取指定行范围
    const selectedLines = lines.slice(start_line - 1, effectiveEndLine);
    
    // 添加行号
    const numberedLines = selectedLines.map((line, index) => {
      const lineNum = start_line + index;
      return `${lineNum.toString().padStart(4, ' ')} | ${line}`;
    });

    // 构建结果
    const result = [
      `📄 文件: ${file_path}`,
      `📊 总行数: ${totalLines} 行`,
      `📍 显示范围: 第 ${start_line} - ${effectiveEndLine} 行`,
      '',
      numberedLines.join('\n'),
    ];

    // 大文件警告
    if (effectiveEndLine - start_line + 1 > 1000) {
      result.push('');
      result.push('⚠️ 警告：读取了超过 1000 行，建议使用 start_line/end_line 参数分页读取。');
    }

    // 分页提示
    if (end_line && effectiveEndLine < totalLines) {
      result.push('');
      result.push(`💡 提示：还有更多内容，使用 start_line=${effectiveEndLine + 1} 继续读取。`);
    }

    return result.join('\n');

  } catch (error: any) {
    return `❌ 读取文件失败: ${error.message}`;
  }
}

const tool: ToolDefinition<ReadFileParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取文件内容（支持行范围读取，用于查看代码文件）',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: '要读取的文件路径（支持相对路径和绝对路径）',
          },
          start_line: {
            type: 'number',
            description: '起始行号（从 1 开始，默认为 1）',
          },
          end_line: {
            type: 'number',
            description: '结束行号（包含该行，默认读取到文件末尾）',
          },
        },
        required: ['file_path'],
      },
    },
  },
  execute,
};

export default tool;
