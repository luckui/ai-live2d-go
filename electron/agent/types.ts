/**
 * Agent 模式核心类型定义
 *
 * 设计原则：类型扁平化，Phase 2 扩展时只需添加可选字段，不破坏现有结构。
 */

// ── 任务规划 ─────────────────────────────────────────────

export interface AtomicStep {
  /** 唯一步骤 ID，如 "step_1" */
  id: string;
  /** 用户可见的步骤描述（中文简短说明） */
  description: string;
  /** 给 Executor AI 的精确执行指令（越详细越好，假设执行者不了解背景） */
  instruction: string;
  /** 给 Verifier 的验证标准：截图里应该看到什么才算成功 */
  expectedOutcome: string;
  /** 提示 Executor 可能用到的工具名称 */
  toolHints?: string[];
  /** 该步最多重试几次，默认 2 */
  retryLimit?: number;
}

export interface TaskPlan {
  /** 用户原始目标描述 */
  goal: string;
  /** 按顺序执行的原子步骤列表 */
  steps: AtomicStep[];
  /** 计划创建时间戳（毫秒） */
  createdAt: number;
}

// ── 执行状态 ─────────────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface StepResult {
  stepId: string;
  status: StepStatus;
  /** Executor AI 最后一次回复的文字摘要 */
  evidence: string;
  /** Verifier 的验证结论 */
  verifierJudgement: 'pass' | 'fail' | 'uncertain';
  /** Verifier 的判断理由（含截图分析） */
  verifierReason: string;
  /** 本步已重试次数 */
  retryCount: number;
}

export interface TaskSession {
  plan: TaskPlan;
  results: StepResult[];
  /** 当前正在执行的步骤序号（0-based） */
  currentStepIndex: number;
}
