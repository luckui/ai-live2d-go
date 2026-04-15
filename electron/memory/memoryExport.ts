/**
 * 全局核心记忆 - 导出/导入工具
 *
 * 支持 Hermes 风格结构化记忆（USER + MEMORY 分块）
 *
 * 提供 IPC 接口，让用户可以：
 *   1. 导出当前全局记忆为 Markdown 文件（global_memory.md）
 *   2. 手动编辑 Markdown 文件（修正错误、添加信息）
 *   3. 重新导入覆盖数据库中的全局记忆
 *
 * 使用场景：
 *   - 用户发现 AI 记错了某些信息，需要手动修正
 *   - 用户想批量编辑记忆内容
 *   - 用户需要备份/迁移记忆数据
 *
 * 未来扩展：
 *   - 支持版本历史（每次导入前备份旧版本）
 *   - 支持多配置文件（工作/个人不同画像）
 */

import { dialog, app } from 'electron';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import type { StructuredGlobalMemory } from '../db';

/**
 * 生成导出的 Markdown 内容（Hermes 风格）
 */
export function generateMemoryMarkdown(memory: StructuredGlobalMemory): string {
  const timestamp = new Date().toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const userCount = memory.user.length;
  const memoryCount = memory.memory.length;
  const totalEntries = userCount + memoryCount;

  if (totalEntries === 0) {
    return (
      `# 全局核心记忆\n\n` +
      `> 导出时间：${timestamp}\n\n` +
      `## 状态\n\n` +
      `当前无记忆内容。\n\n` +
      `## 使用说明\n\n` +
      `本文件采用 Hermes 风格结构化记忆格式，分为两个部分：\n\n` +
      `### USER（用户画像）\n` +
      `记录用户的身份、偏好、习惯、沟通风格。例如：\n` +
      `\`\`\`\n` +
      `用户是高级 TypeScript 开发者，擅长 Electron 和 Vue.js\n` +
      `§\n` +
      `用户偏好简洁的代码风格，不喜欢冗长的注释\n` +
      `\`\`\`\n\n` +
      `### MEMORY（环境配置）\n` +
      `记录系统环境、工具特性、项目约定、经验教训。例如：\n` +
      `\`\`\`\n` +
      `当前项目使用 pnpm 作为包管理器\n` +
      `§\n` +
      `Discord API 需要配置代理（国内环境）\n` +
      `\`\`\`\n\n` +
      `⚠️ 每条记忆用 § 符号分隔\n\n` +
      `---\n\n` +
      `## USER（用户画像）\n\n` +
      `（在此添加用户画像条目，每条用 § 分隔）\n\n` +
      `---\n\n` +
      `## MEMORY（环境配置）\n\n` +
      `（在此添加环境配置条目，每条用 § 分隔）\n`
    );
  }

  const userChars = memory.user.join('').length;
  const memoryChars = memory.memory.join('').length;

  return (
    `# 全局核心记忆\n\n` +
    `> 导出时间：${timestamp}\n` +
    `> 总条目数：${totalEntries}（USER: ${userCount}，MEMORY: ${memoryCount}）\n` +
    `> 字符数：USER ${userChars}/1100，MEMORY ${memoryChars}/1800\n\n` +
    `## 使用说明\n\n` +
    `1. 直接编辑下方「USER」和「MEMORY」部分\n` +
    `2. 每条记忆用 **§** 符号分隔（换行不影响）\n` +
    `3. 保存文件后，在应用中点击「导入记忆」加载\n\n` +
    `⚠️ 导入后会完全覆盖当前记忆，建议先备份。\n\n` +
    `---\n\n` +
    `## USER（用户画像）\n\n` +
    `${memory.user.join(' § ')}\n\n` +
    `---\n\n` +
    `## MEMORY（环境配置）\n\n` +
    `${memory.memory.join(' § ')}\n`
  );
}

/**
 * 从 Markdown 内容中提取记忆（支持 Hermes 格式和旧格式）
 */
export function parseMemoryMarkdown(markdown: string): StructuredGlobalMemory {
  // 尝试解析 Hermes 格式（## USER 和 ## MEMORY 分块）
  const userMatch = markdown.match(/##\s*USER[（(]用户画像[）)]\s*\n+([\s\S]*?)(?=\n##|$)/i);
  const memoryMatch = markdown.match(/##\s*MEMORY[（(]环境配置[）)]\s*\n+([\s\S]*?)(?=\n##|$)/i);

  if (userMatch || memoryMatch) {
    // Hermes 格式
    const userText = userMatch ? userMatch[1].trim() : '';
    const memoryText = memoryMatch ? memoryMatch[1].trim() : '';

    const user = userText
      ? userText.split('§').map(s => s.trim()).filter(Boolean)
      : [];
    const memory = memoryText
      ? memoryText.split('§').map(s => s.trim()).filter(Boolean)
      : [];

    return { user, memory };
  }

  // 旧格式兼容：查找 "## 记忆内容" 标记
  const legacyMatch = markdown.match(/##\s*记忆内容\s*\n+([\s\S]*)/i);
  if (legacyMatch) {
    const content = legacyMatch[1].trim();
    // 将旧格式内容归入 MEMORY 块
    return {
      user: [],
      memory: content ? [content] : [],
    };
  }

  // 纯文本：无标记，直接返回全部内容归入 MEMORY
  const plainText = markdown.trim();
  return {
    user: [],
    memory: plainText ? [plainText] : [],
  };
}

// ── IPC Handler 实现示例（供 main.ts 调用）────────────────

/**
 * 导出记忆为 Markdown 文件
 * 返回：{ success: true, path: string } 或 { success: false, error: string }
 */
export async function exportMemoryToMarkdown(memory: StructuredGlobalMemory): Promise<{
  success: boolean;
  path?: string;
  error?: string;
}> {
  try {
    const defaultPath = join(app.getPath('documents'), 'global_memory.md');
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: '导出全局核心记忆',
      defaultPath,
      filters: [{ name: 'Markdown Files', extensions: ['md'] }],
    });

    if (canceled || !filePath) {
      return { success: false, error: '用户取消导出' };
    }

    const markdown = generateMemoryMarkdown(memory);
    writeFileSync(filePath, markdown, 'utf-8');

    return { success: true, path: filePath };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * 从 Markdown 文件导入记忆
 * 返回：{ success: true, content: StructuredGlobalMemory } 或 { success: false, error: string }
 */
export async function importMemoryFromMarkdown(): Promise<{
  success: boolean;
  content?: StructuredGlobalMemory;
  error?: string;
}> {
  try {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: '导入全局核心记忆',
      filters: [
        { name: 'Markdown Files', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (canceled || !filePaths || filePaths.length === 0) {
      return { success: false, error: '用户取消导入' };
    }

    const markdown = readFileSync(filePaths[0], 'utf-8');
    const content = parseMemoryMarkdown(markdown);

    if (content.user.length === 0 && content.memory.length === 0) {
      return { success: false, error: '文件内容为空或格式不正确' };
    }

    // 验证字符数限制（Hermes 风格：USER 1100字，MEMORY 1800字）
    const userChars = content.user.join('').length;
    const memoryChars = content.memory.join('').length;

    if (userChars > 1100) {
      return {
        success: false,
        error: `USER（用户画像）内容过长：${userChars} 字符（上限 1100）\n请精简后重新导入`,
      };
    }

    if (memoryChars > 1800) {
      return {
        success: false,
        error: `MEMORY（环境配置）内容过长：${memoryChars} 字符（上限 1800）\n请精简后重新导入`,
      };
    }

    return { success: true, content };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
