/**
 * 记忆模块 - 核心类型定义
 *
 * 此模块与数据库类型（DBMessage 等）刻意分离，
 * 以保证记忆模块可以独立升级而不影响数据层。
 */

// ── 记忆配置 ──────────────────────────────────────────────

/**
 * 记忆模块配置，可通过 MemoryManager 构造函数传入自定义值，
 * 未传则使用 DEFAULT_MEMORY_CONFIG。
 */
export interface MemoryConfig {
  /**
   * 触发一次记忆总结所需的对话轮数。
   * 1 轮 = 1 条 user + 1 条 assistant。
   * 默认 30，即每 30 轮（60 条消息）总结一次。
   */
  summaryWindowRounds: number;

  /**
   * 总结请求的最大输出 token 数。
   * 建议 200-300，总结需精简不宜过长。
   */
  summaryMaxTokens: number;

  /**
   * 总结请求的温度参数（0-1）。
   * 建议 0.3，低温保证输出客观、稳定。
   */
  summaryTemperature: number;

  /**
   * 单条消息内容截断长度（字符数），防止过长消息占满总结 token 配额。
   * 默认 600。
   */
  messageContentMaxLength: number;

  /**
   * 离开对话时触发强制部分总结的最低剩余轮数。
   * 低于此值不触发（避免为极短尾部浪费 token）。
   * 默认 3，即至少 6 条消息才触发。
   */
  leaveMinRounds: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  summaryWindowRounds: 30,
  summaryMaxTokens: 300,
  summaryTemperature: 0.3,
  messageContentMaxLength: 600,
  leaveMinRounds: 3,
};

// ── 全局记忆配置 ──────────────────────────────────────────

/**
 * 全局核心记忆精炼配置。
 * 全局记忆跨对话存在，专注于用户身份、情感状态、重大事件等稳定信息。
 */
export interface GlobalMemoryConfig {
  /** 精炼请求最大输出 token，建议 300-400 */
  refinementMaxTokens: number;
  /** 精炼温度，建议 0.2，低温保证输出客观稳定 */
  refinementTemperature: number;
  /**
   * 触发全局精炼的最低新片段数。
   * 设为 1：只要有 1 条新片段就精炼；可调大以减少 LLM 调用频率。
   */
  minNewFragments: number;
  /**
   * 全局记忆最大字符数（写入提示词的字数上限）。
   * 过长会持续消耗 token，建议 250-400。
   */
  globalMemoryMaxChars: number;
}

export const DEFAULT_GLOBAL_MEMORY_CONFIG: GlobalMemoryConfig = {
  refinementMaxTokens: 400,
  refinementTemperature: 0.2,
  minNewFragments: 1,
  globalMemoryMaxChars: 350,
};

// ── 总结结果 ──────────────────────────────────────────────

/**
 * LLM 总结调用的返回结果：
 * - `string`：有效的记忆摘要文本
 * - `null`：该段对话无值得记忆的内容（例如纯闲聊）
 */
export type SummarizeResult = string | null;
