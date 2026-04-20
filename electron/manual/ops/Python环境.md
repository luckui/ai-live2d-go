# Python 环境

Agent 使用 Python 的环境管理规范。

---

## 环境变量（自动注入）

run_command 执行的所有命令中，以下环境变量**自动可用**，无需手动检测路径：

| 变量 | 含义 | 示例值 |
|------|------|--------|
| `%HIYORI_UV_EXE%` | 应用内嵌的 uv.exe 路径 | `C:\...\resources\tools\uv.exe` |
| `%HIYORI_DATA_DIR%` | 应用用户数据目录 | `C:\Users\xxx\AppData\Roaming\Hiyori` |

**直接在命令中使用即可**，不需要判断开发/打包环境。

---

## 环境检测策略

需要执行 Python 时，按以下优先级检测：

### 1. 用户已有的 Python（优先使用）

```powershell
# 检测 conda
conda --version

# 检测系统 Python
python --version

# 检测 Windows py launcher
py --version

# PATH 中是否有 uv（用户自行安装的）
where uv

# 也可以直接检测系统 Python 位置
where python
```

**如果用户有 conda**：
```powershell
conda run -n base python script.py
conda run -n base pip install 包名
```

**如果用户有系统 Python**：
```powershell
python script.py
pip install 包名
```

### 2. 用户没有 Python → 用内嵌 uv 创建持久环境

**环境位置**：`%HIYORI_DATA_DIR%\agent-python\.venv`

uv 会**自动下载 Python 解释器**（约 30MB，缓存在 `%LOCALAPPDATA%\uv\python`），用户无需预装任何东西。

**首次创建**（仅需一次）：
```powershell
"%HIYORI_UV_EXE%" venv "%HIYORI_DATA_DIR%\agent-python" --python 3.11
```

**后续使用**：
```powershell
# 安装包
"%HIYORI_UV_EXE%" pip install --python "%HIYORI_DATA_DIR%\agent-python\.venv\Scripts\python.exe" pandas

# 执行脚本
"%HIYORI_DATA_DIR%\agent-python\.venv\Scripts\python.exe" script.py

# 或用 uv run（自动激活虚拟环境）
"%HIYORI_UV_EXE%" run --directory "%HIYORI_DATA_DIR%\agent-python" python script.py
```

---

## 完整检测流程

```
需要执行 Python
    ↓
python --version 或 conda --version 成功？
    ↓ 是 → 直接使用用户环境
    ↓ 否
%HIYORI_DATA_DIR%\agent-python\.venv 存在？
    ↓ 是 → 直接使用
    ↓ 否
创建："%HIYORI_UV_EXE%" venv "%HIYORI_DATA_DIR%\agent-python" --python 3.11
    ↓
使用 + 记录到 memory（用户环境类型 = hiyori-uv）
```

---

## 用户环境概况（当前机器）

- 包管理器：Anaconda（conda）
- Anaconda 路径：`D:\Software\anaconda3`
- 常用环境：`base`（默认）、`sharp`（图像处理）

---

## conda 常用操作

```powershell
# 列出环境
conda env list

# 在指定环境执行（推荐 conda run，不要用 activate）
conda run -n sharp python script.py
conda run -n base python -c "print('hello')"

# 查看已装包
conda run -n sharp pip list

# 安装包
conda run -n sharp pip install 包名
conda install -n sharp 包名 -y
```

> **推荐 `conda run -n 环境名 命令`，不要用 `activate`**，因为 activate 在 run_command 的子进程中不持久。

---

## pip 操作（系统 Python）

```powershell
pip list
pip show 包名
pip install 包名
pip install --upgrade 包名
```

---

## 注意事项

- uv 创建的 agent-python 环境是**持久的**，和应用数据放在一起，升级不丢失
- 第一次 uv 创建环境时会下载 Python（约 30MB），后续缓存复用
- 安装包时记得确认装到了正确的环境（用户环境 or agent-python）
