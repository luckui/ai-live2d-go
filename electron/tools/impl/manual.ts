/**
 * 工具：read_manual
 *
 * 按需加载用户自定义知识库（说明书）。
 *
 * 说明书存放于 electron/manual/ 目录，每个 .md 文件是一个主题：
 *   manual/
 *     命令行操作.md       ← 查磁盘/网络/进程等常用命令
 *     Python环境.md       ← conda/venv/pip 操作规范
 *     工作流程.md         ← 用户自定义的任务操作流程
 *     ...（用户自由扩展）
 *
 * 调用方式：
 *   read_manual()           → 返回所有可用主题目录（文件名列表 + 首行摘要）
 *   read_manual("命令行操作") → 返回该主题的完整说明书内容
 *
 * 设计原则：
 *   - 平时不注入系统提示，不占 token
 *   - AI 不确定操作方法时主动调用，或工具失败后查阅
 *   - 用户用 Markdown 自由书写，无格式强制要求
 *   - topic 匹配：先精确，再模糊（文件名包含 topic）
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { ToolDefinition } from '../types';

/**
 * 说明书目录路径（兼容开发模式和打包后）
 *
 * 开发时：app.getAppPath() 返回项目根目录
 * 打包后：process.resourcesPath 指向 resources/ 目录（需在 electron-builder 中配置 extraResources）
 */
const MANUAL_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'electron', 'manual')
  : path.join(app.getAppPath(), 'electron', 'manual');

