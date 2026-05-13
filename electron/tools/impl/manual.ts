/**
 * 工具：read_manual
 *
 * 按需加载用户自定义知识库（说明书 / Skills）。
 *
 * 支持两种存储格式：
 *
 * 1. 传统格式（electron/manual/）
 *    每个 .md 文件是一个主题，支持可选的 YAML frontmatter：
 *      manual/
 *        命令行操作.md       ← 可包含 ---\nname: ...\ndescription: ...\n--- 头部
 *        Python环境.md
 *        ...
 *
 * 2. Agent Skills 标准格式（electron/skills/）
 *    遵循 agentskills.io 开放标准，每个 skill 在独立文件夹中：
 *      skills/
 *        skill-name/
 *          SKILL.md          ← YAML frontmatter（name, description）+ Markdown 正文
 *        category/
 *          skill-name/
 *            SKILL.md        ← 支持嵌套分类
 *
 * 调用方式：
 *   read_manual()           → 返回所有可用主题目录（含 skills）
 *   read_manual("主题名")   → 返回该主题的完整内容（自动剥离 frontmatter）
 *
 * 设计原则（渐进式披露）：
 *   - 系统提示中只注入 name + description，不占大量 token
 *   - AI 需要完整指导时主动调用 read_manual(topic=...) 加载全文
 *   - 与 Hermes Agent / VS Code Copilot 的 Agent Skills 标准兼容
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { ToolDefinition } from '../types';

/**
 * 目录路径（兼容开发模式和打包后）
 */
const MANUAL_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'electron', 'manual')
  : path.join(app.getAppPath(), 'electron', 'manual');

const SKILLS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'electron', 'skills')
  : path.join(app.getAppPath(), 'electron', 'skills');

// ─── Frontmatter 工具 ─────────────────────────────────────────────────────────

/**
 * 解析 YAML frontmatter 中的简单 key: value 对（不依赖外部 yaml 库）。
 * 仅提取字符串类型的顶层字段，够用于 name / description / version 等。
 */
function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 3);
  if (end === -1) return {};
  const yaml = content.slice(3, end);
  const result: Record<string, string> = {};
  for (const line of yaml.split('\n')) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.+)/);
    if (m) result[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return result;
}

/** 去除 YAML frontmatter，返回正文（首行空白已去除）。*/
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  return content.slice(end + 4).trimStart();
}

// ─── 主题枚举 ─────────────────────────────────────────────────────────────────

/** 内部主题条目，filePath 可指向 .md 或 SKILL.md */
type TopicEntry = { name: string; summary: string; category: string; filePath: string };

/**
 * 枚举所有可用主题：
 *   1. electron/manual/ 下的 **\/*.md 文件（支持可选 frontmatter）
 *   2. electron/skills/ 下的 *\/*\/SKILL.md 文件（Agent Skills 标准格式）
 */
function listTopics(): TopicEntry[] {
  const results: TopicEntry[] = [];

  // ── 1. 传统 manual/ 目录 ──────────────────────────────────────────
  if (fs.existsSync(MANUAL_DIR)) {
    function scanManualDir(dir: string, category: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanManualDir(fullPath, entry.name);
        } else if (entry.name.endsWith('.md') && entry.name !== 'SKILL.md') {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const fm = parseFrontmatter(content);
            // frontmatter 中的 name/description 优先，否则回退到文件名/首行
            const topicName = fm.name || entry.name.replace(/\.md$/, '');
            let summary = fm.description || '';
            if (!summary) {
              const body = stripFrontmatter(content);
              summary = body
                .split('\n')
                .map(l => l.replace(/^#+\s*/, '').trim())
                .find(l => l.length > 0)
                ?.slice(0, 80) ?? '';
            }
            results.push({ name: topicName, summary, category, filePath: fullPath });
          } catch { /* ignore */ }
        }
      }
    }
    scanManualDir(MANUAL_DIR, '');
  }

  // ── 2. Agent Skills 标准格式：skills/[category/]skill-name/SKILL.md ──
  if (fs.existsSync(SKILLS_DIR)) {
    function scanSkillsDir(dir: string, category: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const subDir = path.join(dir, entry.name);
        const skillFile = path.join(subDir, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          // 这是一个 skill 文件夹
          try {
            const content = fs.readFileSync(skillFile, 'utf-8');
            const fm = parseFrontmatter(content);
            const topicName = fm.name || entry.name;
            const summary = (fm.description || '').slice(0, 100);
            const cat = category || 'skills';
            results.push({ name: topicName, summary, category: cat, filePath: skillFile });
          } catch { /* ignore */ }
        } else {
          // 可能是分类目录，递归进去
          scanSkillsDir(subDir, entry.name);
        }
      }
    }
    scanSkillsDir(SKILLS_DIR, '');
  }

  return results;
}

