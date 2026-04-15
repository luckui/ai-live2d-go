# Hiyori

一个基于 Electron 和 Live2D 的桌面宠物 AI 助手，支持聊天、记忆、工具调用、语音和多服务商 LLM 接入。

---

## 项目简介

Hiyori 是一个运行在 Windows 桌面的 Live2D 宠物应用。

它不只是一个会动的角色，还集成了：

- AI 聊天
- 多轮记忆
- 多步骤任务能力
- 浏览器 / 终端 / 文件等工具调用
- TTS 语音能力
- 可扩展的技能与工具体系

项目当前主要面向本地桌面使用场景，适合继续扩展为个人助理、桌面陪伴或实验性 Agent 客户端。

## 当前状态

- ✅ **稳定运行**：当前版本主要支持 Windows 10/11
- 🤖 **Agent 系统**：基于 ReAct Loop（推理-行动-观察循环）设计，支持多步骤任务自动执行
- 🔧 **三级工具模式**：
  - **Chat 模式**（默认）：14 个精选工具，适合日常对话和简单任务
  - **Agent 模式**：23 个完整工具，支持复杂多步骤自动化
  - **Agent-Debug 模式**：暴露底层工具（键盘/鼠标），供开发调试使用

### 💰 Token 消耗估算

| 模式 | 工具数量 | 每次请求消耗* | 适用场景 |
|------|---------|--------------|---------|
| **Chat** | 14 个 | ~7,200 tokens | 日常对话、简单命令执行 |
| **Agent** | 23 个 | ~9,000 tokens | 复杂任务、多步骤自动化 |

\* _包含：系统提示词（~900 tokens）+ 工具列表（Chat: ~2,800 / Agent: ~4,600）+ 对话历史（~3,500 tokens，10 轮短期记忆）_

**ReAct Loop 额外消耗**：
- Agent 模式执行复杂任务时，可能触发 3-10 次 LLM 调用（思考→执行→观察循环）
- 单次多步骤任务总消耗：~30,000 - 90,000 tokens（取决于任务复杂度）
- 建议使用支持大上下文的模型（如 GPT-4、DeepSeek、豆包等）

### **ReAct Loop 架构**：推理（Reasoning）→ 行动（Action）→ 观察（Observation）循环
  - 三级工具模式：Chat（14 工具）/ Agent（23 工具）/ Agent-Debug（底层工具）
  - 任务规划与分解
  - 多步骤任务执行（3-10 轮自动循环）
  - 自动验证和错误处理
  - 丰富的技能工具库（50+ 工具/Skill）
### ✨ 功能特性

- 🎭 **Live2D 桌面宠物**
  - 可爱的 Hiyori 角色，可在桌面自由移动
  - 流畅的动画表现和交互体验
  - 支持点击和拖拽互动

- 💬 **AI 智能对话**
  - 支持多种 LLM 服务商（OpenAI、DeepSeek、智谱、月之暗面等）
  - 兼容所有 OpenAI Compatible API
  - 完整的对话记忆管理系统
  - 全局记忆和会话记忆分层管理

- 🤖 **Agent 智能体系统**
  - 三级工具模式：Chat（轻量对话）/ Agent（智能执行）/ Agent-Debug（开发调试）
  - 任务规划与分解
  - 多步骤任务执行
  - 自动验证和错误处理
  - 丰富的技能工具库
  - 当前仍处于迭代阶段，不建议作为日常默认模式启用

- 📱 **跨平台远程控制**
  - **Discord 集成**
    - 手机发送命令 → AI 电脑执行 → 截图/文件发回手机
    - 智能文件搜索与发送（Desktop/Downloads/Documents）
    - 自动路径去重（OneDrive 桌面同步兼容）
  - **微信集成**（基于 iLink Bot API）
    - 完整的文件发送能力（图片/视频/文档/语音）
    - AES-128-ECB 加密 CDN 传输
    - 智能文件搜索与截图发送
    - 支持远程控制电脑操作

- 🔧 **实用技能工具**
  - **浏览器自动化**（打开、点击、输入、截图）
  - **命令行终端操作**（执行命令、管理进程）
  - **文件管理**（读写、搜索、发送）
  - **Python 环境检查**（自动检测虚拟环境）
  - **OCR 文字识别**（WinRT，Win10/11 内置）
  - **平台消息发送**
    - Discord：消息 + 文件发送
    - 微信：消息 + 文件发送（支持加密传输）

- 🗣️ **语音合成 (TTS)**
  - 支持将文本转换为语音
  - 可自定义语音参数

- 📚 **知识库系统**
  - 内置操作说明书（浏览器操作、命令行操作等）
  - AI 可主动查阅和学习
  - 支持自定义知识条目

