# Local TTS Server

独立运行的轻量级语音合成服务，**不打包进 Electron 应用**。
用户按需安装启动，通过 HTTP API 与 live2d-pet 通信。

## 定位

- 这是一个**可选模块**，主应用没有它也能正常运行
- 用户可通过聊天室让 agent 帮忙安装启动
- 只需改 `.env` 中 `TTS_URL` 指向这个服务即可

## 安装 & 启动

```powershell
cd tts-server
.\install.ps1 install   # 创建 venv，安装依赖
.\install.ps1 start     # 启动服务
.\install.ps1 status    # 检查状态
.\install.ps1 stop      # 停止服务
```

## 接入 live2d-pet

在 `.env` 中设置：

```env
TTS_ENABLED=true
TTS_URL=http://127.0.0.1:9880
TTS_SPEAKER=xiaoxiao
```

就这样，不需要其他配置。`TTS_URL` 指向哪里就用哪里的 TTS，
不管是这个本地服务还是远程服务器，`ttsService.ts` 不关心。

## API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/tts/generate` | POST | `{ text, speaker, language }` → 音频流 |
| `/speakers` | GET | 可用音色列表 |
| `/health` | GET | 健康检查 |

## 当前引擎: edge-tts

- 零配置，无需 API Key，无需下载模型
- Microsoft Edge 神经网络语音，300+ 音色
- 需联网

常用音色: `xiaoxiao` `xiaoyi` `yunxi` `jenny` `nanami`

## 后续扩展

MOSS-TTS 等本地离线引擎待独立验证可用后再作为可选引擎接入。
引擎扩展只需在 `engines/` 下新增实现 `TTSEngine` 接口的文件。
