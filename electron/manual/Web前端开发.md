# Web 前端开发

从零创建 Web 前端项目的标准工作流程。

---

## 触发条件

- 用户要求创建网页 / Web 应用 / HTML 页面
- 用户要求开发前端项目（含三维、地图、可视化等）
- 任何涉及 HTML + CSS + JS 的新项目

---

## 强制前置步骤

在写任何代码之前：

1. **创建 todo 任务列表**（必须包含以下子任务）
2. **查阅 read_manual("任务规划工作流")**
3. **明确技术选型**（框架、库、构建工具）
4. **确认项目结构**（目录布局、文件命名）

---

## 项目初始化流程

### 步骤 1：创建项目目录

```
run_command: mkdir <项目路径>
```

### 步骤 2：确定技术栈

根据需求选择：

| 需求 | 推荐方案 |
|------|----------|
| 简单静态页面 | 纯 HTML + CSS + JS |
| 三维场景 | Three.js / Babylon.js |
| 地图应用 | Mapbox GL / Cesium / Leaflet + 三维插件 |
| 数据可视化 | D3.js / ECharts |
| SPA 应用 | React / Vue + Vite |
| 需要包管理 | `npm init -y` + `npm install xxx`（用 cwd 参数指定目录） |

> ⚠️ **脚手架命令必须加 env={"CI": "true"}** — run_command 不支持交互式输入，但加 CI=true 后脚手架会跳过交互。
> ```
> ✅ command = "npm create vite@latest . -- --template vanilla"
>    cwd = "C:\Users\PC\Desktop\aimap"
>    env = {"CI": "true"}
> ```
> 
> ⚠️ **run_command 的 cwd 参数** — 在目标目录执行命令时，必须用 cwd 参数，不要用 `cd`。
> ```
> ❌ command = "cd C:\Users\PC\Desktop\aimap && npm init -y"
> ✅ command = "npm init -y", cwd = "C:\Users\PC\Desktop\aimap"
> ```

### 步骤 3：创建基础文件结构

最小可运行结构：

```
项目目录/
├── index.html      （入口）
├── style.css       （样式，从 HTML 分离）
├── main.js         （逻辑，从 HTML 分离）
└── README.md       （项目说明）
```

> ⚠️ **禁止把所有代码塞进一个 HTML 文件**。CSS 和 JS 必须分离为独立文件。

### 步骤 4：编写 index.html 骨架

必须包含：
- `<!DOCTYPE html>` 声明
- `<meta charset="UTF-8">`
- `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
- 外链 CSS：`<link rel="stylesheet" href="style.css">`
- 外链 JS：`<script src="main.js"></script>`（或 `type="module"`）
- 如果引用 CDN 库，必须使用带版本号的完整 URL

### 步骤 5：验证可运行

写完后**立即验证**：
1. 用 `browser_open` 打开本地文件（见下方"本地文件打开方式"）
2. 用 `browser_screenshot` 截图确认页面渲染正常
3. **用 `browser_read_page` 检查是否有控制台错误**
4. 如有错误 → 修复后重新验证，不要跳过

> ⚠️ **关键：build 成功 ≠ 浏览器能运行！**  
> 很多错误只在浏览器 F12 控制台显示（ES Module 导入错误、CORS、依赖版本不匹配等）。  
> `browser_read_page` 会自动捕获并返回这些错误，**必须检查并修复**。
>
> 常见浏览器运行时错误：
> - `does not provide an export named 'XXX'` — ES Module 导出名错误或包版本不匹配
> - `CORS policy` — file:// 无法加载本地资源，需要启动开发服务器
> - `Failed to fetch dynamically imported module` — Vite 缓存问题，删除 `node_modules/.vite`
> - `Uncaught ReferenceError` — 变量未定义，检查 import 语句和依赖安装

---

## 本地文件打开方式

打开本地 HTML 文件时，**必须使用 file:// 协议**：

```
browser_open(url="file:///C:/Users/用户名/Desktop/项目/index.html")
```

> ⚠️ 注意：
> - 路径用正斜杠 `/`，不用反斜杠 `\`
> - Windows 盘符前有三个斜杠：`file:///D:/...`
> - **不要把本地路径当作搜索关键词**传给 browser_open，那会触发搜索引擎而非打开文件

