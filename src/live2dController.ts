/**
 * Live2D 渲染进程控制器
 *
 * 职责：
 *   - 监听主进程 IPC `live2d:cmd`
 *   - 将命令路由到 LAppModel（情绪参数、动作触发、直接参数控制）
 *   - 自动情绪标签解析（[emotion:xxx] from AI text）
 *
 * 使用：在 src/main.ts 中调用 initLive2DController()。
 */

import { LAppDelegate } from './lappdelegate';
import { EMOTION_PRESETS } from './lappmodel';
import * as LAppDefine from './lappdefine';

// ── 获取当前模型实例 ──────────────────────────────────────────────

function getModel() {
  const delegate = LAppDelegate.getInstance();
  const sub = delegate.getFirstSubdelegate();
  if (!sub) return null;
  return sub.getLive2DManager().getFirstModel();
}

// ── 情绪 → 动作映射（Hiyori_pro 可用的动作组）────────────────────

const EMOTION_TO_MOTION: Record<string, { group: string; no?: number }> = {
  happy:       { group: 'Tap',       no: 0 },
  surprised:   { group: 'Flick',     no: 0 },
  sad:         { group: 'FlickDown', no: 0 },
  angry:       { group: 'FlickUp',   no: 0 },
  shy:         { group: 'Tap@Body',  no: 0 },
  embarrassed: { group: 'Tap@Body',  no: 0 },
  thinking:    { group: 'Idle' },
  neutral:     { group: 'Idle' },
};

// ── 命令处理 ──────────────────────────────────────────────────────

function handleCommand(cmd: { type: string; [key: string]: unknown }): void {
  switch (cmd.type) {
    case 'emotion': {
      const emotion = (cmd.emotion as string) ?? 'neutral';
      const durationMs = (cmd.durationMs as number) ?? 0;
      const playMotion = (cmd.playMotion as boolean) ?? true;
      const params = EMOTION_PRESETS[emotion] ?? EMOTION_PRESETS.neutral;

      const model = getModel();
      if (model) {
        model.setEmotionParams(params, 300, durationMs);
      }

      if (playMotion) {
        const motionInfo = EMOTION_TO_MOTION[emotion];
        if (motionInfo && model) {
          const no = motionInfo.no ?? -1;
          if (no < 0) {
            model.startRandomMotion(motionInfo.group, LAppDefine.PriorityNormal);
          } else {
            model.startMotion(motionInfo.group, no, LAppDefine.PriorityNormal);
          }
        }
      }
      break;
    }

    case 'motion': {
      const group = (cmd.group as string);
      const no = cmd.no as number | undefined;
      const priority = (cmd.priority as number) ?? LAppDefine.PriorityNormal;
      const model = getModel();
      if (!model || !group) break;
      if (no !== undefined && no >= 0) {
        model.startMotion(group, no, priority);
      } else {
        model.startRandomMotion(group, priority);
      }
      break;
    }

    case 'param': {
      const parameterId = cmd.parameterId as string;
      const value = cmd.value as number;
      const model = getModel();
      if (!model || !parameterId || value === undefined) break;
      model.setParameterDirect(parameterId, value);
      break;
    }

    case 'query':
      // 未来可通过另一个 IPC 回传状态，目前仅记录
      console.log('[Live2D] query received, model:', !!getModel());
      break;

    default:
      console.warn('[Live2D] unknown cmd type:', cmd.type);
  }
}

// ── 情绪标签自动解析 ─────────────────────────────────────────────

/** 从 AI 回复文本中提取并消费情绪标签，返回净化后的文本 */
export function extractEmotionTag(text: string): { emotion: string | null; cleaned: string } {
  // 匹配 [emotion:xxx] 或 [情绪:xxx]（宽松匹配，忽略大小写）
  const match = text.match(/\[(?:emotion|情绪)\s*:\s*([a-z_\u4e00-\u9fa5]+)\]/i);
  if (!match) return { emotion: null, cleaned: text };

  const raw = match[1].toLowerCase().trim();
  // 中文映射
  const ZH_MAP: Record<string, string> = {
    开心: 'happy', 高兴: 'happy', 快乐: 'happy',
    难过: 'sad', 伤心: 'sad', 悲伤: 'sad',
    生气: 'angry', 愤怒: 'angry',
    惊讶: 'surprised', 惊喜: 'surprised',
    思考: 'thinking', 想想: 'thinking',
    害羞: 'shy', 尴尬: 'embarrassed',
    平静: 'neutral', 普通: 'neutral',
  };

  const emotion = ZH_MAP[raw] ?? (EMOTION_PRESETS[raw] ? raw : null);
  const cleaned = text.replace(match[0], '').trim();
  return { emotion, cleaned };
}

/** 触发情绪效果（可在 chat.ts 中解析到 emotion 后调用） */
export function triggerEmotion(emotion: string, durationMs = 0, playMotion = true): void {
  handleCommand({ type: 'emotion', emotion, durationMs, playMotion });
}

// ── 初始化：注册 IPC 监听器 ───────────────────────────────────────

let _initialized = false;

export function initLive2DController(): void {
  if (_initialized) return;
  _initialized = true;

  // 使用 preload 暴露的 live2dAPI
  const api = (window as any).live2dAPI as {
    onCommand?: (cb: (cmd: Record<string, unknown>) => void) => (() => void);
  } | undefined;

  if (!api?.onCommand) {
    console.warn('[Live2DController] live2dAPI.onCommand 未找到，Live2D IPC 控制不可用');
    return;
  }

  api.onCommand((cmd) => {
    try {
      handleCommand(cmd as { type: string; [key: string]: unknown });
    } catch (e) {
      console.error('[Live2DController] 命令处理失败:', e, cmd);
    }
  });

  console.log('[Live2DController] 已初始化，等待 Live2D 命令');
}
