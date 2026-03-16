import type { ToolDefinition, ToolSchema, ToolExecuteResult } from './types';

/**
 * 工具注册中心
 *
 * 统一管理所有工具的注册与执行，解耦 LLM 调用循环与具体工具实现。
 *
 * @example
 * ```ts
 * registry.register(myTool);             // 注册
 * registry.getSchemas();                 // → 传给 LLM 的 tools 数组
 * await registry.execute(name, argsJson); // 执行工具调用
 * ```
 */
export class ToolRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly tools = new Map<string, ToolDefinition<any>>();

  /** 注册一个工具，支持链式调用 */
  register<T>(tool: ToolDefinition<T>): this {
    this.tools.set(tool.schema.function.name, tool);
    return this;
  }

  /** 当前是否没有注册任何工具 */
  get isEmpty(): boolean {
    return this.tools.size === 0;
  }

  /** 获取所有工具的 schema 列表，用于注入 LLM 请求的 `tools` 字段 */
  getSchemas(): ToolSchema[] {
    return [...this.tools.values()].map((t) => t.schema);
  }

  /**
   * 执行指定工具
   *
   * @param name     - 工具函数名（来自 LLM 响应的 tool_call.function.name）
   * @param argsJson - JSON 字符串（来自 LLM 响应的 tool_call.function.arguments）
   * @returns        - 工具执行结果：字符串或含图像的 ToolImageResult
   *                   调用方（aiService）负责将图像注入多模态 user 消息
   */
  async execute(name: string, argsJson: string): Promise<ToolExecuteResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `[工具错误] 未找到名为 "${name}" 的工具，已注册: ${[...this.tools.keys()].join(', ')}`;
    }
    try {
      const args = JSON.parse(argsJson) as Record<string, unknown>;
      return await tool.execute(args);
    } catch (e) {
      return `[工具错误] "${name}" 执行失败: ${(e as Error).message}`;
    }
  }
}
