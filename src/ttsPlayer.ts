/**
 * TTS 播放器（渲染进程）
 *
 * 职责：
 *   1. 调用 Electron IPC（ttsAPI.speak）获取 base64 WAV 音频
 *   2. 解码后交给 LAppModel._wavFileHandler.startFromBuffer() 播放 + 口型同步
 *
 * 用法：收到 AI 回复文本后调用 playTTS(text)
 */

import { LAppDelegate } from './lappdelegate';
import type { LAppModel } from './lappmodel';

// ── 获取当前 Live2D 模型实例 ───────────────────────────────────────

function getLiveModel(): LAppModel | null {
  try {
    const delegate = LAppDelegate.getInstance();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = (delegate as any)._subdelegates?.at(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (sub?.getLive2DManager() as any)?._models?.at(0) ?? null;
  } catch {
    return null;
  }
}

// ── 文本预处理：去除对 TTS 无意义的 Markdown 符号 ────────────────

function cleanForTTS(text: string): string {
  return text
    // 过滤括号内的动作/表情描述：(xxx)（xxx）
    .replace(/（[^（）]*）/g, '')              // 全角括号
    .replace(/\([^()]*\)/g, '')               // 半角括号
    .replace(/\*\*(.+?)\*\*/g, '$1')          // **粗体**
    .replace(/\*(.+?)\*/g, '$1')              // *斜体*
    .replace(/`{1,3}[\s\S]*?`{1,3}/g, '')    // `代码` / ```代码块```
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [链接](url)
    .replace(/^#{1,6}\s/gm, '')              // # 标题
    .replace(/[>\-_~|]/g, ' ')               // 其他 markdown 符号
    // 过滤常见颜文字
    .replace(/[\(\)（）≧∇≦OwO><;:XD^_^\-~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── 主入口 ───────────────────────────────────────────────────────

type TtsAPI = {
  isEnabled(): Promise<boolean>;
  speak(text: string): Promise<{ data: string } | null>;
};

export async function playTTS(text: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ttsAPI = (window as any).ttsAPI as TtsAPI | undefined;
  if (!ttsAPI) {
    console.warn('[TTS] 跳过：window.ttsAPI 未注入（preload 未包含？）');
    return;
  }

  const cleaned = cleanForTTS(text);
  if (!cleaned) {
    console.warn('[TTS] 跳过：清洗后文本为空');
    return;
  }
  console.log('[TTS] 开始合成：', cleaned.slice(0, 60));

  let result: { data: string } | null;
  try {
    result = await ttsAPI.speak(cleaned);
  } catch (e) {
    console.warn('[TTS] speak IPC 调用异常:', e);
    return;
  }
  if (!result?.data) {
    console.warn('[TTS] speak 返回为 null（TTS 未启用或服务异常）');
    return;
  }
  console.log('[TTS] 收到 base64 WAV，大小：', result.data.length, 'chars');

  // base64 → ArrayBuffer
  let buffer: ArrayBuffer;
  try {
    const binary = atob(result.data);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    buffer = bytes.buffer;
    console.log('[TTS] 解码成功，字节数：', buffer.byteLength);
  } catch (e) {
    console.warn('[TTS] base64 解码失败:', e);
    return;
  }

  const model = getLiveModel();
  if (!model) {
    console.warn('[TTS] 跳过：Live2D 模型未就绪（音频已获取但无法播放）');
    return;
  }

  console.log('[TTS] 开始播放，调用 startFromBuffer...');
  await model._wavFileHandler.startFromBuffer(buffer);
  console.log('[TTS] startFromBuffer 完成（音频已送入 AudioContext）');
}
