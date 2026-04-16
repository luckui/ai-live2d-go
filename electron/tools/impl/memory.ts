/**
 * Memory Tool - AI 主动管理全局核心记忆
 *
 * 设计理念（参考 Hermes memory_tool）：
 * - AI 察觉到用户画像/偏好/重要信息时，主动调用此工具保存
 * - 直接操作 global_memory（数据库单字段），不依赖片段累积
 * - 安全扫描：防止 prompt injection、凭证泄露、后门植入
 * - 支持 read（读取）、replace（替换）两种操作
 *
 * 与现有记忆系统的关系：
 * - memory_tool：AI 主动策展，高优先级核心记忆（用户画像、偏好）
 * - memoryManager：自动总结，兜底历史记忆（对话细节、上下文）
 * - 两者互补，同时注入 system prompt
 */

import type { ToolDefinition } from '../types';
import { getStructuredGlobalMemory, setStructuredGlobalMemory, searchMemoryFragments, smartTokenize } from '../../db';

// ── 安全扫描配置 ──────────────────────────────────────────

/**
 * 威胁模式检测（参考 Hermes memory_tool）
 * 记忆内容会注入 system prompt，必须严格过滤注入攻击和凭证泄露
 */
const THREAT_PATTERNS = [
  // Prompt injection
  { pattern: /ignore\s+(previous|all|above|prior)\s+instructions/i, id: 'prompt_injection' },
  { pattern: /you\s+are\s+now\s+/i, id: 'role_hijack' },
  { pattern: /do\s+not\s+tell\s+the\s+user/i, id: 'deception_hide' },
  { pattern: /system\s+prompt\s+override/i, id: 'sys_prompt_override' },
  { pattern: /disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i, id: 'disregard_rules' },
  { pattern: /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i, id: 'bypass_restrictions' },
  
  // 凭证泄露（通过 curl/wget 外传）
  { pattern: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: 'exfil_curl' },
  { pattern: /wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: 'exfil_wget' },
  { pattern: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i, id: 'read_secrets' },
  
  // 后门植入
  { pattern: /authorized_keys/i, id: 'ssh_backdoor' },
  { pattern: /\$HOME\/\.ssh|~\/\.ssh/i, id: 'ssh_access' },
];

/**
 * 不可见字符检测（常用于隐藏注入代码）
 */
const INVISIBLE_CHARS = new Set([
  '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff',  // Zero-width chars
  '\u202a', '\u202b', '\u202c', '\u202d', '\u202e',  // BiDi override chars
]);

/**
 * 扫描记忆内容，检测安全威胁
 * @returns 如果发现威胁，返回错误描述；否则返回 null
 */
function scanMemoryContent(content: string): string | null {
  // 检查不可见字符
  for (const char of INVISIBLE_CHARS) {
    if (content.includes(char)) {
      return `❌ 安全拦截：记忆内容包含不可见字符 U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')} (可能为注入攻击)`;
    }
  }

  // 检查威胁模式
  for (const { pattern, id } of THREAT_PATTERNS) {
    if (pattern.test(content)) {
      return `❌ 安全拦截：记忆内容匹配威胁模式 '${id}'\n记忆会注入 system prompt，不得包含注入攻击或凭证泄露代码`;
    }
  }

  return null;
}

// ── 配置 ──────────────────────────────────────────────────

/** 用户画像最大字符数（Hermes USER.md 上限 1375，我们设为 1100） */
const MAX_USER_CHARS = 1100;
/** 环境配置最大字符数（Hermes MEMORY.md 上限 2200，我们设为 1800） */
const MAX_MEMORY_CHARS = 1800;

// ── 工具定义 ──────────────────────────────────────────────

interface MemoryParams {
  /** 操作类型 */
  action: 'read' | 'search' | 'add_user' | 'add_memory' | 'update_user' | 'update_memory';
  /** 搜索关键词（action=search 时必填） */
  query?: string;
  /** 新的记忆条目（action=add_* 时必填，单条精简描述） */
  entry?: string;
  /** 更新意图（action=update_* 第一阶段必填） */
  intent?: string;
  /** 最终完整记忆（action=update_* 第二阶段必填，§ 分隔） */
  final_content?: string;
}

