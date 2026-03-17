/**
 * Live2D Desktop Pet - 常量定义
 * 基于 CubismSdkForWeb Demo 修改，仅保留 Hiyori 模型，透明背景
 */

import { LogLevel } from '@framework/live2dcubismframework';

// Canvas 大小（auto = 跟随容器）
export const CanvasSize: { width: number; height: number } | 'auto' = 'auto';
export const CanvasNum = 1;

// 视图参数
export const ViewScale = 1.0;
export const ViewMaxScale = 2.0;
export const ViewMinScale = 0.8;

export const ViewLogicalLeft = -1.0;
export const ViewLogicalRight = 1.0;
export const ViewLogicalBottom = -1.0;
export const ViewLogicalTop = 1.0;

export const ViewLogicalMaxLeft = -2.0;
export const ViewLogicalMaxRight = 2.0;
export const ViewLogicalMaxBottom = -2.0;
export const ViewLogicalMaxTop = 2.0;

// 资源路径（Vite publicDir = public/，里面有 Resources/ Junction）
// 打包后由 src/main.ts 动态覆盖为 file:// 绝对路径
export let ResourcesPath = '/Resources/';
export function setResourcesPath(path: string): void {
  ResourcesPath = path;
};

// 不使用背景图和按钮图
export const BackImageName = '';
export const GearImageName = '';
export const PowerImageName = '';

// ── 可扩展的模型配置 ──────────────────────────────────────────────
export interface ModelConfig {
  /** Resources/ 下的子目录名 */
  dir: string;
  /** .model3.json 文件名 */
  jsonName: string;
  // 动作组名（'' 表示该模型无此组）
  motionIdle: string;
  motionTap: string;
  motionTapBody: string;
  motionFlick: string;
  motionFlickUp: string;
  motionFlickDown: string;
  motionFlickBody: string;
  // 碰撞区域名（'' 表示该模型无此区域）
  hitHead: string;
  hitBody: string;
}

export const Models: ModelConfig[] = [
  {
    dir: 'Hiyori_pro',
    jsonName: 'hiyori_pro_t11.model3.json',
    motionIdle: 'Idle',
    motionTap: 'Tap',
    motionTapBody: 'Tap@Body',
    motionFlick: 'Flick',
    motionFlickUp: 'FlickUp',
    motionFlickDown: 'FlickDown',
    motionFlickBody: 'Flick@Body',
    hitHead: '',      // Hiyori_pro 无 Head 碰撞区
    hitBody: 'Body',
  },
];

// 供 LAppModel 内部 idle 循环默认使用（实例可通过 setIdleGroup 覆盖）
export const MotionGroupIdle = Models[0].motionIdle;

// Flick 判定阈值（视图空间单位），超过此值视为划动而非点击
export const FlickThreshold = 0.15;

// 动作优先级
export const PriorityNone = 0;
export const PriorityIdle = 1;
export const PriorityNormal = 2;
export const PriorityForce = 3;

// MOC3 完整性验证
export const MOCConsistencyValidationEnable = true;
export const MotionConsistencyValidationEnable = true;

// 调试日志
export const DebugLogEnable = false;
export const DebugTouchLogEnable = false;
export const CubismLoggingLevel: LogLevel = LogLevel.LogLevel_Warning;
