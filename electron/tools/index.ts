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
import runCommandTool from './impl/runCommand';
import discordSendTool from './impl/discordSend';
import wechatSendTool from './impl/wechatSend';  // 🆕 微信发送工具
import readManualTool from './impl/manual';
import manualManageTool from './impl/manual_manage';
import memoryTool from './impl/memory';
import todoTool from './impl/todo';
import requestAgentMode from './impl/requestAgentMode';  // 🆕 请求 Agent 模式
import showAvailableTools from './impl/showAvailableTools';  // 🆕 显示可用工具列表
import switchAgentMode from './impl/switchAgentMode';  // 🆕 切换 Agent 模式
import { skillList } from '../skills/index';
import { setSkillRegistry } from '../skills/skillContext';

const registry = new ToolRegistry()
  .register(datetimeTool)
  .register(calculatorTool)
  .register(screenshotTool)
  .register(runCommandTool)
  .register(discordSendTool)
  .register(wechatSendTool)      // 🆕 注册微信发送工具
  .register(readManualTool)
  .register(manualManageTool)  // 说明书管理工具（AI 自我进化：创建/编辑工作流）
  .register(memoryTool)        // 全局核心记忆工具（AI 主动管理用户画像）
  .register(todoTool)          // 任务管理工具（会话级任务追踪）
  .register(requestAgentMode)  // 🆕 请求 Agent 模式工具（Chat→Agent 渐进式升级）
  .register(showAvailableTools) // 🆕 显示可用工具列表（AI 自我感知能力边界）
  .register(switchAgentMode);  // 🆕 切换 Agent 模式（AI 主动切换）

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

// 初始化 Skill 模块的工具注册表引用（打破 skills/impl/* ↔ tools/index 的循环依赖）
// 此时 registry 已包含所有原子工具，Skill 的 execute() 可通过 getSkillRegistry() 调用它们
setSkillRegistry(registry);

export const toolRegistry = registry;

// 重新导出，方便外部直接从此模块引入类型和类
export type { ToolDefinition } from './types';
export { ToolRegistry } from './registry';

