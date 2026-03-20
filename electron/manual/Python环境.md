# Python环境

本机 Python 环境管理规范，适用于 run_command 工具调用。

---

## 环境概况

- 包管理器：Anaconda（conda）
- Anaconda 路径：`D:\Software\anaconda3`
- 常用环境：`base`（默认）、`sharp`（图像处理）

---

## conda 常用操作

### 列出所有环境
```powershell
conda env list
```

### 激活环境
```powershell
conda activate sharp
```
> 注意：在 run_command 中激活后立即执行命令，需在同一行用 `&&` 或分号连接：
> ```powershell
> conda run -n sharp python -c "import cv2; print(cv2.__version__)"
> ```
> **推荐用 `conda run -n 环境名 命令` 而不是 `activate`，因为 activate 在子进程中不持久。**

### 在指定环境中执行 Python
```powershell
conda run -n sharp python script.py
conda run -n base python -c "print('hello')"
```

### 查看环境已安装包
```powershell
conda run -n sharp pip list
conda run -n sharp conda list
```

### 安装包到指定环境
```powershell
conda run -n sharp pip install 包名
conda install -n sharp 包名 -y
```

---

## pip 操作

### 查看已安装包
```powershell
pip list
pip show 包名
```

### 安装/升级
```powershell
pip install 包名
pip install --upgrade 包名
pip install -r requirements.txt
```

---

## 常见问题

### python 命令找不到
原因：PATH 未包含当前激活环境。
解法：使用完整路径 `D:\Software\anaconda3\python.exe` 或 `conda run -n base python`。

### import 报错 ModuleNotFoundError
原因：包未安装在当前环境。
解法：确认用对了环境，用 `conda run -n 环境名 pip install 包名` 安装。
