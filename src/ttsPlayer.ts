/**
 * TTS 播放器（渲染进程）
 *
 * 职责：
 *   1. 调用 Electron IPC（ttsAPI.speak）获取 base64 WAV 音频
 *   2. 解码后交给 LAppModel._wavFileHandler.startFromBuffer() 播放 + 口型同步
 *   3. 按句子切分文本，并发发起所有请求，顺序播放——流水线策略降低感知延迟
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

// ── 句子切分 ─────────────────────────────────────────────────────

/** 单次并发请求上限，避免短文本产生过多分片 */
const MAX_SEGMENTS = 8;

/**
 * 按句末标点（。！？!?…）切分句子，保留标点在句尾。
 * 过短的碎片会合并到下一段，切分结果不超过 MAX_SEGMENTS 条。
 */
function splitSentences(text: string): string[] {
  const raw = text.split(/(?<=[。！？!?…]+\s*)/);
  const result: string[] = [];
  let buffer = '';
  for (const part of raw) {
    buffer += part;
    // 积累到至少 6 个字符才独立成句，避免切出过短碎片
    if (buffer.trim().length >= 6) {
      result.push(buffer.trim());
      buffer = '';
    }
  }
  if (buffer.trim()) result.push(buffer.trim());

  // 超出上限时，把尾部多余项合并成一句
  if (result.length > MAX_SEGMENTS) {
    const merged = [...result.slice(0, MAX_SEGMENTS - 1), result.slice(MAX_SEGMENTS - 1).join('')];
    return merged;
  }
  return result.filter(s => s.length > 0);
}

// ── base64 → ArrayBuffer ─────────────────────────────────────────

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ── 播放世代：新调用时取消上一次未完成的队列 ──────────────────────

let _playGeneration = 0;

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

  // 递增世代，取消上一次未完成的播放队列；同时停止正在播放的音频
  const gen = ++_playGeneration;
  getLiveModel()?._wavFileHandler.stop();

  const sentences = splitSentences(cleaned);
  console.log(`[TTS] 切分为 ${sentences.length} 句:`, sentences);

  // ① 并发发起全部句子的 TTS 请求（流水线：请求第 N 句时第 N-1 句正在播放）
  const requests = sentences.map(s => ttsAPI.speak(s));

  // ② 顺序等待并播放
  for (let i = 0; i < requests.length; i++) {
    if (gen !== _playGeneration) {
      console.log('[TTS] 队列已被新请求取消，停止播放');
      return;
    }

    let result: { data: string } | null;
    try {
      result = await requests[i];
    } catch (e) {
      console.warn(`[TTS] 第 ${i + 1} 句 speak 异常:`, e);
      continue;
    }
    if (!result?.data) {
      console.warn(`[TTS] 第 ${i + 1} 句返回 null，跳过`);
      continue;
    }

    if (gen !== _playGeneration) return;

    let buffer: ArrayBuffer;
    try {
      buffer = base64ToBuffer(result.data);
    } catch (e) {
      console.warn(`[TTS] 第 ${i + 1} 句 base64 解码失败:`, e);
      continue;
    }

    const model = getLiveModel();
    if (!model) {
      console.warn('[TTS] 跳过：Live2D 模型未就绪');
      return;
    }

    console.log(`[TTS] 第 ${i + 1}/${sentences.length} 句开始播放，字节:`, buffer.byteLength);
    await model._wavFileHandler.startFromBuffer(buffer);
    await model._wavFileHandler.waitUntilEnd();
    console.log(`[TTS] 第 ${i + 1} 句播放完毕`);
  }

  console.log('[TTS] 全部句子播放完成');
}
