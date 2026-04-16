/**
 * 工具上下文 - 打破循环依赖
 *
 * 问题：tools/impl/ 中的某些工具需要调用其他工具（如 openTerminal 调用 sys_key_press），
 * 但 toolRegistry 在 tools/index.ts 中构建，如果 impl 文件直接 import toolRegistry，
 * 会形成循环依赖：tools/index.ts → impl/foo.ts → tools/index.ts
 *
 * 解决方案：
 *   1. tools/index.ts 在构建完 registry 后调用 setToolRegistry(registry)
 *   2. impl 文件通过 getToolRegistry() 延迟获取 registry 引用
 *   3. 这样 impl 文件只依赖本模块，不直接 import tools/index.ts
 */

import type { ToolRegistry } from './registry';

let _toolRegistry: ToolRegistry | null = null;

/**
 * 设置全局工具注册表引用（仅由 tools/index.ts 调用一次）
 */
export function setToolRegistry(registry: ToolRegistry): void {
  _toolRegistry = registry;
}

/**
 * 获取全局工具注册表（供 impl 文件内部调用其他工具）
 */
export function getToolRegistry(): ToolRegistry {
  if (!_toolRegistry) {
    throw new Error('ToolRegistry not initialized. Call setToolRegistry() first.');
  }
  return _toolRegistry;
}
