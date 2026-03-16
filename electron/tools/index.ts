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

export const toolRegistry = new ToolRegistry()
  .register(datetimeTool)
  .register(calculatorTool)
  .register(screenshotTool);

// 重新导出，方便外部直接从此模块引入类型和类
export type { ToolDefinition } from './types';
export { ToolRegistry } from './registry';
