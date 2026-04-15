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
import { getStructuredGlobalMemory, setStructuredGlobalMemory } from '../../db';

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
  /** 操作类型：read=读取当前记忆，add_user=添加用户画像，add_memory=添加环境配置 */
  action: 'read' | 'add_user' | 'add_memory';
  /** 新的记忆条目（action=add_* 时必填，单条精简描述） */
  entry?: string;
}

const memoryTool: ToolDefinition<MemoryParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'memory',
      description:
        '【全局核心记忆管理】保存跨对话的用户核心画像和环境配置。\n' +
        '\n' +
        '【结构化存储】\n' +
        '  • USER（用户画像）：用户偏好、习惯、身份、Discord/微信账号等\n' +
        '  • MEMORY（环境配置）：系统信息、工具版本、项目约定等\n' +
        '\n' +
        '【何时主动调用】\n' +
        '  ✅ 用户明确告知个人信息（"我的Discord是louis066505"）→ add_user\n' +
        '  ✅ 用户纠正你或表达偏好（"我更喜欢TypeScript"）→ add_user\n' +
        '  ✅ 发现稳定环境事实（"conda环境sharp已激活"）→ add_memory\n' +
        '  ✅ 识别长期有用的工具特性或项目约定 → add_memory\n' +
        '\n' +
        '【不要记录】\n' +
        '  ❌ 临时任务进度、本次对话细节、单次事件\n' +
        '  → 这些由自动记忆系统总结\n' +
        '\n' +
        '【操作说明】\n' +
        '• action=read       → 读取当前记忆（首次见面可调用）\n' +
        '• action=add_user   → 添加用户画像条目（单条，精简）\n' +
        '• action=add_memory → 添加环境配置条目（单条，精简）\n' +
        '\n' +
        '【重要】全局记忆已在 system prompt 中，无需每次 read，仅在首次见面或需要核对时调用。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'add_user', 'add_memory'],
            description: 'read=读取记忆，add_user=添加用户画像，add_memory=添加环境配置',
          },
          entry: {
            type: 'string',
            description:
              '【action=add_* 时必填】单条记忆条目，精简描述。\n' +
              '示例："Discord账号louis066505"、"偏好TypeScript"、"conda环境sharp"',
          },
        },
        required: ['action'],
      },
    },
  },

  async execute({ action, entry }) {
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
    // action=add_user / add_memory：添加条目
    // ══════════════════════════════════════════════════
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
  },
};

export default memoryTool;
