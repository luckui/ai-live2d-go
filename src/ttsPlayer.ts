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
    return LAppDelegate.getInstance().getFirstSubdelegate()?.getLive2DManager().getFirstModel() ?? null;
  } catch {
    return null;
  }
}

// ── 文本预处理：去除对 TTS 无意义的符号、表情、动作描述 ────────

/** Unicode Emoji：使用 Unicode 属性转义，覆盖所有 emoji（含变体序列和 ZWJ 组合） */
const RE_EMOJI = /\p{Extended_Pictographic}[\u{FE0F}\u{FE0E}\u{200D}\u{20E3}\p{Extended_Pictographic}]*/gu;

/** 颜文字：由常见颜文字构成字符连续出现 3 个以上，避免误伤正常标点 */
const RE_KAOMOJI = /[（()）≧≦∇OwO><;:XDd^_=+\-~·°▽○●□■♡♥★☆♪♫◇◆]{3,}/g;

function cleanForTTS(text: string): string {
  return text
    // ── 1. 去除各种括号内的动作/表情/旁白描述 ──
    .replace(/（[^（）]*）/g, '')              // 全角括号：（微笑）
    .replace(/\([^()]*\)/g, '')               // 半角括号：(smiles)
    .replace(/【[^【】]*】/g, '')              // 方头括号：【动作】
    .replace(/「[^「」]*」/g, '')              // 日式引号：「旁白」
    .replace(/『[^『』]*』/g, '')              // 日式双引号：『心想』
    .replace(/〈[^〈〉]*〉/g, '')              // 尖括号：〈动作描述〉
    .replace(/《[^《》]*》/g, '')              // 书名号：《偶尔用作描述》

    // ── 2. 去除星号包裹的动作描述（AI 常用格式） ──
    .replace(/\*[^*\n]{1,30}\*/g, '')         // *叹了口气* *微笑*（限 30 字防误删段落）

    // ── 3. Markdown 语法 → 纯文本 ──
    .replace(/\*\*(.+?)\*\*/g, '$1')          // **粗体**
    .replace(/\*(.+?)\*/g, '$1')              // *斜体*（上一步已删动作，剩余的是格式）
    .replace(/`{1,3}[\s\S]*?`{1,3}/g, '')    // `代码` / ```代码块```
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [链接](url) → 保留文字
    .replace(/^#{1,6}\s/gm, '')              // # 标题
    .replace(/^[-*+]\s/gm, '')               // 列表符号
    .replace(/^>\s?/gm, '')                  // 引用符号
    .replace(/[_~|]/g, '')                   // 剩余 markdown 装饰符

    // ── 4. Emoji + 颜文字 + 特殊符号 → 逗号（避免删除后前后文黏连） ──
    .replace(RE_EMOJI, '，')                   // 🎉😊 → 逗号分隔
    .replace(RE_KAOMOJI, '，')                 // ≧∇≦  OwO  ^_^
    .replace(/[♪♫♬♩★☆✦✧❤♡♥❥◇◆○●□■△▽→←↑↓↔]/g, '') // 散落的装饰符号直接删

    // ── 5. 清理多余逗号和空白 ──
    .replace(/[，,]{2,}/g, '，')               // 连续多个逗号合并
    .replace(/([。！？!?…])，/g, '$1')          // 句末标点后的多余逗号
    .replace(/，([。！？!?…])/g, '$1')          // 句末标点前的多余逗号
    .replace(/^\s*[，,]\s*/g, '')              // 开头的逗号
    .replace(/\s*[，,]\s*$/g, '')              // 结尾的逗号
    .replace(/\s+/g, ' ')
    .trim();
}

// ── 句子切分 ─────────────────────────────────────────────────────

/** 单次并发请求上限，避免短文本产生过多分片 */
const MAX_SEGMENTS = 8;

/**
 * 按句末标点（。！？!?…）切分句子，保留标点在句尾。
 * 过短的碎片会合并到下一段，切分结果不超过 MAX_SEGMENTS 条。
 *
 * 英文句末 ". "（后接大写字母/汉字）也视为句子边界，但排除 2 字母以内的缩写
 * （Mr. Dr. e.g. i.e. U.S. 等），避免误切。
 */
function splitSentences(text: string): string[] {
  // 把英文句末 ". " + 大写 / CJK 规范化为中文句号，便于后续统一切分
  // \w{3,} 排除 Mr./Dr./e.g. 等缩写（结尾单词 < 3 字符）
  const normalized = text
    .replace(/(?<=\w{3,})\.\s+(?=[A-Z\u4e00-\u9fa5\u3040-\u30ff])/g, '。')
    // 英文 ! / ? 后跟空格 + 大写（避免句号规范化破坏已有感叹/问号切分）
    .replace(/([!?])\s+(?=[A-Z\u4e00-\u9fa5])/g, '$1 ');

  const raw = normalized.split(/(?<=[。！？!?…]+)\s*/);
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

// ── WebAudio 共享 AudioContext + 实时口型 ─────────────────────────

let _audioCtx: AudioContext | null = null;
let _rafId: number | null = null;

function getAudioContext(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new AudioContext();
  }
  return _audioCtx;
}

function stopLipSync(): void {
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  (window as any)._live2dMouthOpen = 0;
}

/**
 * 通过 WebAudio AnalyserNode 播放 AudioBuffer，同时实时驱动 Live2D 口型。
 * 返回 Promise，在音频播放结束时 resolve。
 */
function playBufferWithLipSync(audioBuffer: AudioBuffer): Promise<void> {
  return new Promise<void>((resolve) => {
    const ctx = getAudioContext();

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const dataArray = new Uint8Array(analyser.fftSize);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyser);
    analyser.connect(ctx.destination);

    // 实时读取 RMS，写入 window._live2dMouthOpen
    const loop = (): void => {
      analyser.getByteTimeDomainData(dataArray);
      let sumSq = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const norm = (dataArray[i] - 128) / 128; // [-1, 1]
        sumSq += norm * norm;
      }
      const rms = Math.sqrt(sumSq / dataArray.length);
      // 放大并鈓制到 [0, 1]，中文 TTS 音频振幅偶尔较小，提高系数确保口型明显
      (window as any)._live2dMouthOpen = Math.min(1, rms * 10);
      _rafId = requestAnimationFrame(loop);
    };

    source.onended = () => {
      stopLipSync();
      resolve();
    };

    source.start();
    _rafId = requestAnimationFrame(loop);
  });
}