const memoryTool: ToolDefinition<MemoryParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'memory',
      description:
        '【全局核心记忆管理】保存、搜索、更新跨对话的用户核心画像、环境配置和历史记忆。\n' +
        '\n' +
        '【结构化存储】\n' +
        '  • USER（用户画像）：用户偏好、习惯、身份、Discord/微信账号等\n' +
        '  • MEMORY（环境配置）：系统信息、工具版本、项目约定等\n' +
        '  • 历史片段：所有对话的自动总结（跨会话搜索）\n' +
        '\n' +
        '【何时主动调用】\n' +
        '  ✅ 用户明确告知个人信息（"我的Discord是louis066505"）→ add_user\n' +
        '  ✅ 用户纠正你或表达偏好（"我更喜欢TypeScript"）→ add_user\n' +
        '  ✅ 用户纠正之前的信息（"我不是学生，是研究生"）→ update_user\n' +
        '  ✅ 发现稳定环境事实（"conda环境sharp已激活"）→ add_memory\n' +
        '  ✅ 识别长期有用的工具特性或项目约定 → add_memory\n' +
        '  ✅ 用户问"我之前是怎么配置XX的"或"我上次说过什么" → search\n' +
        '  ✅ 记忆过时需要更新或删除 → update_user / update_memory\n' +
        '\n' +
        '【不要记录】\n' +
        '  ❌ 临时任务进度、本次对话细节、单次事件\n' +
        '  → 这些由自动记忆系统总结\n' +
        '\n' +
        '【操作说明】\n' +
        '• action=read          → 读取当前核心记忆（首次见面可调用）\n' +
        '• action=search        → 搜索核心记忆和历史片段（模糊搜索）\n' +
        '• action=add_user      → 添加用户画像条目（单条，精简）\n' +
        '• action=add_memory    → 添加环境配置条目（单条，精简）\n' +
        '• action=update_user   → 更新/删除/整理用户画像（两阶段交互）\n' +
        '• action=update_memory → 更新/删除/整理环境配置（两阶段交互）\n' +
        '\n' +
        '【更新操作的两阶段流程】\n' +
        '  1️⃣ 第一次调用：提供 intent（描述想要更新什么）\n' +
        '     → 返回当前记忆，请你基于此给出最终完整内容\n' +
        '  2️⃣ 第二次调用：提供 final_content（完整记忆，§ 分隔）\n' +
        '     → 保存更新后的记忆\n' +
        '\n' +
        '【重要】全局记忆已在 system prompt 中，无需每次 read；但 search 可以查找历史信息。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'search', 'add_user', 'add_memory', 'update_user', 'update_memory'],
            description: 
              'read=读取核心记忆，search=搜索历史记忆，' +
              'add_user=添加用户画像，add_memory=添加环境配置，' +
              'update_user=更新用户画像，update_memory=更新环境配置',
          },
          query: {
            type: 'string',
            description:
              '【action=search 时必填】搜索关键词，支持模糊匹配。\n' +
              '示例："Discord配置"、"Python环境"、"微信加密"',
          },
          entry: {
            type: 'string',
            description:
              '【action=add_* 时必填】单条记忆条目，精简描述。\n' +
              '示例："Discord账号louis066505"、"偏好TypeScript"、"conda环境sharp"',
          },
          intent: {
            type: 'string',
            description:
              '【action=update_* 第一阶段必填】更新意图描述。\n' +
              '示例："将身份从学生改为研究生"、"删除Discord频道ID"、"整理技术栈信息"',
          },
          final_content: {
            type: 'string',
            description:
              '【action=update_* 第二阶段必填】最终的完整记忆文本，条目之间用 § 分隔。\n' +
              '示例："Discord用户名：louis066505§身份为研究生§从事设计相关工作"',
          },
        },
        required: ['action'],
      },
    },
  },

  async execute({ action, query, entry, intent, final_content }) {
    // ══════════════════════════════════════════════════
    // action=read：读取当前记忆
    // ══════════════════════════════════════════════════
    if (action === 'read') {
      const current = getStructuredGlobalMemory();
      const hasContent = current.user.length > 0 || current.memory.length > 0;
      
      if (!hasContent) {
        return (
          '📭 全局核心记忆为空（首次对话或用户尚未分享核心信息）。\n\n' +
          '当用户告知个人信息或偏好时，请调用 memory(action="add_user") 保存到用户画像。'
        );
      }

      const parts: string[] = [];
      
      if (current.user.length > 0) {
        const userChars = current.user.join('').length;
        const userPct = Math.min(100, Math.round((userChars / MAX_USER_CHARS) * 100));
        parts.push(
          `📋 USER（用户画像）[${userPct}% — ${userChars}/${MAX_USER_CHARS} 字]：`,
          ...current.user.map((e, i) => `  ${i + 1}. ${e}`),
          ''
        );
      }
      
      if (current.memory.length > 0) {
        const memChars = current.memory.join('').length;
        const memPct = Math.min(100, Math.round((memChars / MAX_MEMORY_CHARS) * 100));
        parts.push(
          `🔧 MEMORY（环境配置）[${memPct}% — ${memChars}/${MAX_MEMORY_CHARS} 字]：`,
          ...current.memory.map((e, i) => `  ${i + 1}. ${e}`)
        );
      }

      return parts.join('\n');
    }

    // ══════════════════════════════════════════════════
    // action=search：搜索记忆（核心记忆 + 历史片段）
    // ══════════════════════════════════════════════════
    // action=search：搜索记忆（核心记忆 + 历史片段）
    // ══════════════════════════════════════════════════
    if (action === 'search') {
      if (!query || !query.trim()) {
        return '❌ action=search 时必须提供 query 参数（搜索关键词）';
      }

      // 1️⃣ 提取核心关键词（用户原始输入）
      const coreKeywords = query.trim().split(/[\s,，、]+/).filter(k => k.length > 0);
      
      // 2️⃣ 智能分词（含 2-gram，用于提高召回率）
      const allKeywords = smartTokenize(query.trim());
      
      const results: string[] = [];

      // 辅助函数：计算核心词匹配数
      const countCoreMatches = (text: string): number => {
        const lower = text.toLowerCase();
        return coreKeywords.filter(k => lower.includes(k.toLowerCase())).length;
      };

      // 辅助函数：高亮匹配的核心关键词（用【】标记）
      const highlightKeywords = (text: string): string => {
        let result = text;
        coreKeywords.forEach(k => {
          const regex = new RegExp(`(${k})`, 'gi');
          result = result.replace(regex, '【$1】');
        });
        return result;
      };

      // 3️⃣ 搜索全局核心记忆
      const current = getStructuredGlobalMemory();
      const matchedUser = current.user
        .map(e => ({ text: e, score: countCoreMatches(e) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ text }) => text);
      
      const matchedMemory = current.memory
        .map(e => ({ text: e, score: countCoreMatches(e) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ text }) => text);

      if (matchedUser.length > 0 || matchedMemory.length > 0) {
        results.push(`🔍 全局核心记忆中的匹配结果（核心词：${coreKeywords.join('、')}）：\n`);
        
        if (matchedUser.length > 0) {
          results.push('📋 USER（用户画像）：');
          matchedUser.forEach((e, i) => results.push(`  ${i + 1}. ${highlightKeywords(e)}`));
          results.push('');
        }
        
        if (matchedMemory.length > 0) {
          results.push('🔧 MEMORY（环境配置）：');
          matchedMemory.forEach((e, i) => results.push(`  ${i + 1}. ${highlightKeywords(e)}`));
          results.push('');
        }
      }

      // 4️⃣ 搜索历史记忆片段（跨会话，已在 db 层支持核心词优先排序）
      const fragments = searchMemoryFragments(query, 10); // 最多返回 10 条

      if (fragments.length > 0) {
        results.push(`📚 历史对话记忆片段（核心词全匹配优先）：\n`);
        fragments.forEach((frag, i) => {
          const date = new Date(frag.created_at).toLocaleString('zh-CN');
          const coreMatch = countCoreMatches(frag.content);
          const isFullMatch = coreMatch === coreKeywords.length;
          const badge = isFullMatch ? '🎯全匹配' : `📌${coreMatch}/${coreKeywords.length}`;
          const highlighted = highlightKeywords(frag.content);
          results.push(`${i + 1}. [${date}] [${badge}] ${highlighted}`);
        });
        results.push('');
      }

      // 无匹配结果
      if (results.length === 0) {
        return (
          `🔍 未找到与 "${query}" 相关的记忆。\n\n` +
          `🔤 核心关键词：${coreKeywords.join('、')}\n` +
          `🔍 扩展搜索（2-gram）：${allKeywords.join('、')}\n\n` +
          `💡 提示：\n` +
          `  • 尝试使用空格或逗号分隔关键词（如："上海 天气"）\n` +
          `  • 记忆系统会在对话过程中自动总结并保存\n` +
          `  • 如果用户告知重要信息，请用 memory(action="add_user/add_memory") 保存`
        );
      }

      return results.join('\n');
    }

    // ══════════════════════════════════════════════════
    // action=add_user / add_memory：添加条目
    // ══════════════════════════════════════════════════
    if (action === 'add_user' || action === 'add_memory') {
      if (!entry || !entry.trim()) {
        return `❌ action=${action} 时必须提供 entry 参数（新的记忆条目）`;
      }

      const trimmed = entry.trim();

      // 安全扫描
      const scanError = scanMemoryContent(trimmed);
      if (scanError) {
        return scanError;
      }

      const current = getStructuredGlobalMemory();
      const isUser = action === 'add_user';
      const targetArray = isUser ? current.user : current.memory;
      const maxChars = isUser ? MAX_USER_CHARS : MAX_MEMORY_CHARS;
      const label = isUser ? 'USER（用户画像）' : 'MEMORY（环境配置）';

      // 去重检查
      if (targetArray.some(e => e.includes(trimmed) || trimmed.includes(e))) {
        return `⚠️  ${label}中已包含类似内容，跳过重复添加。`;
      }

      // 添加条目
      targetArray.push(trimmed);

      // 容量检查（超出时删除最旧的条目）
      const totalChars = targetArray.join('').length;
      if (totalChars > maxChars) {
        const removed = targetArray.shift();
        console.warn(`[Memory] ${label}容量超限，删除最旧条目: ${removed?.slice(0, 50)}...`);
      }

      // 写入数据库
      try {
        setStructuredGlobalMemory(current);
        const finalChars = targetArray.join('').length;
        const pct = Math.min(100, Math.round((finalChars / maxChars) * 100));
        return (
          `✅ 已添加到${label}（${pct}% — ${finalChars}/${maxChars} 字）\n\n` +
          `${trimmed}\n\n` +
          `💡 此记忆将在所有未来对话中持续生效。`
        );
      } catch (e) {
        return `❌ 记忆保存失败：${(e as Error).message}`;
      }
    }

    // ══════════════════════════════════════════════════
    // action=update_user / update_memory：更新记忆（两阶段）
    // ══════════════════════════════════════════════════
    if (action === 'update_user' || action === 'update_memory') {
      const current = getStructuredGlobalMemory();
      const isUser = action === 'update_user';
      const label = isUser ? 'USER（用户画像）' : 'MEMORY（环境配置）';
      const maxChars = isUser ? MAX_USER_CHARS : MAX_MEMORY_CHARS;
      const currentEntries = isUser ? current.user : current.memory;

      // ─────────────────────────────────────────────
      // 第一阶段：展示当前记忆 + 提示 AI 给出最终内容
      // ─────────────────────────────────────────────
      if (!final_content) {
        if (!intent || !intent.trim()) {
          return (
            `❌ 第一阶段需要提供 intent 参数（描述想要更新的内容）。\n\n` +
            `示例：\n` +
            `  memory({ action: "${action}", intent: "将身份从学生改为研究生" })`
          );
        }

        // 构建当前记忆展示
        const currentContent = currentEntries.join('§');
        const currentChars = currentContent.length;
        const pct = Math.min(100, Math.round((currentChars / maxChars) * 100));

        if (currentEntries.length === 0) {
          return (
            `📭 ${label}当前为空。\n\n` +
            `💭 你的更新意图：${intent}\n\n` +
            `如果要添加新内容，请使用 memory(action="${action === 'update_user' ? 'add_user' : 'add_memory'}", entry="...") 更方便。`
          );
        }

        return (
          `📋 当前${label}内容（${pct}% — ${currentChars}/${maxChars} 字）：\n\n` +
          `${currentEntries.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}\n\n` +
          `────────────────────────────────────────\n\n` +
          `💭 你的更新意图：${intent}\n\n` +
          `📝 请基于以上内容，给出最终的完整记忆文本（条目之间用 § 分隔）：\n` +
          `   • 保留：需要保留的条目照写\n` +
          `   • 修改：需要修改的条目直接改写\n` +
          `   • 删除：不需要的条目直接不写\n` +
          `   • 新增：新增的条目直接加入\n\n` +
          `🔄 下次调用请带上 final_content 参数：\n` +
          `   memory({ action: "${action}", final_content: "条目1§条目2§条目3" })`
        );
      }

      // ─────────────────────────────────────────────
      // 第二阶段：保存最终记忆
      // ─────────────────────────────────────────────
      const trimmed = final_content.trim();
      if (trimmed.length === 0) {
        return `❌ final_content 不能为空。如果要清空${label}，请明确传入 "清空" 或类似文本。`;
      }

      // 解析新条目（按 § 分隔）
      const newEntries = trimmed.split('§').map(e => e.trim()).filter(Boolean);

      if (newEntries.length === 0) {
        return `❌ 解析后没有有效条目。请确保条目之间用 § 分隔。`;
      }

      // 安全扫描每个条目
      for (const entry of newEntries) {
        const scanError = scanMemoryContent(entry);
        if (scanError) {
          return `${scanError}\n\n问题条目：${entry}`;
        }
      }

      // 检查字符数限制
      const totalChars = newEntries.join('').length;
      if (totalChars > maxChars) {
        return (
          `❌ ${label}容量超限：${totalChars}/${maxChars} 字（${Math.round((totalChars / maxChars) * 100)}%）\n\n` +
          `请精简内容：\n` +
          newEntries.map((e, i) => `  ${i + 1}. ${e} (${e.length}字)`).join('\n')
        );
      }

      // 保存更新
      if (isUser) {
        current.user = newEntries;
      } else {
        current.memory = newEntries;
      }

      try {
        setStructuredGlobalMemory(current);

        const pct = Math.min(100, Math.round((totalChars / maxChars) * 100));
        const oldCount = currentEntries.length;
        const newCount = newEntries.length;

        return (
          `✅ ${label}更新成功！（${pct}% — ${totalChars}/${maxChars} 字）\n\n` +
          `📊 变化统计：\n` +
          `  • 原条目数：${oldCount}\n` +
          `  • 新条目数：${newCount}\n` +
          `  • 变化：${newCount > oldCount ? `+${newCount - oldCount}` : newCount < oldCount ? `${newCount - oldCount}` : '无变化'}\n\n` +
          `📝 当前${label}：\n` +
          newEntries.map((e, i) => `  ${i + 1}. ${e}`).join('\n') +
          `\n\n💡 此记忆将在所有未来对话中持续生效。`
        );
      } catch (e) {
        return `❌ 记忆保存失败：${(e as Error).message}`;
      }
    }

    return `❌ 未知操作：${action}`;
  },
};

export default memoryTool;