/** 读取 manual 目录下所有 .md 文件，返回 { name, firstLine } 列表 */
function listTopics(): Array<{ name: string; summary: string }> {
  if (!fs.existsSync(MANUAL_DIR)) return [];
  return fs
    .readdirSync(MANUAL_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const topicName = f.replace(/\.md$/, '');
      let summary = '';
      try {
        const content = fs.readFileSync(path.join(MANUAL_DIR, f), 'utf-8');
        // 取第一行非空非标题符号的文字作为摘要
        const firstLine = content
          .split('\n')
          .map(l => l.replace(/^#+\s*/, '').trim())
          .find(l => l.length > 0) ?? '';
        summary = firstLine.slice(0, 60);
      } catch { /* ignore */ }
      return { name: topicName, summary };
    });
}

/**
 * 匹配主题名，返回文件路径或 null。
 *
 * 匹配优先级（按顺序，首个命中即返回）：
 *   ① 文件名与 topic 完全相等
 *   ② 文件名包含 topic 整体
 *   ③ topic 拆词后，文件名包含任意一个词（词长 ≥ 2）
 *   ④ 全文搜索：各文件正文中 topic 各词的命中次数求和，返回得分最高的
 */
function resolveTopicFile(topic: string): string | null {
  if (!fs.existsSync(MANUAL_DIR)) return null;
  const topicLower = topic.toLowerCase().trim();
  const files = fs.readdirSync(MANUAL_DIR).filter(f => f.endsWith('.md'));
  if (files.length === 0) return null;

  // 拆词：按空格、标点、CJK 边界拆分，过滤掉长度 < 2 的词
  const words = topicLower
    .split(/[\s\p{P}\p{Z}，。、？！：；""''（）【】]/u)
    .filter(w => w.length >= 2);

  // ① 精确
  const exact = files.find(f => f.replace(/\.md$/, '').toLowerCase() === topicLower);
  if (exact) return path.join(MANUAL_DIR, exact);

  // ② 整体包含
  const fuzzy = files.find(f => f.toLowerCase().includes(topicLower));
  if (fuzzy) return path.join(MANUAL_DIR, fuzzy);

  // ③ 任意词命中文件名
  if (words.length > 0) {
    const wordHit = files.find(fName => {
      const fn = fName.toLowerCase();
      return words.some(w => fn.includes(w));
    });
    if (wordHit) return path.join(MANUAL_DIR, wordHit);
  }

  // ④ 全文搜索：各词命中次数求和，取最高分
  const searchWords = words.length > 0 ? words : [topicLower];
  let bestFile: string | null = null;
  let bestScore = 0;
  for (const f of files) {
    try {
      const content = fs.readFileSync(path.join(MANUAL_DIR, f), 'utf-8').toLowerCase();
      const score = searchWords.reduce((sum, w) => sum + (content.split(w).length - 1), 0);
      if (score > bestScore) {
        bestScore = score;
        bestFile = f;
      }
    } catch { /* ignore */ }
  }
  if (bestFile) return path.join(MANUAL_DIR, bestFile);

  return null;
}

/**
 * 返回当前可用说明书主题列表，格式化为适合注入 system prompt 的字符串。
 * 每次对话初始化时调用，让 AI 在第一个 token 起就知道有哪些说明书可查。
 */
export function getManualTopicsForPrompt(): string {
  const topics = listTopics();
  if (topics.length === 0) return '';
  const lines = topics.map(t =>
    t.summary ? `  • ${t.name}（${t.summary}）` : `  • ${t.name}`
  );
  return (
    '\n\n【可用说明书目录】（共 ' + topics.length + ' 篇）\n' +
    lines.join('\n') + '\n' +
    '遇到不确定的命令写法时，直接调用 read_manual(topic="主题名") 查阅，topic 支持模糊匹配和全文搜索。'
  );
}

interface ReadManualParams {
  topic?: string;
}

const readManualTool: ToolDefinition<ReadManualParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'read_manual',
      description:
        '查阅用户编写的本地知识库（说明书），获取特定操作的规范步骤或命令写法。\n' +
        '【何时调用】\n' +
        '  • 不确定某个命令/操作的正确写法时（如 Windows 磁盘查询、conda 操作等）\n' +
        '  • run_command 或其他工具执行失败，需要查阅正确用法时\n' +
        '  • 调试超过 3 次仍未解决时，查阅"系统化调试工作流"方法论\n' +
        '  • 实现新功能或修复 bug 前，查阅"测试驱动开发"了解 TDD 流程\n' +
        '  • 复杂任务需要分解时，查阅"任务规划工作流"指导\n' +
        '  • 用户提到"按说明书操作"、"翻一下手册"时\n' +
        '【可用主题】\n' +
        '  命令行操作、浏览器操作、Python环境、系统化调试工作流、测试驱动开发、任务规划工作流\n' +
        '【何时创建新说明书】\n' +
        '  复杂任务成功完成后（5+ 工具调用、多次迭代、克服错误），主动询问用户是否将工作流程保存为新说明书。\n' +
        '  使用 manual_manage 工具创建。保存前必须征得用户同意。\n' +
        '  跳过简单的一次性任务。优先考虑可复用的流程、用户纠正过的方法、非平凡的工作流。\n' +
        '【用法】\n' +
        '  不传 topic → 列出所有可用主题（先看目录，再决定读哪一篇）\n' +
        '  传 topic   → 返回该主题的完整说明书内容\n' +
        '主题名支持模糊匹配，如 topic="调试" 可匹配"系统化调试工作流.md"。',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description:
              '要查阅的主题名称（模糊匹配文件名）。不填则返回所有可用主题目录。',
          },
        },
        required: [],
      },
    },
  },

  execute({ topic }): string {
    // ── 无主题：列出目录 ──────────────────────────────────────────
    if (!topic) {
      const topics = listTopics();
      if (topics.length === 0) {
        return (
          '📖 说明书目录为空。\n' +
          `知识库路径：${MANUAL_DIR}\n` +
          '请在该目录下创建 .md 文件，每个文件对应一个主题（如"命令行操作.md"）。'
        );
      }
      const lines = topics.map(t =>
        t.summary ? `  • ${t.name}  —  ${t.summary}` : `  • ${t.name}`
      );
      return (
        `📖 可用说明书主题（共 ${topics.length} 篇）：\n${lines.join('\n')}\n\n` +
        '调用 read_manual(topic="主题名") 查阅具体内容。'
      );
    }

    // ── 有主题：返回内容 ──────────────────────────────────────────
    const filePath = resolveTopicFile(topic);
    if (!filePath) {
      const topics = listTopics();
      if (topics.length === 0) {
        return `❌ 未找到主题"${topic}"对应的说明书，且说明书目录当前为空（路径：${MANUAL_DIR}）。`;
      }
      const topicLines = topics.map(t =>
        t.summary ? `  • ${t.name}  —  ${t.summary}` : `  • ${t.name}`
      ).join('\n');
      return (
        `❌ 未找到与"${topic}"匹配的说明书。\n\n` +
        `📖 当前可用说明书（共 ${topics.length} 篇）：\n${topicLines}\n\n` +
        '请根据以上目录选择最相关的主题，重新调用 read_manual(topic="主题名") 查阅。'
      );
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      const topicName = path.basename(filePath, '.md');
      if (!content) return `⚠️ 说明书"${topicName}"内容为空。`;
      // 限制最大返回长度防止塞满 context
      const MAX = 3000;
      const truncated = content.length > MAX
        ? content.slice(0, MAX) + `\n\n…（内容已截断，原文 ${content.length} 字）`
        : content;
      return `📖 【${topicName}】\n\n${truncated}`;
    } catch (e) {
      return `❌ 读取说明书失败：${(e as Error).message}`;
    }
  },
};

export default readManualTool;