- 🏗️ **工具架构特性**
  - **声明式 Toolset 系统**：工具分组管理，按场景动态注入
  - **Skill 封装**：高级工具封装"搜索→判断→执行"逻辑，减少 AI 回合数
  - **平台特定工具**：根据消息来源（Discord/微信）自动注入平台工具
  - **工具注册表**：统一管理 50+ 工具和 Skill，支持热插拔

### 🚀 快速开始

#### 环境要求

- Node.js 16+
- Windows 10/11（当前版本）

#### 安装

```bash
# 克隆项目
git clone https://github.com/luckui/ai-live2d-go.git
cd ai-live2d-go

# 安装依赖
npm install

# 运行开发模式
npm run dev
```

#### 配置

1. 在项目根目录创建 `.env`
2. 配置你要使用的 AI 服务 API Key
3. 如无特殊需要，保持默认 `agentMode: 'off'`

```env
# 以豆包 / OpenAI Compatible 服务为例
DOUBAO_API_KEY=your_api_key_here

# 其他服务商按需补充
```

LLM 服务商和默认行为可在 [electron/ai.config.ts](electron/ai.config.ts) 中调整。

#### Agent 模式说明

项目采用 **ReAct Loop**（推理-行动-观察循环）架构：

```
用户请求 → AI 推理（Reasoning）→ 选择行动（Action）
    ↑                                        ↓
    └─────── 观察结果（Observation）←── 执行工具
```

**三级模式**：
- `chat`（默认）：14 个精选工具，适合日常对话
- `agent`：23 个完整工具，支持复杂任务自动化
- `agent-debug`：暴露底层工具（键盘/鼠标），开发调试专用

**切换方式**：
- 用户主动：对话中说"切换到 Agent 模式"
- AI 主动：遇到复杂任务时 AI 会调用 `switch_agent_mode` 工具

当前代码中的默认配置：
```ts
// electron/toolsets.ts
getCurrentToolsets() {
  return ['chat'];  // 默认 Chat 模式
}
```

#### 打包

```bash
# 构建并打包 Windows 版本
npm run pack:win
```

打包后的文件将在 `dist` 目录中。

### 📖 项目结构

```
├── electron/              # Electron 主进程代码
│   ├── main.ts           # 应用入口
│   ├── ai.config.ts      # AI 服务配置
│   ├── aiService.ts      # AI 对话服务
│   ├── llmClient.ts      # LLM 客户端
│   ├── ttsService.ts     # 语音合成服务
│   ├── db.ts             # 数据库管理
│   ├── toolsets.ts       # 🆕 声明式工具集管理（Chat/Agent/Discord/WeChat）
│   ├── agent/            # Agent 智能体系统
│   ├── memory/           # 记忆管理系统
│   ├── skills/           # 🆕 技能封装（Skill = 高级工具，打包多步骤逻辑）
│   │   ├── index.ts      # Skill 注册表
│   │   └── impl/         # Skill 实现
│   │       ├── discordSendFile.ts    # Discord 智能文件发送
│   │       ├── wechatSendFile.ts     # 🆕 微信智能文件发送
│   │       ├── browserOpen.ts        # 浏览器智能导航
│   │       ├── openTerminal.ts       # 终端智能打开
│   │       └── ...
│   ├── tools/            # 工具注册与实现
│   │   ├── index.ts      # 工具注册表（统一管理 50+ 工具）
│   │   ├── registry.ts   # 工具注册系统
│   │   └── impl/         # 工具实现
│   │       ├── discordSend.ts        # Discord 原子发送工具
│   │       ├── wechatSend.ts         # 🆕 微信原子发送工具（AES-128-ECB 加密）
│   │       ├── browser.ts            # 浏览器底层工具
│   │       ├── system.ts             # 系统级工具（键盘/鼠标）
│   │       └── ...
│ **前端框架**：Electron + TypeScript + electron-vite
- **Live2D 渲染**：Live2D Cubism SDK for Web
- **AI 对话**：OpenAI Compatible LLM API（支持多服务商）
- **数据存储**：SQLite（better-sqlite3）
- **平台集成**：
  - Discord Bot API
  - 微信 iLink Bot API（AES-128-ECB 加密传输）
- **系统能力**：
  - OCR：WinRT（Windows 10/11 内置）
  - 浏览器自动化：Playwright
  - 终端操作：Node.js child_process
  - 加密：Node.js crypto（AES-128-ECB）

### 🔧 开发指南

#### 添加新的 AI 服务商

编辑 `electron/ai.config.ts`，在 `providers` 中添加新配置：

```typescript
providers: {
  'your-service': {
    type: 'openai-compatible',
    name: '你的服务商',
    baseUrl: 'https://api.your-service.com/v1',
    apiKey: process.env.YOUR_API_KEY || '',
    model: 'your-model',
    maxTokens: 1024,
    temperature: 0.85,
  }
}
```

#### 添加新 Skill（高级工具）

1. 在 `electron/skills/impl/` 创建 Skill 文件，实现 `ToolDefinition<T>` 接口
2. 设置 `isSkill: true`
3. 在 `electron/skills/index.ts` 的 `skillList` 数组中注册
4. Skill 会自动注册到工具注册表，对 AI 完全透明

示例：
```typescript
// electron/skills/impl/myAwesomeSkill.ts
const myAwesomeSkill: ToolDefinition<MyParams> = {
  isSkill: true,
  schema: {
    type: 'function',
    function: {
      name: 'my_awesome_skill',
      description: '智能执行复杂任务...',
      parameters: { /* JSON Schema */ }
    }
  },
  async execute(params) {
    // 1. 搜索
    // 2. 判断
    // 3. 执行
    return '✅ 完成';
  }
};
export default myAwesomeSkill;
```

#### 添加新工具（原子工具）

1. 在 `electron/tools/impl/` 创建工具实现文件
2. 在 `electron/tools/index.ts` 调用 `.register(yourTool)` 注册
3. 在 `electron/toolsets.ts` 中将工具名添加到对应 toolset

示例：
```typescript
// electron/tools/impl/myTool.ts
const myTool: ToolDefinition<MyParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'my_tool',
      description: '执行某个原子操作',
      parameters: { /* JSON Schema */ }
    }
  },
  async execute(params) {
    // 单一功能，直接执行
    return '✅ 完成';
  }
};
export default myTool;
```

#### 添加新平台集成

1. 在 `electron/bridges/adapters/` 创建适配器（实现 `connect()` / `disconnect()` 等）
2. 在 `electron/tools/impl/` 创建平台专属工具（例：`platformSend.ts`）
3. 在 `electron/skills/impl/` 创建平台 Skill（例：`platformSendFile.ts`）
4. 在 `electron/toolsets.ts` 添加平台 toolset
5. 在 `electron/aiService.ts` 的 `detectPlatform()` 中添加检测逻辑

示例（微信集成）：
```typescript
// 1. 适配器
class WeChatAdapter {
  async sendFile(userId: string, filePath: string) {
    // AES-128-ECB 加密
    // CDN 上传
    // 发送消息
  }
}

