/**
 * 工具注册入口
 *
 * ✨ 添加新工具只需三步：
 *   1. 在 `impl/` 目录下新建工具文件，实现 `ToolDefinition<T>` 接口
 *   2. 在此文件中 import 该工具
 *   3. 在下方链式调用 `.register(yourTool)` 注册
 *
 * 无需修改任何核心循环逻辑！
 */

import { ToolRegistry } from './registry';
import datetimeTool from './impl/datetime';
import calculatorTool from './impl/calculator';
import screenshotTool from './impl/screenshot';
import { browserTools } from './impl/browser';

const registry = new ToolRegistry()
  .register(datetimeTool)
  .register(calculatorTool)
  .register(screenshotTool);

// 批量注册所有浏览器工具
for (const tool of browserTools) {
  registry.register(tool);
}

export const toolRegistry = registry;

// 重新导出，方便外部直接从此模块引入类型和类
export type { ToolDefinition } from './types';
export { ToolRegistry } from './registry';