/**
 * 匹配主题名，返回文件路径或 null。
 *
 * 匹配优先级（按顺序，首个命中即返回）：
 *   ① 文件名与 topic 完全相等
 *   ② 文件名包含 topic 整体
 *   ③ topic 拆词后，文件名包含任意一个词（词长 ≥ 2）
 *   ④ 全文搜索：各文件正文中 topic 各词的命中次数求和，返回得分最高的
 *
 * 支持递归子目录搜索。
 */
function resolveTopicFile(topic: string): string | null {
  const topics = listTopics();
  if (topics.length === 0) return null;

  const topicLower = topic.toLowerCase().trim();

  // 拆词：按空格、标点、CJK 边界拆分，过滤掉长度 < 2 的词
  const words = topicLower
    .split(/[\s\p{P}\p{Z}，。、？！：；""''（）【】]/u)
    .filter(w => w.length >= 2);

  // ① 精确匹配文件名
  const exact = topics.find(t => t.name.toLowerCase() === topicLower);
  if (exact) return exact.filePath;

  // ② 文件名包含 topic 整体
  const fuzzy = topics.find(t => t.name.toLowerCase().includes(topicLower));
  if (fuzzy) return fuzzy.filePath;

  // ③ 任意词命中文件名
  if (words.length > 0) {
    const wordHit = topics.find(t => {
      const fn = t.name.toLowerCase();
      return words.some(w => fn.includes(w));
    });
    if (wordHit) return wordHit.filePath;
  }

  // ④ 全文搜索：各词命中次数求和，取最高分
  const searchWords = words.length > 0 ? words : [topicLower];
  let bestTopic: typeof topics[0] | null = null;
  let bestScore = 0;
  for (const t of topics) {
    try {
      const content = fs.readFileSync(t.filePath, 'utf-8').toLowerCase();
      const score = searchWords.reduce((sum, w) => sum + (content.split(w).length - 1), 0);
      if (score > bestScore) {
        bestScore = score;
        bestTopic = t;
      }
    } catch { /* ignore */ }
  }
  if (bestTopic) return bestTopic.filePath;

  return null;
}

/**
 * 返回当前可用说明书 / Skills 主题列表，格式化为适合注入 system prompt 的字符串。
 * 每次对话初始化时调用，让 AI 在第一个 token 起就知道有哪些知识可查。
 * 遵循渐进式披露：此处只注入 name + description，全文内容由 AI 按需调用 read_manual 加载。
 */
