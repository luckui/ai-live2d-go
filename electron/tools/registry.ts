import type { ToolDefinition, ToolSchema, ToolExecuteResult, ToolImageResult } from './types';
import { isSkillPauseResult, isSkillContinueResult } from './types';

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
   * 获取排除指定工具名后的 schema 列表
   * 用于 Agent Executor：排除 agent_start 防止递归触发新 Agent
   */
  getSchemasExcluding(names: string[]): ToolSchema[] {
    return [...this.tools.values()]
      .filter((t) => !names.includes(t.schema.function.name))
      .map((t) => t.schema);
  }

  /**
   * Skill 优先模式下的 schema 列表
   *
   * 当注册表中存在 isSkill=true 的工具时，使用"skill-first"模式：
   *   - 所有 Skill（isSkill=true）永远暴露给 AI
   *   - 底层原子工具中，excludeWhenSkills 列表内的工具会被隐藏（减少 AI 选择压力）
   *   - excludeWhenSkills 未传则默认隐藏所有 sys_* 原子工具（因为它们由 Skill 内部调用）
   *
   * @param excludeWhenSkills 有 Skill 时要隐藏的原子工具名列表；
   *                          传 [] 表示不隐藏任何工具；
   *                          不传则自动隐藏 sys_* 前缀的工具
   */
  getSchemasForMode(excludeWhenSkills?: string[]): ToolSchema[] {
    const all = [...this.tools.values()];
    const hasSkills = all.some(t => t.isSkill);

    if (!hasSkills) {
      // 无 Skill 注册，全量暴露（与 getSchemas() 等价）
      return all.map(t => t.schema);
    }

    // 有 Skill：按规则过滤原子工具
    const toHide: Set<string> = new Set(
      excludeWhenSkills === undefined
        ? all.filter(t => !t.isSkill && t.schema.function.name.startsWith('sys_'))
             .map(t => t.schema.function.name)
        : excludeWhenSkills
    );

    return all
      .filter(t => {
        if (t.isSkill) return true;                          // Skill 永远暴露
        if (t.hideWhenSkills) return false;                  // 有 Skill 时隐藏
        return !toHide.has(t.schema.function.name);          // sys_* 等按名单隐藏
      })
      .map(t => t.schema);
  }

  /**
   * 执行指定工具
   *
   * @param name     - 工具函数名（来自 LLM 响应的 tool_call.function.name）
   * @param argsJson - JSON 字符串（来自 LLM 响应的 tool_call.function.arguments）
   * @returns        - 工具执行结果：字符串或含图像的 ToolImageResult
   *                   SkillPauseResult 已在此处格式化为带 ⏸️ 标记的字符串，
   *                   调用方（aiService）无需感知暂停类型。
   */
  async execute(name: string, argsJson: string): Promise<string | ToolImageResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `[工具错误] 未找到名为 "${name}" 的工具，已注册: ${[...this.tools.keys()].join(', ')}`;
    }
    try {
      const args = JSON.parse(argsJson) as Record<string, unknown>;
      const result = await tool.execute(args);

      // ── Skill 暂停：格式化为带 ⏸️ 标记的字符串，AI 按 systemPrompt 规范处理 ──
      if (isSkillPauseResult(result)) {
        const traceLines = result.trace.length
          ? result.trace.map(t => '  ' + t).join('\n')
          : '  （无执行轨迹）';
        return (
          `⏸️ Skill 暂停等待用户操作\n` +
          `执行轨迹：\n${traceLines}\n\n` +
          `【当前状态】${result.userMessage}\n` +
          `【用户完成后】${result.resumeHint}`
        );
      }

      // ── Skill 继续：格式化为带 🔄 标记的字符串，aiService 检测后强制注入继续指令 ──
      if (isSkillContinueResult(result)) {
        const traceLines = result.trace.length
          ? result.trace.map(t => '  ' + t).join('\n')
          : '  （无执行轨迹）';
        return (
          `🔄 Skill 阶段完成，需要立即执行下一步\n` +
          `执行轨迹：\n${traceLines}\n\n` +
          `【必须立即执行】${result.instruction}`
        );
      }

      return result;
    } catch (e) {
      return `[工具错误] "${name}" 执行失败: ${(e as Error).message}`;
    }
  }
}
