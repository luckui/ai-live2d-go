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
export const ResourcesPath = '/Resources/';

// 不使用背景图和按钮图
export const BackImageName = '';
export const GearImageName = '';
export const PowerImageName = '';

// 只使用 Hiyori 模型
export const ModelDir: string[] = ['Hiyori'];
export const ModelDirSize: number = ModelDir.length;

// 动作组名（与 model3.json 对应）
export const MotionGroupIdle = 'Idle';
export const MotionGroupTapBody = 'TapBody';

// 碰撞区域名（与 model3.json 对应）
export const HitAreaNameHead = 'Head';
export const HitAreaNameBody = 'Body';

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
export const CubismLoggingLevel: LogLevel = LogLevel.LogLevel_Verbose;
