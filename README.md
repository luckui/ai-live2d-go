<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=28&duration=3000&pause=1000&color=FF6B9D&center=true&vCenter=true&multiline=true&repeat=false&width=500&height=80&lines=%F0%9F%8C%B8+Hiyori;Live2D+%C3%97+AI+Agent+Desktop+Companion" alt="Hiyori" />
</p>

<p align="center">
  <strong>Live2D Desktop Pet x Full-featured AI Agent</strong><br/>
  <sub>不只是会说话的纸片人。</sub>
</p>

<p align="center">
  她会操作你的浏览器、跑你的终端命令、管理你的文件，<br/>
  记住你每次说过的话，并通过 Discord / 微信接受你的远程指令。
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> &bull;
  <a href="#-features">Features</a> &bull;
  <a href="#-agent-architecture">Architecture</a> &bull;
  <a href="#%EF%B8%8F-configuration">Configuration</a> &bull;
  <a href="#-development">Development</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows 10/11" />
  <img src="https://img.shields.io/badge/runtime-Electron-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/lang-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License" />
  <img src="https://img.shields.io/badge/LLM-OpenAI%20Compatible-412991?style=flat-square" alt="OpenAI Compatible" />
</p>

---

## What is Hiyori?

**Hiyori** is a Live2D desktop character running on Windows, powered by a full AI Agent system under the hood.

Most Live2D desktop pets can only chat. Hiyori is different -- she has **40+ tools**, can autonomously plan and execute multi-step tasks, while staying as cute as an anime character should be.

```
Phone Discord message: "Send me the report on my desktop"
    -> Hiyori searches files -> finds it -> sends to Discord
    -> Phone receives file ✓
```

