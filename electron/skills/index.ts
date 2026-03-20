/**
 * Skill 注册入口
 *
 * ✨ 添加新 Skill 只需两步：
 *   1. 在 `impl/` 目录下新建 Skill 文件，实现 `ToolDefinition<T>` 接口，
 *      并设置 `isSkill: true`
 *   2. 在此文件中 import 并加入 skillList 数组
 *
 * Skill 会在 tools/index.ts 末尾被批量注册到同一个 ToolRegistry，
 * 对 AI 来说与普通工具完全透明（同一个 Function Calling 接口）。
 *
 * ToolRegistry.getSchemasForMode() 会在有 Skill 时自动隐藏 sys_* 原子工具，
 * 让 AI 工具列表保持简洁，降低选择压力。
 */

import type { ToolDefinition } from '../tools/types';
import openTerminalSkill from './impl/openTerminal';
import browserClickSmartSkill from './impl/browserClick';
import browserTypeSmartSkill from './impl/browserType';
import checkPythonEnvSkill from './impl/checkPythonEnv';
import writeFileSkill from './impl/writeFile';
import discordSendFileSkill from './impl/discordSendFile';
import browserOpenSkill from './impl/browserOpen';

// ── Skill 列表 ────────────────────────────────────────────────
const skillList: ToolDefinition<never>[] = [
  openTerminalSkill as ToolDefinition<never>,
  browserOpenSkill as ToolDefinition<never>,
  browserClickSmartSkill as ToolDefinition<never>,
  browserTypeSmartSkill as ToolDefinition<never>,
  checkPythonEnvSkill as ToolDefinition<never>,
  writeFileSkill as ToolDefinition<never>,
  discordSendFileSkill as ToolDefinition<never>,
  // 未来在这里添加更多 Skill，例如：
  // weatherQuerySkill as ToolDefinition<never>,
  // checkEmailSkill   as ToolDefinition<never>,
];

export { skillList };
