/**
 * Live2D 主进程桥
 *
 * 职责：
 *   - 持有 BrowserWindow 引用
 *   - 提供 sendLive2DCommand() 供工具调用
 *   - 定义 Live2DCommand 联合类型（主→渲染）
 */

import { BrowserWindow } from 'electron';

// ── 命令类型定义 ─────────────────────────────────────────────────

/** 情绪命令：设置情绪（自动映射到参数 + 可选动作） */
export interface Live2DCmdEmotion {
  type: 'emotion';
  /** 情绪名 */
  emotion: 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking' | 'shy' | 'embarrassed';
  /** 持续时间（ms），0 = 永久直到下次情绪切换 */
  durationMs?: number;
  /** 是否同时播放对应动作 */
  playMotion?: boolean;
}

/** 动作命令：直接触发模型动作组 */
export interface Live2DCmdMotion {
  type: 'motion';
  /** 动作组名，如 'Idle', 'TapBody', 'Flick', 'Tap' */
  group: string;
  /** 组内序号（不填则随机） */
  no?: number;
  /** 优先级：0=无, 1=idle, 2=normal, 3=force */
  priority?: number;
}

/** 参数命令：直接设置 Live2D 模型参数值（高级用法） */
export interface Live2DCmdParam {
  type: 'param';
  /** 参数 ID，如 'ParamMouthForm', 'ParamCheek' */
  parameterId: string;
  /** 目标值 */
  value: number;
  /** 过渡时间（ms），0 = 立即 */
  transitionMs?: number;
}

/** 查询命令：获取当前状态 */
export interface Live2DCmdQuery {
  type: 'query';
}

export type Live2DCommand = Live2DCmdEmotion | Live2DCmdMotion | Live2DCmdParam | Live2DCmdQuery;

// ── Bridge 状态 ──────────────────────────────────────────────────

let _mainWin: BrowserWindow | null = null;

export function initLive2DBridge(win: BrowserWindow): void {
  _mainWin = win;
}

/**
 * 向渲染进程发送 Live2D 控制命令。
 * 工具（manageLive2d）通过此函数驱动 Live2D 模型。
 */
export function sendLive2DCommand(cmd: Live2DCommand): boolean {
  const win = _mainWin ?? BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return false;
  }
  win.webContents.send('live2d:cmd', cmd);
  return true;
}