---

## CDN 引用规范

引用第三方库时：
- ✅ 使用 `unpkg.com` 或 `cdn.jsdelivr.net`，带明确版本号
- ✅ 示例：`<script src="https://unpkg.com/three@0.160.0/build/three.module.js" type="module"></script>`
- ❌ 不要用无版本号的 URL（可能随时变化）
- ❌ 不要引用本地不存在的文件路径

---

## 常见错误检查清单

写完代码后逐项检查：

- [ ] HTML 标签是否闭合正确
- [ ] CSS/JS 外链路径是否正确（相对路径 vs 绝对路径）
- [ ] CDN URL 是否可访问、版本号是否存在
- [ ] `type="module"` 的 script 是否使用了 `import`（需要服务器或正确的 CORS）
- [ ] 三方库的 API 调用是否与引用的版本匹配
- [ ] 控制台有无报错（用 browser_read_page 检查）

---

## 需要本地服务器的场景

以下情况 file:// 协议不够，需要启动本地服务器：

- 使用 ES Module（`import/export`）
- 加载本地 JSON / 模型 / 纹理文件（CORS 限制）
- 使用 Web Worker
- 使用 Vite / Webpack 等构建工具的开发模式

启动方式：

### 方式 1：用 start_terminal 工具（推荐）

**⚠️ 完整流程（5 步，缺一不可）：**

```javascript
// 步骤 1：启动终端会话
start_terminal({ 
  command: "npm run dev", 
  cwd: "C:\\Users\\PC\\Desktop\\aimap",
  env: {"CI": "true"}
})
// 返回：{ id: "uuid-xxx", output: "..." }

// 步骤 2：等待 3-5 秒（给服务器启动时间）
// 不要用 run_command 等待，直接在下一个工具调用前自然等待

// 步骤 3：获取累积输出，查找服务器地址
get_terminal_output({ id: "uuid-xxx" })
// 查找输出中的 "Local: http://localhost:5173" 或 "Server running at"

// 步骤 4：用浏览器打开服务器地址
browser_open(url="http://localhost:5173")  // 使用步骤 3 找到的地址

// 步骤 5：验证页面 + 检查控制台错误
browser_screenshot()  // 截图确认页面渲染
browser_read_page()   // 检查是否有控制台错误（ES Module、CORS 等）

// 完成后汇报：服务器已启动，页面正常/有错误
```

**Python HTTP 服务器示例：**

```javascript
start_terminal({ 
  command: "python -m http.server 8080", 
  cwd: "C:\\Users\\PC\\Desktop\\aimap"
})
// 同样必须完成上述 5 步流程
```

> ❌ **常见错误模式（禁止）**：
> - `start_terminal` → 等待 2 秒 → 汇报"启动成功" ← 你没验证！
> - `start_terminal` → 忘记 `get_terminal_output` ← 不知道服务器状态
> - `start_terminal` → 忘记 `browser` 验证 ← 不知道页面能否访问
> - 跳过 todo 计划中的后续步骤 ← todo 不是装饰品！
>
> ✅ **正确模式**：
> - 创建 todo 包含完整 5 步流程
> - 逐步执行，每步完成后标记 todo
> - 最后用截图 + 控制台检查确认无误

### 方式 2：直接在终端手动启动

告诉用户打开终端，进入项目目录，执行 `npm run dev` 或 `python -m http.server`。

> ❌ **禁止用 run_command 启动开发服务器**  
> run_command 会检测到常驻进程并拒绝执行，使用 start_terminal 代替。

---

## 注意事项

1. **先规划再编码** — 不要收到需求就开始写 HTML
2. **增量开发** — 先跑通空白页面，再逐步加功能，每步验证
3. **分离关注点** — HTML 结构 / CSS 样式 / JS 逻辑 分文件
4. **验证优先** — 每次改动后都用浏览器打开检查，不要"写完一大堆再看"
5. **报告进度** — 每完成一步用 todo 标记，截图给用户确认