export async function playTTS(text: string, onDuration?: (ms: number) => void): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ttsAPI = (window as any).ttsAPI as TtsAPI | undefined;
  if (!ttsAPI) {
    console.warn('[TTS] 跳过：window.ttsAPI 未注入（preload 未包含？）');
    return;
  }

  // 前置检查：TTS 未启用时静默返回，不发起任何 IPC 请求
  const enabled = await ttsAPI.isEnabled();
  if (!enabled) return;

  const cleaned = cleanForTTS(text);
  if (!cleaned) {
    console.warn('[TTS] 跳过：清洗后文本为空');
    return;
  }

  // 递增世代，取消上一次未完成的播放队列；同时停止正在播放的音频
  const gen = ++_playGeneration;
  const model = getLiveModel();
  model?._wavFileHandler.stop();
  model?.setSpeaking(false); // 重置上一次的讲话状态
  stopLipSync();

  const sentences = splitSentences(cleaned);
  console.log(`[TTS] 切分为 ${sentences.length} 句:`, sentences);

  // 进入讲话状态：立即触发 Tap 动作，退出 Idle 循环
  getLiveModel()?.setSpeaking(true);

  // ① 并发发起全部句子的 TTS 请求
  const requests = sentences.map(s => ttsAPI.speak(s));

  // ② 并发解码全部音频 buffer，提前计算总时长
  const audioCtx = getAudioContext();
  const audioBuffers: (AudioBuffer | null)[] = await Promise.all(
    requests.map(async (req) => {
      try {
        const result = await req;
        if (!result?.data) return null;
        const buf = base64ToBuffer(result.data);
        return await audioCtx.decodeAudioData(buf.slice(0));
      } catch {
        return null;
      }
    })
  );

  // 通知调用方实际总时长（毫秒）；totalMs=0 时也通知（服务器宕机时让调用方降级处理）
  if (onDuration) {
    const totalMs = Math.round(audioBuffers.reduce((s, b) => s + (b?.duration ?? 0), 0) * 1000);
    onDuration(totalMs);
  }

  // ③ 顺序播放
  for (let i = 0; i < audioBuffers.length; i++) {
    if (gen !== _playGeneration) {
      console.log('[TTS] 队列已被新请求取消，停止播放');
      stopLipSync();
      getLiveModel()?.setSpeaking(false);
      return;
    }

    const audioBuffer = audioBuffers[i];
    if (!audioBuffer) {
      console.warn(`[TTS] 第 ${i + 1} 句 buffer 为空，跳过`);
      continue;
    }

    console.log(`[TTS] 第 ${i + 1}/${audioBuffers.length} 句开始播放，时长:`, audioBuffer.duration.toFixed(2), 's');

    try {
      await playBufferWithLipSync(audioBuffer);
    } catch (e) {
      console.warn(`[TTS] 第 ${i + 1} 句 WebAudio 播放失败:`, e);
    }

    console.log(`[TTS] 第 ${i + 1} 句播放完毕`);
  }

  // 所有句子播放完毕，退出讲话状态，自然回归 Idle
  stopLipSync();
  getLiveModel()?.setSpeaking(false);
  console.log('[TTS] 全部句子播放完成');
}
