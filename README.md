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

- 当前版本主要支持 Windows 10/11
- 普通聊天模式可作为日常默认使用方式
- Agent 模式目前仍不稳定，复杂多步骤任务下可能出现规划偏差、工具调用不连续或结果验证不可靠的问题
- 因此项目当前默认关闭强制 Agent 模式，对应配置为 `agentMode: 'off'`

如果你只是日常聊天、简单问答或偶尔调用工具，建议保持默认配置。

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
  - 任务规划与分解
  - 多步骤任务执行
  - 自动验证和错误处理
  - 丰富的技能工具库
  - 当前仍处于迭代阶段，不建议作为日常默认模式启用

- 🔧 **实用技能工具**
  - 浏览器自动化操作（打开、点击、输入）
  - 命令行终端操作
  - 文件读写管理
  - Python 环境检查
  - OCR 文字识别
  - Discord 消息发送

- 🗣️ **语音合成 (TTS)**
  - 支持将文本转换为语音
  - 可自定义语音参数

- 📚 **知识库系统**
  - 内置操作说明书（浏览器操作、命令行操作等）
  - AI 可主动查阅和学习
  - 支持自定义知识条目

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

当前代码中的默认配置如下：

```ts
agentMode: 'off'
```

含义：

- `off`：默认普通聊天模式，不强制每条消息都走 Agent
- `force`：每条用户消息都直接走 Agent 执行链

由于 Agent 模式目前还不稳定，README 中的建议是：

- 平时默认使用普通聊天模式
- 只有在明确需要多步骤自动执行时再手动启用或触发 Agent 能力

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
│   ├── agent/            # Agent 智能体系统
│   ├── memory/           # 记忆管理系统
│   ├── skills/           # 技能实现
│   ├── tools/            # 工具注册与实现
│   ├── bridges/          # 外部服务桥接（Discord等）
│   └── manual/           # 内置知识库
├── src/                  # 前端渲染进程代码
│   ├── main.ts           # 前端入口
│   ├── chat.ts           # 聊天界面
│   ├── lapp*.ts          # Live2D 相关模块
│   └── framework/        # Live2D Cubism 框架
├── public/               # 静态资源
│   ├── Core/             # Live2D Core
│   └── Resources/        # Live2D 模型资源
└── devtools/             # 开发工具脚本

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
