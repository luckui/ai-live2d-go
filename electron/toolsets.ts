/**
 * Toolset 系统 - 声明式工具集管理
 *
 * 设计理念（借鉴 hermes-agent）：
 *   - 声明式：所有工具分组在此集中定义，替代分散的 hideWhenSkills
 *   - 可组合：toolset 可以嵌套（includes: ["web", "file"]）
 *   - 语义化：toolset 名字表达使用场景（browser-smart、debugging）
 *   - 扩展性：未来新增场景只需添加新 toolset，不改工具代码
 *
 * @example
 * ```ts
 * import { resolveToolset, TOOLSETS } from './toolsets';
 *
 * // 获取工具集包含的所有工具名
 * const tools = resolveToolset("browser-smart");
 * // → ["browser_open", "browser_search", "browser_click_smart", ...]
 *
 * // 注册表使用
 * registry.getSchemasForToolset("browser-smart");
 * ```
 */

/**
 * Toolset 定义结构
 */
export interface ToolsetDefinition {
  /** 工具集描述 */
  description: string;
  /** 直接包含的工具名列表 */
  tools: string[];
  /** 嵌套包含的其他 toolset 名列表（支持组合） */
  includes?: string[];
}

/**
 * 所有工具集定义
 *
 * 扁平化分层策略：
 *   - core: 核心功能（打开/读取/截图）
 *   - smart: 智能交互 Skills（点击/输入）
 *   - nav: 导航辅助（后退/刷新/搜索）
 *
 * ⚠️ 底层原子工具（browser_click, browser_type, sys_mouse_click 等）
 *    永不暴露给 AI，仅供 Skills 内部使用。
 */
