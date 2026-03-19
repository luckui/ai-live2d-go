/**
 * Skill 模块使用的工具注册表引用（单例）
 *
 * ── 设计目的：打破循环依赖 ────────────────────────────────
 *
 *   tools/index.ts  →  注册 Skill  →  skills/impl/xxx.ts
 *                                          ↓ 需要 toolRegistry（调原子工具）
 *   tools/index.ts  →  toolRegistry（此时已注册完毕）
 *
 * Skill 内部直接 import tools/index.ts 会产生循环。
 * 此模块作为中间层：Skill 调用 getSkillRegistry() 获取 registry，
 * tools/index.ts 在所有工具注册完毕后调用 setSkillRegistry(registry)。
 *
 * ── 初始化顺序 ───────────────────────────────────────────
 *   1. tools/index.ts 加载，注册所有原子工具 + Skill
 *   2. tools/index.ts 末尾调用 setSkillRegistry(registry)
 *   3. 此后 Skill 的 execute() 被调用时，getSkillRegistry() 正常返回
 *
 * （此模式与 agent/agentRegistry.ts 完全一致，直接复用）
 */

import type { ToolRegistry } from '../tools/registry';

let _registry: ToolRegistry | null = null;

/** 由 tools/index.ts 在所有工具注册完成后调用 */
export function setSkillRegistry(registry: ToolRegistry): void {
  _registry = registry;
}

/** 由 skills/impl/* 在 execute() 中调用原子工具时使用 */
export function getSkillRegistry(): ToolRegistry {
  if (!_registry) {
    throw new Error('[Skill] ToolRegistry 尚未初始化，请确保 tools/index.ts 已加载');
  }
  return _registry;
}
