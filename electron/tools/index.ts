/**
 * 工具注册入口
 *
 * ✨ 添加新工具只需三步：
 *   1. 在 `impl/` 目录下新建工具文件，实现 `ToolDefinition<T>` 接口
 *   2. 在此文件中 import 该工具
 *   3. 在下方链式调用 `.register(yourTool)` 注册
 *
 * 无需修改任何核心循环逻辑！
 *
 * ✨ 添加新 Skill 只需两步：
 *   1. 在 `skills/impl/` 目录下新建文件，实现 `ToolDefinition<T>` 接口，设 isSkill=true
 *   2. 在 `skills/index.ts` 的 skillList 数组中添加
 */

import { ToolRegistry } from './registry';
import datetimeTool from './impl/datetime';
import calculatorTool from './impl/calculator';
import screenshotTool from './impl/screenshot';
import { browserTools } from './impl/browser';
import { systemTools } from './impl/system';
import { ocrTools } from './impl/ocr';
import agentStartTool from './impl/agentTool';
import { setAgentRegistry } from '../agent/agentRegistry';
import { skillList } from '../skills/index';
import { setSkillRegistry } from '../skills/skillContext';

const registry = new ToolRegistry()
  .register(datetimeTool)
  .register(calculatorTool)
  .register(screenshotTool);

// 批量注册所有浏览器工具
for (const tool of browserTools) {
  registry.register(tool);
}

// 批量注册所有系统级工具（键盘/鼠标）
for (const tool of systemTools) {
  registry.register(tool);
}

// 批量注册 OCR 工具（WinRT，Win10/11 内置，无需额外依赖）
for (const tool of ocrTools) {
  registry.register(tool);
}

// 批量注册所有 Skill（高级封装，isSkill=true）
for (const skill of skillList) {
  registry.register(skill);
}

// 注册 Agent 启动工具（必须在 setAgentRegistry 之前完成）
registry.register(agentStartTool);

// 初始化 Agent 模块的工具注册表引用（打破 agent/executor ↔ tools/index 的循环依赖）
// 此时 registry 已包含所有工具，getAgentRegistry() 从此可用
setAgentRegistry(registry);

// 初始化 Skill 模块的工具注册表引用（打破 skills/impl/* ↔ tools/index 的循环依赖）
// 此时 registry 已包含所有原子工具，Skill 的 execute() 可通过 getSkillRegistry() 调用它们
setSkillRegistry(registry);

export const toolRegistry = registry;

// 重新导出，方便外部直接从此模块引入类型和类
export type { ToolDefinition } from './types';
export { ToolRegistry } from './registry';