export const TOOLSETS: Record<string, ToolsetDefinition> = {
  // ═════════════════════════════════════════════════════════════
  // 浏览器工具集（扁平化）
  // ═════════════════════════════════════════════════════════════

  "browser-core": {
    description: "浏览器核心工具（打开/读取/截图）",
    tools: [
      "browser_open",            // 智能导航（Skill：合并 open/search 逻辑）
      "browser_read_page",       // 读取页面内容（页面摘要 + 可交互元素）
      "browser_screenshot",      // 截图（保存到文件）
    ],
  },

  "browser-smart": {
    description: "浏览器智能交互 Skills（点击/输入）",
    tools: [
      "browser_click_smart",     // 智能点击（Skill：两阶段 扫描→确认）
      "browser_type_smart",      // 智能输入（Skill：定位输入框→填充）
    ],
  },

  "browser-nav": {
    description: "浏览器导航辅助（后退/刷新/搜索）",
    tools: [
      "browser_back",            // 后退
      "browser_refresh",         // 刷新
      "browser_search",          // 搜索引擎
    ],
  },

  // ═════════════════════════════════════════════════════════════
  // 其他工具集（扁平化）
  // ═════════════════════════════════════════════════════════════

  "ocr": {
    description: "OCR 文字识别工具",
    tools: [
      "sys_find_text",           // OCR 查找文字
      "sys_find_text_click",     // OCR 查找并点击
    ],
  },

  "basic-tools": {
    description: "基础工具（计算器/时间/截图）",
    tools: [
      "calculate",               // 计算器
      "get_current_datetime",    // 获取当前时间
      "take_screenshot",         // 截图（屏幕）
    ],
  },

  // ═════════════════════════════════════════════════════════════
  // 平台特定 Toolset（根据消息来源动态注入）
  // ═════════════════════════════════════════════════════════════

  "discord": {
    description: "Discord 平台专属工具（当消息来自 Discord 时自动注入）",
    tools: [
      "discord_send",            // Discord 发送消息/文件（原子工具）
      "discord_send_file",       // Skill: Discord 智能发送文件
    ],
  },

  "wechat": {
    description: "WeChat 平台专属工具（当消息来自 WeChat 时自动注入）",
    tools: [
      "wechat_send",             // 🆕 微信发送消息/文件（支持 AES-128-ECB 加密）
      "wechat_send_file",        // 🆕 Skill: 微信智能发送文件（搜索 + 截图）
    ],
  },

  // ═════════════════════════════════════════════════════════════
  // 三级模式：Chat / Agent / Agent-Debug（扁平化，易读）
  // ═════════════════════════════════════════════════════════════

  // 节省模式
  "chat": {
    description: "Chat 模式 - 轻量对话助手",
    tools: [
      // 核心能力
      "memory",                  // 全局核心记忆（AI 主动管理用户画像）
      "todo",                    // 任务管理（会话级任务追踪）
      // "read_manual",             // 读取操作手册
      "run_command",             // ⭐ 核心：执行命令
      // "request_agent_mode",      // 🆕 请求升级到 Agent 模式
      "show_available_tools",    // 🆕 显示可用工具列表
      "switch_agent_mode",       // 🆕 切换 Agent 模式
      
      // 浏览器 - 核心3工具 + 智能交互
      // "browser_open",            // 打开网页（Skill）
      // "browser_read_page",       // 读取页面内容
      // "browser_screenshot",      // 截图
      // "browser_click_smart",     // 🆕 智能点击（Skill）
      // "browser_type_smart",      // 🆕 智能输入（Skill）
      
      // 基础工具
      "calculate",               // 计算器
      "get_current_datetime",    // 获取当前时间
      "take_screenshot",         // 截图（屏幕）
    ],
  },

  "agent": {
    description: "Agent 模式 - 全功能自动化助手",
    tools: [
      // 核心能力
      "memory",                  // 全局核心记忆
      "todo",                    // 任务管理
      "read_manual",             // 读取操作手册
      "manual_manage",           // 编辑说明书（Agent 权限）
      "run_command",             // ⭐ 执行命令
      "show_available_tools",    // 显示可用工具列表
      "switch_agent_mode",       // 🆕 切换 Agent 模式
      
      // 浏览器 - 完整工具集
      "browser_open",            // 打开网页（Skill）
      "browser_read_page",       // 读取页面内容
      "browser_screenshot",      // 截图
      "browser_click_smart",     // 智能点击（Skill）
      "browser_type_smart",      // 智能输入（Skill）
      "browser_back",            // 后退
      "browser_refresh",         // 刷新
      // "browser_search",          // 搜索引擎
      
      // Skills（高级能力）
      "open_terminal",           // Skill: 打开终端
      "write_file",              // Skill: 写入文件
      "check_python_env",        // Skill: 检查 Python 环境
      
      // OCR 工具
      // "sys_find_text",           // OCR 查找文字
      // "sys_find_text_click",     // OCR 查找并点击
      
      // 基础工具
      "calculate",               // 计算器
      "get_current_datetime",    // 获取当前时间
      "take_screenshot",         // 截图（屏幕）
    ],
  },
  // 原模式
  // "chat": {
  //   description: "Chat 模式 - 轻量对话助手",
  //   tools: [
  //     // 核心能力
  //     "memory",                  // 全局核心记忆（AI 主动管理用户画像）
  //     "todo",                    // 任务管理（会话级任务追踪）
  //     "read_manual",             // 读取操作手册
  //     "run_command",             // ⭐ 核心：执行命令
  //     // "request_agent_mode",      // 🆕 请求升级到 Agent 模式
  //     "show_available_tools",    // 🆕 显示可用工具列表
  //     "switch_agent_mode",       // 🆕 切换 Agent 模式
      
  //     // 浏览器 - 核心3工具 + 智能交互
  //     "browser_open",            // 打开网页（Skill）
  //     "browser_read_page",       // 读取页面内容
  //     "browser_screenshot",      // 截图
  //     "browser_click_smart",     // 🆕 智能点击（Skill）
  //     "browser_type_smart",      // 🆕 智能输入（Skill）
      
  //     // 基础工具
  //     "calculate",               // 计算器
  //     "get_current_datetime",    // 获取当前时间
  //     "take_screenshot",         // 截图（屏幕）
  //   ],
  // },

  // "agent": {
  //   description: "Agent 模式 - 全功能自动化助手",
  //   tools: [
  //     // 核心能力
  //     "memory",                  // 全局核心记忆
  //     "todo",                    // 任务管理
  //     "read_manual",             // 读取操作手册
  //     "manual_manage",           // 编辑说明书（Agent 权限）
  //     "run_command",             // ⭐ 执行命令
  //     "show_available_tools",    // 显示可用工具列表
  //     "switch_agent_mode",       // 🆕 切换 Agent 模式
      
  //     // 浏览器 - 完整工具集
  //     "browser_open",            // 打开网页（Skill）
  //     "browser_read_page",       // 读取页面内容
  //     "browser_screenshot",      // 截图
  //     "browser_click_smart",     // 智能点击（Skill）
  //     "browser_type_smart",      // 智能输入（Skill）
  //     "browser_back",            // 后退
  //     "browser_refresh",         // 刷新
  //     "browser_search",          // 搜索引擎
      
  //     // Skills（高级能力）
  //     "open_terminal",           // Skill: 打开终端
  //     "write_file",              // Skill: 写入文件
  //     "check_python_env",        // Skill: 检查 Python 环境
      
  //     // OCR 工具
  //     "sys_find_text",           // OCR 查找文字
  //     "sys_find_text_click",     // OCR 查找并点击
      
  //     // 基础工具
  //     "calculate",               // 计算器
  //     "get_current_datetime",    // 获取当前时间
  //     "take_screenshot",         // 截图（屏幕）
  //   ],
  // },

  "agent-debug": {
    description: "Agent 调试模式 - 开发者专用（同 Agent，但暴露系统底层工具 + 打工人核心工具）",
    tools: [
      // 核心能力
      "memory",
      "todo",
      "read_manual",
      "manual_manage",
      "run_command",
      "show_available_tools",
      
      // 🆕 打工人核心工具（文件操作）
      "read_file",               // 读取文件（支持行范围）
      "edit_file",               // 编辑文件（字符串替换）
      "list_directory",          // 列出目录内容
      "search_files",            // 搜索文件内容
      "write_file",              // 写入文件（覆盖/追加），skills
      
      // 🆕 打工人核心工具（代码执行）
      "execute_python",          // 执行 Python 代码
      "execute_node",            // 执行 Node.js/TypeScript 代码
      
      // 🆕 终端管理工具
      "start_terminal",          // 启动持久化终端会话
      "get_terminal_output",     // 获取终端输出
      "send_to_terminal",        // 发送终端输入
      "kill_terminal",           // 终止终端会话
      
      // 🆕 打工人核心工具（Git 操作）
      "git_status",              // Git 状态
      "git_diff",                // Git 差异
      "git_commit",              // Git 提交
      "git_log",                 // Git 历史
      
      // 浏览器 - 完整工具集
      "browser_open",
      "browser_read_page",
      "browser_screenshot",
      "browser_click_smart",
      "browser_type_smart",
      "browser_back",
      "browser_refresh",
      "browser_search",
      
      // Skills
      "open_terminal",
      "check_python_env",
      
      // OCR 工具
      // "sys_find_text",
      // "sys_find_text_click",
      
      // 系统底层工具（⚠️ 调试用，生产环境不要开启）
      "sys_key_press",           // 键盘按键
      "sys_key_type",            // 键盘输入
      "sys_mouse_click",         // 鼠标点击
      "sys_mouse_move",          // 鼠标移动
      "sys_wait",                // 等待
      
      // 基础工具
      "calculate",
      "get_current_datetime",
      "take_screenshot",
    ],
  },

  // ═════════════════════════════════════════════════════════════
  // Developer 模式（nightly）：软件工程师，方法论驱动开发
  // ═════════════════════════════════════════════════════════════

  "developer": {
    description: "Developer 模式 - 软件工程师（继承 agent-debug 全部工具 + 方法论驱动提示词）",
    tools: [
      // developer 自身不需要额外工具，全部通过 includes 继承
    ],
    includes: ["agent-debug"],  // ← 继承 agent-debug 的全部工具
  },
};

/**
 * 解析 toolset，递归展开 includes，返回所有工具名集合
 *
 * @param name - toolset 名称
 * @returns 去重后的工具名数组
 *
 * @example
 * ```ts
 * resolveToolset("browser-smart");
 * // → ["browser_open", "browser_search", "browser_click_smart", ...]
 *
 * resolveToolset("default");
 * // → 递归展开所有 includes，返回完整工具列表
 * ```
 */
export function resolveToolset(name: string): string[] {
  const def = TOOLSETS[name];
  if (!def) {
    console.warn(`[toolsets] Unknown toolset: ${name}`);
    return [];
  }

  const result = new Set<string>();

  // 添加直接工具
  for (const tool of def.tools) {
    result.add(tool);
  }

  // 递归添加嵌套 toolset
  if (def.includes) {
    for (const included of def.includes) {
      const nested = resolveToolset(included);
      for (const tool of nested) {
        result.add(tool);
      }
    }
  }

  return Array.from(result);
}

/**
 * 验证 toolset 名称是否存在
 */
export function validateToolset(name: string): boolean {
  return name in TOOLSETS;
}

/**
 * 获取所有可用的 toolset 名称
 */
export function getAllToolsets(): string[] {
  return Object.keys(TOOLSETS);
}
