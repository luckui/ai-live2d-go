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
 * 分层策略：
 *   - primitive: 原子工具（底层实现，通常不直接暴露给 AI）
 *   - smart: 智能 Skill（高级封装，AI 优先调用）
 *   - full: 完整工具集（调试时使用）
 */
export const TOOLSETS: Record<string, ToolsetDefinition> = {
  // ═════════════════════════════════════════════════════════════
  // 浏览器工具集
  // ═════════════════════════════════════════════════════════════

  "browser-primitive": {
    description: "浏览器底层原子工具（Skill 内部使用）",
    tools: [
      "browser_click",           // 直接点击（需要 selector）
      "browser_type",            // 直接输入（需要 selector）
      "browser_js_click",        // JS 点击（需要 selector）
      "browser_get_buttons",     // 扫描按钮列表
      "browser_scan_inputs",     // 扫描输入框
      "browser_js_type",         // JS 输入（需要 selector）
      "browser_select",          // 下拉选择（需要 selector）
    ],
  },

  "browser-smart": {
    description: "浏览器智能工具（AI 直接调用，推荐）",
    tools: [
      "browser_open",            // 智能导航（Skill：合并 open/search 逻辑）
      "browser_search",          // 搜索引擎（打开搜索引擎搜索关键词）
      "browser_click_smart",     // 智能点击（Skill：两阶段 扫描→确认）
      "browser_type_smart",      // 智能输入（Skill：定位输入框→填充）
      "browser_read_page",       // 读取页面内容（页面摘要 + 可交互元素）
      "browser_back",            // 后退
      "browser_forward",         // 前进
      "browser_refresh",         // 刷新
      "browser_screenshot",      // 截图（保存到文件）
      "browser_close",           // 关闭浏览器
    ],
  },

  "browser-full": {
    description: "浏览器完整工具集（调试时使用）",
    tools: [],
    includes: ["browser-primitive", "browser-smart"],
  },

  // ═════════════════════════════════════════════════════════════
  // 文件系统工具集
  // ═════════════════════════════════════════════════════════════

  "file-primitive": {
    description: "文件底层原子工具",
    tools: [
      "read_file",               // 读取文件
      "list_dir",                // 列出目录
      "file_exists",             // 检查文件是否存在
    ],
  },

  "file-smart": {
    description: "文件智能工具（包含高级 Skill）",
    tools: [
      "write_file",              // 写入文件（Skill：智能创建目录）
    ],
    includes: ["file-primitive"],
  },

  // ═════════════════════════════════════════════════════════════
  // 终端工具集
  // ═════════════════════════════════════════════════════════════

  "terminal-primitive": {
    description: "终端底层工具",
    tools: [
      "run_command",             // 执行命令（返回输出）
    ],
  },

  "terminal-smart": {
    description: "终端智能工具",
    tools: [
      "open_terminal",           // 打开终端（Skill：智能 conda 环境）
      "check_python_env",        // 检查 Python 环境（Skill）
    ],
    includes: ["terminal-primitive"],
  },

  // ═════════════════════════════════════════════════════════════
  // Discord 工具集
  // ═════════════════════════════════════════════════════════════

  "discord-primitive": {
    description: "Discord 底层工具",
    tools: [
      "discord_send",            // 发送文本消息
    ],
  },

  "discord-smart": {
    description: "Discord 智能工具",
    tools: [
      "discord_send_file",       // 发送文件（Skill：智能路径解析）
    ],
    includes: ["discord-primitive"],
  },

  // ═════════════════════════════════════════════════════════════
  // 系统管理工具
  // ═════════════════════════════════════════════════════════════

  "system": {
    description: "系统管理工具（内部使用）",
    tools: [
      "sys_send_notification",   // 发送系统通知
      "sys_set_live2d_text",     // 设置 Live2D 文字
      "sys_set_live2d_expression", // 设置 Live2D 表情
      "sys_quit",                // 退出应用
      "sys_restart",             // 重启应用
      "sys_minimize",            // 最小化窗口
      "sys_toggle_pinned",       // 切换窗口置顶
    ],
  },

  // ═════════════════════════════════════════════════════════════
  // OCR 工具
  // ═════════════════════════════════════════════════════════════

  "ocr": {
    description: "OCR 文字识别工具",
    tools: [
      "ocr_screenshot",          // 截图识别
      "ocr_clipboard",           // 剪贴板图片识别
    ],
  },

  // ═════════════════════════════════════════════════════════════
  // 知识库工具
  // ═════════════════════════════════════════════════════════════

  "knowledge": {
    description: "知识库和手册工具",
    tools: [
      "read_manual",             // 读取操作手册
      "manual_manage",           // 管理说明书（AI 自我进化：创建/编辑工作流）
    ],
  },

  // ═════════════════════════════════════════════════════════════
  // 场景组合工具集
  // ═════════════════════════════════════════════════════════════

  "default": {
    description: "默认工具集（桌面助手标准配置）",
    tools: [
      "memory",                  // 全局核心记忆（AI 主动管理用户画像）
      "todo",                    // 任务管理（会话级任务追踪）
    ],
    includes: [
      "browser-smart",           // 浏览器智能工具
      "file-smart",              // 文件智能工具
      "terminal-smart",          // 终端智能工具
      "discord-smart",           // Discord 智能工具
      "system",                  // 系统管理
      "ocr",                     // OCR
      "knowledge",               // 知识库
    ],
  },

  "debugging": {
    description: "调试模式（暴露所有底层工具）",
    tools: [],
    includes: [
      "browser-full",
      "file-smart",
      "terminal-smart",
      "discord-smart",
      "system",
      "ocr",
      "knowledge",
    ],
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
