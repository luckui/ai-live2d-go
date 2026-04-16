# 能力对比：Hiyori vs Hermes Agent

## 定位差异

| 项目 | 定位 | 目标用户 |
|------|------|---------|
| **Hermes Agent** | 代码开发助手 + 通用 AI Agent | 软件工程师、打工人 |
| **Hiyori（当前项目）** | 桌面宠物助手 + 跨平台远程控制 | 个人用户、桌面助手爱好者 |

---

## 核心能力对比

### ✅ Hiyori 的优势

| 能力 | Hiyori | Hermes Agent | 说明 |
|------|--------|--------------|------|
| **Live2D 桌面宠物** | ✅ | ❌ | 可爱的角色、动画交互 |
| **浏览器自动化** | ✅✅✅ | ✅ | Playwright，智能点击/输入 Skill |
| **微信集成** | ✅ | ✅ | AES-128-ECB 加密文件传输 |
| **Discord 集成** | ✅ | ✅ | 智能文件搜索与发送 |
| **OCR 能力** | ✅ | ❌ | WinRT（Win10/11 内置） |
| **语音合成 (TTS)** | ✅ | ✅ | |
| **ReAct Loop** | ✅ | ✅ | 推理-行动-观察循环 |
| **Toolset 系统** | ✅ | ✅ | 声明式工具集管理 |

### ❌ Hiyori 缺少的关键能力（代码开发相关）

| 能力 | Hiyori | Hermes Agent | 影响 |
|------|--------|--------------|------|
| **文件编辑工具** | ❌ | ✅ | 无法编辑现有代码文件 |
| **文件读取工具** | ❌ | ✅ | 无法查看代码内容 |
| **代码执行** | ❌ | ✅ | 无法直接执行 Python 脚本 |
| **Git 操作** | ❌ | ✅ | 无法提交、推送、管理代码 |
| **项目管理** | ❌ | ✅ | 无 issue tracking |
| **FTS5 全文搜索** | ❌ | ✅ | 记忆系统较弱 |
| **技能自我改进** | ❌ | ✅ | 技能无法自动优化 |
| **定时任务调度** | ❌ | ✅ | 无 cron 调度器 |
| **子代理并行化** | ❌ | ✅ | 无法并行执行任务 |
| **多终端后端** | ❌ | ✅ | 只支持本地终端 |

---

## 工具生态对比

### Hiyori 当前工具（~50 个）

**核心工具**：
- `memory`, `todo`, `read_manual`, `run_command`
- `browser_*`（8 个浏览器工具）
- `sys_*`（键盘/鼠标/OCR）
- `discord_send`, `wechat_send`

**Skills**（高级封装）：
- `browser_open`, `browser_click_smart`, `browser_type_smart`
- `discord_send_file`, `wechat_send_file`
- `write_file`, `open_terminal`, `check_python_env`

**缺失的代码开发工具**：
- ❌ `read_file`（读取文件内容）
- ❌ `edit_file`（编辑现有文件，使用 diff/patch）
- ❌ `execute_code`（执行 Python 脚本）
- ❌ `git_*`（Git 操作）
- ❌ `search_files`（项目内代码搜索）
- ❌ `list_directory`（列出目录内容）

### Hermes Agent 工具（40+ 个）

**代码开发相关**：
- `read_file`, `edit_file`, `create_file`
- `execute_code`（沙箱 Python 执行）
- `git_commit`, `git_push`, `git_diff`
- `search_files`, `list_directory`

**系统操作**：
- `bash`（多终端后端：SSH/Docker/Daytona/Modal）
- `subprocess`（异步执行）

**高级能力**：
- `create_skill`（自动创建技能）
- `improve_skill`（技能自我改进）
- `search_memory`（FTS5 全文搜索）
- `schedule_task`（cron 定时任务）

---

## 架构对比

| 架构特性 | Hiyori | Hermes Agent |
|---------|--------|--------------|
| **ReAct Loop** | ✅ | ✅ |
| **Toolset 系统** | ✅ | ✅ |
| **Skill 系统** | ✅（静态） | ✅（动态 + 自我改进） |
| **记忆系统** | 全局 + 会话 | FTS5 + 用户建模 + 跨会话检索 |
| **平台集成** | Discord + 微信 | Telegram + Discord + Slack + WhatsApp + Signal |
| **终端后端** | 本地 | 本地 + SSH + Docker + Daytona + Modal |
| **并行化** | ❌ | ✅（子代理） |
| **定时任务** | ❌ | ✅（cron） |

---

## 能否胜任代码开发任务？

### 🔴 **当前答案：NO**

