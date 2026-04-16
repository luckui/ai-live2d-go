# 内嵌工具目录

本目录用于存放应用打包时需要的内嵌二进制工具。

## uv.exe

**用途**：Python 包管理器和虚拟环境工具，用于 TTS 引擎的自动安装和环境管理。

**版本要求**：v0.11.7 或更高

**下载方式**：

### 方法 1：直接下载（推荐）
```powershell
# 在项目根目录执行
Invoke-WebRequest -Uri "https://github.com/astral-sh/uv/releases/download/0.11.7/uv-x86_64-pc-windows-msvc.zip" -OutFile "uv.zip"
Expand-Archive -Path "uv.zip" -DestinationPath "tools" -Force
Move-Item -Path "tools/uv-x86_64-pc-windows-msvc.exe" -Destination "tools/uv.exe" -Force
Remove-Item "uv.zip"
```

### 方法 2：国内镜像（中国用户）
```powershell
# 使用 ghproxy 镜像加速
Invoke-WebRequest -Uri "https://mirror.ghproxy.com/https://github.com/astral-sh/uv/releases/download/0.11.7/uv-x86_64-pc-windows-msvc.zip" -OutFile "uv.zip"
Expand-Archive -Path "uv.zip" -DestinationPath "tools" -Force
Move-Item -Path "tools/uv-x86_64-pc-windows-msvc.exe" -Destination "tools/uv.exe" -Force
Remove-Item "uv.zip"
```

### 方法 3：手动下载
1. 访问 [uv Releases](https://github.com/astral-sh/uv/releases)
2. 下载 `uv-x86_64-pc-windows-msvc.zip` (v0.11.7)
3. 解压后将 `uv-x86_64-pc-windows-msvc.exe` 重命名为 `uv.exe`
4. 放置到本目录 (`tools/uv.exe`)

**验证安装**：
```powershell
.\tools\uv.exe --version
# 应输出: uv 0.11.7 或更高版本
```

## 注意事项

- `uv.exe` 约 68MB，已添加到 `.gitignore`，不会提交到仓库
- 应用打包时会通过 `package.json` 的 `extraResources` 配置自动包含此文件
- 首次构建或运行前请确保此文件存在
