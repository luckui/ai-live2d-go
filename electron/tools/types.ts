/**
 * 工具调用 - 核心类型定义
 *
 * 这里定义的类型与 OpenAI function calling 格式完全兼容，
 * 因此对所有 OpenAI-compatible 接口（豆包/DeepSeek/智谱等）均有效。
 */

// ── JSON Schema ───────────────────────────────────────────

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'integer' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: JSONSchemaProperty;
}

export interface JSONSchemaObject {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

// ── 工具 Schema（OpenAI function calling 格式）────────────

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchemaObject;
  };
}

// ── 工具定义 ──────────────────────────────────────────────

/**
 * 工具定义接口 - 实现一个新工具只需：
 *
 * 1. 新建 `tools/impl/yourTool.ts`，export default 实现此接口
 * 2. 在 `tools/index.ts` 中 `registry.register(yourTool)`
 *
 * 无需修改任何核心逻辑！
 *
 * @typeParam TParams - 工具参数类型，与 schema.function.parameters 保持一致
 */
// ── 工具执行返回值 ────────────────────────────────────────

/**
 * 带图像的工具返回值
 *
 * 当工具需要向 LLM 传递图像时（如截图），返回此类型。
 * aiService 会自动将图像注入为 user 角色的多模态消息，
 * 保证视觉模型能正确「看到」图像内容。
 */
export interface ToolImageResult {
  /** 回填到 tool 角色消息的文字描述 */
  text: string;
  /** Base64 编码的图像原始数据（不含 data URL 前缀） */
  imageBase64: string;
  /** 图像 MIME 类型 */
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

/** 工具执行结果，字符串或图像结果 */
export type ToolExecuteResult = string | ToolImageResult;

/** 类型守卫：判断工具结果是否含图像 */
export function isToolImageResult(r: ToolExecuteResult): r is ToolImageResult {
  return typeof r === 'object' && 'imageBase64' in r;
}

export interface ToolDefinition<TParams = Record<string, unknown>> {
  /** OpenAI function calling 格式的工具描述，LLM 依据此决定是否调用 */
  schema: ToolSchema;
  /**
   * 工具执行函数
   * @param params - 已解析的参数对象（由 LLM 生成，registry 负责 JSON.parse）
   * @returns 字符串结果或含图像的 ToolImageResult，aiService 会自动处理注入
   */
  execute: (params: TParams) => Promise<ToolExecuteResult> | ToolExecuteResult;
  /**
   * 标记此工具为高级 Skill（封装了多步原子操作的复合能力）。
   * ToolRegistry.getSchemasForMode('skill-first') 时，若存在 Skill，
   * 会优先暴露 Skill 并收起部分冗余的底层原子工具，降低 AI 选择压力。
   */
  isSkill?: boolean;
}

// ── OpenAI Chat Message 类型（工具调用感知）──────────────

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** LLM 生成的 JSON 字符串，由 registry.execute 负责解析 */
    arguments: string;
  };
}

// ── 多模态内容片段（Vision 支持）────────────────────────

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export type ChatMessage =
  | { role: 'system'; content: string }
  /** user 消息支持纯文本或多模态内容数组（图文混合） */
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
