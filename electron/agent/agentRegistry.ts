/**
 * Agent 模块使用的工具注册表引用（单例）
 *
 * ── 设计目的：打破循环依赖 ────────────────────────────────
 *
 *   tools/index.ts  →  agentTool.ts  →  orchestrator.ts  →  executor.ts
 *                                                              ↓ 需要 toolRegistry
 *   tools/index.ts  →  toolRegistry（此时已注册完毕）
 *
 * 直接让 executor.ts 导入 tools/index.ts 会产生循环。
 * 此模块作为中间层：executor.ts 调用 getAgentRegistry()，
 * tools/index.ts 在所有工具注册完毕后调用 setAgentRegistry(registry)。
 *
 * ── 初始化顺序 ───────────────────────────────────────────
 *   1. tools/index.ts 开始加载，注册所有工具（含 agentTool）
 *   2. tools/index.ts 末尾调用 setAgentRegistry(registry)
 *   3. 此后任意时刻 executor.ts 调用 getAgentRegistry() 均可正常获取
 */

import type { ToolRegistry } from '../tools/registry';

let _registry: ToolRegistry | null = null;

/** 由 tools/index.ts 在所有工具注册完成后调用 */
export function setAgentRegistry(registry: ToolRegistry): void {
  _registry = registry;
}

/** 由 agent/executor.ts 等在执行时调用 */
export function getAgentRegistry(): ToolRegistry {
  if (!_registry) {
    throw new Error('[Agent] ToolRegistry 尚未初始化，请确保 tools/index.ts 已加载');
  }
  return _registry;
}