// 2. 工具
const wechatSend: ToolDefinition = { /* ... */ };

// 3. Skill
const wechatSendFile: ToolDefinition = { /* ... */ };

// 4. Toolset
"wechat": {
  tools: ["wechat_send", "wechat_send_file"]
}

// 5. 检测
if (userContent.includes('[来源：WeChat | ...')) return 'wechat';
```
}
```

**优势**：
- 扁平化管理，易读易维护
- 按需加载，避免工具列表膨胀
- 平台工具自动注入，不污染基础模式

#### Skill vs Tool 设计

**Tool（原子工具）**：单一功能，直接执行
- `browser_open`：打开网页
- `discord_send`：发送 Discord 消息
- `wechat_send`：发送微信消息（含文件加密上传）

**Skill（高级封装）**：打包"搜索→判断→执行"逻辑，减少 AI 回合数
- `discord_send_file`：搜索文件 → 验证 → 发送（一次调用完成）
- `wechat_send_file`：搜索文件 → 去重 → 截图 → 发送
- `browser_open`：智能导航（合并 search + open 逻辑）

**何时用 Skill**：
1. 需要多次原子工具组合（例：搜索文件 → 验证 → 发送）
2. 有确定性分支决策（例：找到 0 个 / 1 个 / 多个文件的不同处理）
3. 用户高频使用的复杂操作（例：截图 → 压缩 → 发送）
### 🙏 致谢