**缺少关键能力**：
1. ❌ 无法读取文件内容（`read_file`）
2. ❌ 无法编辑现有文件（`edit_file`）
3. ❌ 无法执行代码验证（`execute_code`）
4. ❌ 无法管理 Git 版本（`git_*`）

**当前最佳用途**：
- ✅ 桌面助手（截图、浏览器自动化、系统操作）
- ✅ 跨平台远程控制（手机微信/Discord → 电脑执行）
- ✅ 简单文件创建（`write_file`）
- ✅ 终端命令执行（`run_command`）

### 🟢 **如何扩展到代码开发能力？**

**需要添加的工具**（优先级排序）：

1. **文件操作工具**（P0，必须）
   ```typescript
   - read_file(path, startLine?, endLine?)  // 读取文件
   - edit_file(path, oldText, newText)      // 编辑文件（diff/patch）
   - list_directory(path)                   // 列出目录
   - search_files(pattern, query)           // 搜索代码
   ```

2. **代码执行工具**（P0，必须）
   ```typescript
   - execute_python(code)                   // 执行 Python 脚本
   - execute_node(code)                     // 执行 Node.js 代码
   ```

3. **Git 操作工具**（P1，重要）
   ```typescript
   - git_status()                           // 查看状态
   - git_diff()                             // 查看差异
   - git_commit(message)                    // 提交
   - git_push()                             // 推送
   ```

4. **高级能力**（P2，可选）
   ```typescript
   - create_skill(name, description)        // 自动创建技能
   - search_memory(query)                   // FTS5 搜索
   - schedule_task(cron, task)              // 定时任务
   ```

---

## LLM 能力影响

### 工具生态 > LLM 模型

**重要性排序**：
1. **工具生态**（80%）：有没有 `edit_file`、`execute_code` 等关键工具
2. **Prompt 工程**（15%）：如何引导 AI 正确使用工具
3. **LLM 模型**（5%）：GPT-4 vs DeepSeek vs Claude

**示例**：
- ✅ **Hermes + GPT-3.5**：能写代码（有工具）
- ❌ **Hiyori + GPT-4**：不能写代码（缺工具）

**结论**：
- 即使接上 GPT-4o、Claude Opus 等顶级模型，当前 Hiyori 也**无法胜任代码开发任务**
- 因为缺少核心工具（`read_file`、`edit_file`、`execute_code`）

---

## 扩展路径建议

### 方案 A：专注桌面助手（推荐）

**定位**：
- Live2D 桌面宠物 + 跨平台远程控制
- 浏览器自动化专家
- 系统操作助手

**优势**：
- 差异化明显（Live2D + OCR + 微信加密传输）
- 与 Hermes Agent 错位竞争
- 用户群体明确（个人用户、桌面助手爱好者）

### 方案 B：扩展为全功能 Agent

**需要添加**：
1. 文件操作工具（`read_file`, `edit_file`）
2. 代码执行工具（`execute_python`, `execute_node`）
3. Git 操作工具
4. FTS5 全文搜索
5. 技能自我改进系统
6. 定时任务调度器

**优势**：
- 功能对标 Hermes Agent
- 支持代码开发任务

**劣势**：
- 开发量大（估计 2-3 个月）
- 与 Hermes Agent 正面竞争

---

## 总结

### 当前项目定位

✅ **擅长**：
- 桌面助手（Live2D + 语音 + 截图）
- 跨平台远程控制（Discord + 微信）
- 浏览器自动化（Playwright）
- 系统操作（OCR + 键盘/鼠标）

❌ **不擅长**：
- 代码开发（缺核心工具）
- 项目管理（缺 Git/Issue）
- 复杂数据处理（缺代码执行）

### 与 Hermes Agent 对比

| 维度 | Hiyori | Hermes Agent |
|------|--------|--------------|
| **代码开发** | ❌ 0/10 | ✅ 10/10 |
| **桌面助手** | ✅ 10/10 | ✅ 6/10 |
| **浏览器自动化** | ✅ 9/10 | ✅ 7/10 |
| **跨平台集成** | ✅ 8/10 | ✅ 10/10 |
| **记忆系统** | ✅ 6/10 | ✅ 10/10 |
| **技能系统** | ✅ 7/10 | ✅ 10/10 |

### 建议

1. **专注桌面助手**：发挥 Live2D + OCR + 微信加密传输的差异化优势
2. **如需代码开发能力**：优先添加 `read_file` + `edit_file` + `execute_code`
3. **LLM 模型**：当前架构下，模型对能力边界影响不大（工具生态更重要）

---

**结论**：当前项目是**优秀的桌面助手**，但**不是代码开发助手**。如需后者，需添加关键工具（预计 1-2 个月开发量）。架构上完全支持扩展，但要考虑与 Hermes Agent 的差异化定位。