**Core philosophy**: Pack [Hermes Agent](https://github.com/NousResearch/hermes-agent)-level agent capabilities into a character you'd actually want on your desktop.

---

## ✨ Features

<table>
<tr>
<td width="50%" valign="top">

### 🤖 AI Agent System
- **ReAct Loop**: Reasoning → Action → Observation, 3-10 rounds auto-execution
- **4-tier tool modes**: Chat → Agent → Developer → Worker
- **40+ tools**: Browser / Terminal / Files / Git / OCR / Cron
- **Skill system**: Multi-step operations in a single tool call
- **Task tracking**: Built-in Todo for complex task decomposition
- **Batch execution**: Worker mode for parallel subtasks

</td>
<td width="50%" valign="top">

### 🧠 Memory System
- **Conversation-level summarization**: Auto-refine every 10 turns
- **Global core memory**: Cross-session user profile (Hermes-style USER + MEMORY dual blocks)
- **Idle scheduler**: Background summarization when user is inactive
- **Startup catch-up**: Bulk process unsummarized history on restart
- **AI self-managed**: Agent proactively updates user knowledge via `memory` tool
- **SQLite persistence**: WAL mode, zero external dependencies

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 📱 Cross-platform Remote Control
- **Discord Bot**: Phone commands → PC executes → files/screenshots sent back
- **WeChat integration**: iLink Bot API, AES-128-ECB encrypted CDN transport
- **Smart file search**: Scans Desktop / Downloads / Documents
- **Auto tool injection**: Detects message source, dynamically loads platform tools

</td>
<td width="50%" valign="top">

### 🎭 Live2D & Voice
- **Hiyori / Hiyori Pro** high-quality Live2D models
- Desktop drag, click interaction, auto blink/look-at
- **Edge-TTS**: Online voice synthesis, zero config
- **MOSS-TTS-Nano**: Local offline voice cloning (17 preset voices)
- Custom reference audio for voice cloning

</td>
</tr>
</table>

---

## 🚀 Quick Start

### Requirements

| Dependency | Version | Note |
|-----------|---------|------|
| Node.js | 18+ | LTS recommended |
| Windows | 10/11 | OCR relies on WinRT |
| Python | 3.10+ (optional) | For document processing, TTS-Nano |

### Install & Run

```bash
git clone https://github.com/luckui/ai-live2d-go.git
cd hiyori
npm install
npm run dev
```

### Configure LLM

Create `.env` in project root:

```env
# Doubao (ByteDance)
DOUBAO_API_KEY=your_key_here

# Or any OpenAI Compatible provider
OPENAI_API_KEY=your_key_here
DEEPSEEK_API_KEY=your_key_here
```

> **Any OpenAI Compatible API works**: OpenAI / DeepSeek / Zhipu / Moonshot / Doubao / Qwen / SiliconFlow, etc. Configure in `electron/ai.config.ts`.

### Build

```bash
npm run pack:win    # Build Windows installer -> dist/
```

---

## 🏗 Agent Architecture

```
User Message --> Mode Router --> System Prompt (persona + memory + manual)
                    |                        |
                    |                       LLM (any OpenAI Compatible)
                    |                        |
                    |              +-- Text reply --> return to user
                    |              +-- tool_calls --> execute tools --> feed back --> re-request LLM
                    |                                                                    ^
                    |                              ReAct Loop (up to 10 rounds) --------+
                    v
         Leave conversation --> Summarize --> Global memory refinement --> SQLite
```

### Tool Modes

| Mode | Tools | System Prompt | Purpose |
|------|-------|--------------|---------|
| **Chat** | ~15 | Lightweight persona | Casual chat, simple commands |
| **Agent** | ~25 | Full capabilities + Todo enforcement + Manual | Complex task automation |
| **Developer** | ~35 | Methodology-driven (TDD/Plan/Debug) | Software engineering |
| **Worker** | 6 | Minimal, no persona | Batch subtask execution |

> Mode switching: Say "switch to Agent mode" in chat, or AI auto-upgrades when facing complex tasks.

### Skill System

**Skill = Multi-step logic packaged as a single tool call**, reducing LLM round-trips:

| Skill | Internal Logic |
|-------|---------------|
| `browser_click_smart` | Scan page elements → fuzzy match → confirm click |
| `discord_send_file` | Search files → deduplicate paths → send |
| `wechat_send_file` | Search → AES encrypt → CDN upload → send |
| `write_file` | Content validation → overwrite/append → confirm |

### Memory Architecture (inspired by [Hermes Agent](https://github.com/NousResearch/hermes-agent))

```
Chat messages --> Conversation summary (every 10 turns, 150-char refinement)
                         |
                  memory_fragments table (SQLite)
                         |
                  Global memory refinement (Hermes-style structured output)
                         |
              +----------+----------+
              | USER Profile        | MEMORY Config        |
              | User preferences    | Environment info     |
              | Personality traits   | Tool experience     |
              | Common patterns     | Path memory          |
              +----------+----------+
                         |
              Injected into System Prompt (every conversation)
```

---

## ⚙️ Configuration

### LLM Provider

Edit `electron/ai.config.ts`:

```typescript
{
  activeProvider: 'doubao',
  providers: {
    doubao: {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: process.env.DOUBAO_API_KEY || '',
      model: 'doubao-seed-1-8-251228',
      maxTokens: 4096,
      temperature: 0.85,
      reasoningMaxTokens: 2048,              // thinking token limit for reasoning models
      reasoningModelPattern: /seed|think|r1/i, // auto-detect reasoning models
    },
    // Add more providers...
  }
}
```

### Platform Integrations

Configure in `.env`:

```env
# Discord Bot
DISCORD_ENABLED=true
DISCORD_TOKEN=your_bot_token
DISCORD_ALLOWED_CHANNELS=channel_id_1,channel_id_2

# WeChat (iLink Bot API)
WECHAT_ENABLED=true
WECHAT_TOKEN=your_token
WECHAT_ACCOUNT_ID=your_account_id

# Proxy (optional)
DISCORD_PROXY=http://127.0.0.1:7890
```

### TTS Voice

Switch engines in `electron/tts.config.ts`:

| Engine | Port | Features |
|--------|------|----------|
| **Edge-TTS** | 9880 | Online, free, works out of the box |
| **MOSS-TTS-Nano** | 9881 | Local offline, voice cloning, 17 presets |

---

## 🛠 Development

### Project Structure

```
electron/
├── main.ts              # Electron main process entry
├── ai.config.ts         # LLM provider configuration
├── aiService.ts         # AI chat service + ReAct Loop
├── llmClient.ts         # LLM HTTP client
├── toolsets.ts          # Declarative tool sets (Chat/Agent/Developer/Worker)
├── db.ts                # SQLite database
├── taskManager.ts       # Concurrent task manager (MAX_CONCURRENT=3)
├── batchRunner.ts       # Batch task executor
├── bridges/             # Platform adapters (Discord / WeChat)
├── memory/              # Memory system (conversation summaries + global refinement)
├── prompts/             # Per-mode System Prompts
├── tools/impl/          # 40+ tool implementations
├── manual/              # AI knowledge base (operation manuals)
└── utils/               # Utilities
src/                     # Renderer process (Live2D + Chat UI)
tts-server/              # Edge-TTS server
tts-server-nano/         # MOSS-TTS-Nano local voice server
```

### Adding a New Tool

```typescript
// electron/tools/impl/myTool.ts
import type { ToolDefinition } from '../registry';

const myTool: ToolDefinition<{ query: string }> = {
  schema: {
    type: 'function',
    function: {
      name: 'my_tool',
      description: 'Does something useful',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }
  },
  async execute({ query }) {
    return `Result: ${query}`;
  }
};
export default myTool;
```

Register in `electron/tools/index.ts`, add to a toolset in `electron/toolsets.ts`.

### Adding a New Platform

1. `electron/bridges/adapters/` — Create adapter (`connect()` / `disconnect()`)
2. `electron/tools/impl/` — Create platform send tool
3. `electron/toolsets.ts` — Add platform toolset
4. `electron/aiService.ts` — Add detection in `detectPlatform()`

---

## 📊 Token Usage Reference

| Mode | Per Request | Complex Task (3-10 ReAct rounds) |
|------|------------|----------------------------------|
| Chat | ~7,000 tokens | ~15,000 tokens |
| Agent | ~9,000 tokens | ~30,000 - 90,000 tokens |
| Developer | ~12,000 tokens | ~50,000 - 120,000 tokens |

> Recommended: Large-context models like Doubao-Seed / DeepSeek-R1 / GPT-4o / Qwen-Plus.

---

## 🗺 Roadmap

- [x] ReAct Loop Agent system
- [x] Hermes-style structured memory
- [x] Discord / WeChat remote control
- [x] Multi TTS engine (Edge-TTS + MOSS-TTS-Nano)
- [x] Batch tasks & Worker mode
- [x] Developer mode (methodology-driven software engineering)
- [ ] macOS / Linux support
- [ ] Telegram integration
- [ ] Plugin system
- [ ] Multi-character Live2D model switching
- [ ] Voice input (ASR)

---

## 🙏 Acknowledgements

- [Live2D Cubism SDK](https://www.live2d.com/) — Live2D model rendering
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — Major reference for agent architecture & memory system
- [Project AIRI](https://github.com/moeru-ai/airi) — Pioneer of anime AI companions
- [Electron](https://www.electronjs.org/) — Cross-platform desktop framework
- [Playwright](https://playwright.dev/) — Browser automation

---

## 📄 License

[MIT](LICENSE)

### Adding a New Tool

```typescript
// electron/tools/impl/myTool.ts
import type { ToolDefinition } from '../registry';

const myTool: ToolDefinition<{ query: string }> = {
  schema: {
    type: 'function',
    function: {
      name: 'my_tool',
      description: 'Does something useful',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }
  },
  async execute({ query }) {
    return `Result: ${query}`;
  }
};
export default myTool;
```

Register in `electron/tools/index.ts`, add to a toolset in `electron/toolsets.ts`.

### Adding a New Platform

1. `electron/bridges/adapters/` — Create adapter (`connect()` / `disconnect()`)
2. `electron/tools/impl/` — Create platform send tool
3. `electron/toolsets.ts` — Add platform toolset
4. `electron/aiService.ts` — Add detection in `detectPlatform()`

---

## 📊 Token Usage Reference

| Mode | Per Request | Complex Task (3-10 ReAct rounds) |
|------|------------|----------------------------------|
| Chat | ~7,000 tokens | ~15,000 tokens |
| Agent | ~9,000 tokens | ~30,000 - 90,000 tokens |
| Developer | ~12,000 tokens | ~50,000 - 120,000 tokens |

> Recommended: Large-context models like Doubao-Seed / DeepSeek-R1 / GPT-4o / Qwen-Plus.

---

## 🗺 Roadmap

- [x] ReAct Loop Agent system
- [x] Hermes-style structured memory
- [x] Discord / WeChat remote control
- [x] Multi TTS engine (Edge-TTS + MOSS-TTS-Nano)
- [x] Batch tasks & Worker mode
- [x] Developer mode (methodology-driven software engineering)
- [ ] macOS / Linux support
- [ ] Telegram integration
- [ ] Plugin system
- [ ] Multi-character Live2D model switching
- [ ] Voice input (ASR)

---

## 🙏 Acknowledgements

- [Live2D Cubism SDK](https://www.live2d.com/) — Live2D model rendering
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — Major reference for agent architecture & memory system
- [Project AIRI](https://github.com/moeru-ai/airi) — Pioneer of anime AI companions
- [Electron](https://www.electronjs.org/) — Cross-platform desktop framework
- [Playwright](https://playwright.dev/) — Browser automation

---

## 📄 License

[MIT](LICENSE)