- [Live2D Cubism SDK](https://www.live2d.com/) - Live2D 模型渲染
- [Electron](https://www.electronjs.org/) - 跨平台桌面应用框架
- [Hermes Agent](https://github.com/your/repo) - 微信 iLink Bot API 参考实现
- 各大 AI 服务提供商

### 📮 联系方式

- 提交 Issue: [GitHub Issues](https://github.com/luckui/ai-live2d-go/issues)
- 讨论区: [GitHub Discussions](https://github.com/luckui/ai-live2d-go/discussions)

---

## 🌟 最近更新

### v0.2.0 (2026-04-15) - 跨平台集成与 ReAct Loop 架构升级

**🚀 重大功能**
- ✨ **微信集成**：完整实现微信 iLink Bot API 文件发送功能
  - AES-128-ECB 加密 + 加密 CDN 传输
  - 支持图片、视频、文档、语音等多种媒体类型
  - 智能文件搜索与截图发送 Skill
  - 手机微信远程控制电脑能力

- ✨ **Discord 集成增强**
  - 自动使用最新对话（无需配置 CONVERSATION_ID）
  - 智能文件搜索与发送 Skill
  - OneDrive 桌面同步路径去重修复

**🏗️ 架构升级**
- 🔄 **ReAct Loop 重构**
  - 推理（Reasoning）→ 行动（Action）→ 观察（Observation）循环
  - 支持 3-10 轮自动执行（复杂任务自动分解）
  - 智能工具选择与结果验证

- 📦 **声明式 Toolset 系统**
  - 扁平化工具集管理（Chat/Agent/Agent-Debug/Discord/WeChat）
  - 平台特定工具动态注入（检测消息来源标签）
  - 按场景组合工具，避免工具列表膨胀

- 🎯 **Skill 系统完善**
  - Skill = 高级工具封装，打包"搜索→判断→执行"逻辑
  - 减少 AI 回合数，提升复杂任务成功率
  - 统一注册机制，对 AI 完全透明

- 🔌 **平台桥接系统**
  - 适配器模式：`DiscordAdapter` + `WeChatAdapter`
  - 消息来源检测 + 工具动态注入
  - 统一接口，平台特定实现

**💰 性能优化**
- 📊 **Token 消耗优化**
  - Chat 模式：~7,200 tokens/次（14 工具）
  - Agent 模式：~9,000 tokens/次（23 工具）
  - 按需切换模式，降低日常使用成本

**🐛 修复**
- 修复 Discord 消息无响应问题（空 CONVERSATION_ID）
- 修复 discord_send_file 路径重复（OneDrive 桌面同步）
- 修复微信 CDN 上传逻辑（encrypt_query_param 从响应头获取）

**📚 文档**
- 全面更新 README（架构设计、开发指南、Token 消耗估算）
- 添加 ReAct Loop 架构说明
- 添加 Skill vs Tool 设计说明
- 添加平台集成开发指南加 Skill vs Tool 设计说明
- 添加平台集成开发指南
#### 平台桥接系统

**适配器模式**：统一接口，平台特定实现
- `DiscordAdapter`：Discord Bot API
- `WeChatAdapter`：微信 iLink Bot API（AES-128-ECB 加密传输）

**消息来源检测**：
```typescript
// 自动检测消息标签，注入对应平台工具
function detectPlatform(userContent: string): string | null {
  if (userContent.includes('[来源：Discord | ...')) return 'discord';
  if (userContent.includes('[来源：WeChat | ...')) return 'wechat';
  return null;
}
```

**工具动态注入**：
```typescript
const enabledToolsets = ['chat'];  // 或 ['agent']
const platform = detectPlatform(userContent);
if (platform) {
  enabledToolsets.push(platform);  // ['chat', 'discord']
}
const tools = toolRegistry.getSchemasForToolset(enabledToolsets);
```



## 技术栈

- Electron
- electron-vite
- TypeScript
- Live2D Cubism
- SQLite
- OpenAI Compatible LLM API

### 🔧 开发指南

#### 添加新的 AI 服务商

编辑 `electron/ai.config.ts`，在 `providers` 中添加新配置：

```typescript
providers: {
  'your-service': {
    type: 'openai-compatible',
    name: '你的服务商',
    baseUrl: 'https://api.your-service.com/v1',
    apiKey: process.env.YOUR_API_KEY || '',
    model: 'your-model',
    maxTokens: 1024,
    temperature: 0.85,
  }
}
```

#### 添加新技能

1. 在 `electron/skills/impl/` 创建技能实现文件
2. 在 `electron/skills/index.ts` 注册技能
3. 在 `electron/manual/` 添加使用说明（可选）

#### 添加新工具

1. 在 `electron/tools/impl/` 创建工具实现文件
2. 在 `electron/tools/registry.ts` 注册工具
3. 定义工具的 JSON Schema 参数

### 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

如有任何问题或建议，请通过 [GitHub Issues](https://github.com/luckui/ai-live2d-go/issues) 提出。

### 📄 开源许可

本项目采用 MIT License 开源。

### 🙏 致谢

- [Live2D Cubism SDK](https://www.live2d.com/) - Live2D 模型渲染
- [Electron](https://www.electronjs.org/) - 跨平台桌面应用框架
- 各大 AI 服务提供商

### 📮 联系方式

- 提交 Issue: [GitHub Issues](https://github.com/luckui/ai-live2d-go/issues)
- 讨论区: [GitHub Discussions](https://github.com/luckui/ai-live2d-go/discussions)