export function getManualTopicsForPrompt(): string {
  const topics = listTopics();
  if (topics.length === 0) return '';

  // 按分类分组
  const grouped = new Map<string, TopicEntry[]>();
  for (const t of topics) {
    const cat = t.category || '通用';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(t);
  }

  const lines: string[] = [];
  for (const [cat, items] of grouped) {
    if (cat && cat !== '通用') lines.push(`  [${cat}]`);
    for (const t of items) {
      lines.push(t.summary ? `    • ${t.name}（${t.summary}）` : `    • ${t.name}`);
    }
  }

  return (
    '\n\n【可用说明书 / Skills 目录】（共 ' + topics.length + ' 项）\n' +
    lines.join('\n') + '\n' +
    '调用 read_manual(topic="主题名") 查阅完整内容，topic 支持模糊匹配和跨目录搜索。'
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
        '查阅本地知识库（说明书 / Skills），获取特定操作的规范步骤、命令写法或工作流程。\n' +
        '【何时调用】\n' +
        '  • 不确定某个命令/操作的正确写法时（如 Windows 磁盘查询、conda 操作等）\n' +
        '  • run_command 或其他工具执行失败，需要查阅正确用法时\n' +
        '  • 调试超过 3 次仍未解决时，查阅"系统化调试工作流"方法论\n' +
        '  • 实现新功能或修复 bug 前，查阅"测试驱动开发"了解 TDD 流程\n' +
        '  • 复杂任务需要分解时，查阅"任务规划工作流"指导\n' +
        '  • 用户提到"按说明书操作"、"翻一下手册"、"查一下 skill"时\n' +
        '【何时创建新说明书】\n' +
        '  复杂任务成功完成后（5+ 工具调用、多次迭代、克服错误），主动询问用户是否将工作流程保存为新说明书。\n' +
        '  使用 manual_manage 工具创建。保存前必须征得用户同意。\n' +
        '  跳过简单的一次性任务。优先考虑可复用的流程、用户纠正过的方法、非平凡的工作流。\n' +
        '【用法】\n' +
        '  不传 topic → 列出所有可用主题（先看目录，再决定读哪一篇）\n' +
        '  传 topic   → 返回该主题的完整内容（自动剥离 YAML frontmatter）\n' +
        'topic 支持模糊匹配，如 topic="调试" 可匹配"系统化调试工作流"。',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description:
              '要查阅的主题名称（模糊匹配，支持中英文）。不填则返回所有可用主题目录。',
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
          '📖 知识库目录为空。\n' +
          `说明书路径：${MANUAL_DIR}\n` +
          `Skills 路径：${SKILLS_DIR}\n` +
          '可在 manual/ 下创建 .md 文件，或在 skills/ 下创建 skill-name/SKILL.md 文件。'
        );
      }

      // 按分类分组展示
      const grouped = new Map<string, TopicEntry[]>();
      for (const t of topics) {
        const cat = t.category || '通用';
        if (!grouped.has(cat)) grouped.set(cat, []);
        grouped.get(cat)!.push(t);
      }

      const lines: string[] = [];
      for (const [cat, items] of grouped) {
        if (cat && cat !== '通用') lines.push(`\n📂 ${cat}/`);
        for (const t of items) {
          lines.push(t.summary ? `  • ${t.name}  —  ${t.summary}` : `  • ${t.name}`);
        }
      }

      return (
        `📖 可用知识库主题（共 ${topics.length} 项）：\n${lines.join('\n')}\n\n` +
        '调用 read_manual(topic="主题名") 查阅具体内容。'
      );
    }

    // ── 有主题：返回内容 ──────────────────────────────────────────
    const filePath = resolveTopicFile(topic);
    if (!filePath) {
      const topics = listTopics();
      if (topics.length === 0) {
        return `❌ 未找到主题"${topic}"，且知识库当前为空（manual: ${MANUAL_DIR}，skills: ${SKILLS_DIR}）。`;
      }
      const topicLines = topics.map(t =>
        t.summary ? `  • ${t.name}  —  ${t.summary}` : `  • ${t.name}`
      ).join('\n');
      return (
        `❌ 未找到与"${topic}"匹配的主题。\n\n` +
        `📖 当前可用主题（共 ${topics.length} 项）：\n${topicLines}\n\n` +
        '请根据以上目录选择最相关的主题，重新调用 read_manual(topic="主题名") 查阅。'
      );
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8').trim();
      if (!raw) {
        const topicName = path.basename(filePath, '.md');
        return `⚠️ 说明书"${topicName}"内容为空。`;
      }

      // 从 frontmatter 提取显示名称（SKILL.md 用父目录名兜底，.md 用文件名兜底）
      const fm = parseFrontmatter(raw);
      const isSkillMd = path.basename(filePath) === 'SKILL.md';
      const topicName = fm.name
        || (isSkillMd ? path.basename(path.dirname(filePath)) : path.basename(filePath, '.md'));

      // 正文：去除 frontmatter
      const body = stripFrontmatter(raw);

      // 限制最大返回长度防止塞满 context
      const MAX = 3000;
      const truncated = body.length > MAX
        ? body.slice(0, MAX) + `\n\n…（内容已截断，原文 ${body.length} 字）`
        : body;
      return `📖 【${topicName}】\n\n${truncated}`;
    } catch (e) {
      return `❌ 读取说明书失败：${(e as Error).message}`;
    }
  },
};

export default readManualTool;
