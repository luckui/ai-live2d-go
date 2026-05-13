---
name: bilibili-live
description: B站直播连接、弹幕处理与互动回复的完整工作流程，包含启动、监控和关闭步骤
version: 1.0.0
---

# B站直播管理工作流

管理 B站直播连接、弹幕接收与 AI 互动回复的标准操作流程。

## 工具对应关系

| 操作 | 工具 |
|------|------|
| 启动/停止直播监控 | `watch_bilibili_video` |
| 管理 TTS 语音 | `manage_tts` |
| 管理听觉（语音识别） | `manage_hearing` |

## 标准工作流

### 1. 启动直播连接

```
watch_bilibili_video(action="start", url="https://live.bilibili.com/<房间号>")
```

- `url` 支持直播间 URL 或 BV/AV 号
- 成功后 AI 开始自动处理弹幕并生成互动回复

### 2. 检查当前状态

```
watch_bilibili_video(action="status")
```

返回当前连接状态、已处理弹幕数等。

### 3. 停止直播连接

```
watch_bilibili_video(action="stop")
```

安全停止所有连接，保存统计数据。

## TTS 与听觉管理

### 启用/禁用 TTS

```
manage_tts(action="enable")   # 开启语音播报
manage_tts(action="disable")  # 关闭语音播报
manage_tts(action="status")   # 查看当前状态
```

### 听觉（语音识别）

```
manage_hearing(action="start")   # 开启麦克风监听
manage_hearing(action="stop")    # 停止监听
manage_hearing(action="status")  # 查看状态
```

## 注意事项

- 直播连接期间 TTS 和语音识别会自动协调（TTS 播放时暂停识别，避免自说自话）
- 直播超时或网络中断会自动重连（最多 3 次）
- 弹幕回复频率受 `config.yaml` 中的 `replyInterval` 控制
