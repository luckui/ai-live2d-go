/**
 * Orchestrator：Agent 模式的状态机核心
 *
 * 协调 Planner → Executor → Verifier 的完整执行流程：
 *   1. Planner 将目标分解为有序 AtomicStep 列表
 *   2. 逐步执行，每步由 Executor 完成工具调用循环
 *   3. 每步完成后 Verifier 截图验证结果（反幻觉）
 *   4. 验证失败时重试（直到 retryLimit），超限则停止并报告
 *   5. 全部完成后返回格式化执行报告
 *
 * 扩展接口（Phase 2 预留）：
 *   - onProgress 回调：每步完成后推送进度到渲染层（IPC）
 *   - timeoutMs：整体任务超时控制
 *   - 并行步骤支持：AtomicStep 加 dependsOn 字段后可拓扑排序并行执行
 */

import type { LLMProviderConfig } from '../ai.config';
import { createPlan, replanFromFailure } from './planner';
import { executeStep } from './executor';
import { verifyStep } from './verifier';
import type { TaskSession, StepResult } from './types';

// ── Phase 2 预留接口 ──────────────────────────────────────

/** 进度回调：每步状态变更时触发，可用于推送到渲染层 */
export type ProgressCallback = (session: Readonly<TaskSession>) => void;

export interface RunOptions {
  /** 进度回调（Phase 2：IPC 推送到 Live2D UI） */
  onProgress?: ProgressCallback;
  /** 整体任务超时（ms），默认 5 分钟 */
  timeoutMs?: number;
}

// ── 主入口 ────────────────────────────────────────────────

export async function runAgent(
  goal: string,
  provider: LLMProviderConfig,
  options: RunOptions = {},
): Promise<string> {
  const { onProgress, timeoutMs = 5 * 60 * 1000 } = options;
  const startTime = Date.now();

  // ── 1. Planning ──────────────────────────────────────
  let plan;
  try {
    plan = await createPlan(goal, provider);
  } catch (e) {
    return `❌ 任务规划失败：${(e as Error).message}`;
  }

  const session: TaskSession = {
    plan,
    results: plan.steps.map((s) => ({
      stepId:             s.id,
      status:             'pending',
      evidence:           '',
      verifierJudgement:  'uncertain',
      verifierReason:     '',
      retryCount:         0,
    })),
    currentStepIndex: 0,
  };
  onProgress?.(session);

  // ── 2. Execute & Verify ──────────────────────────────
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const result: StepResult = session.results[i];
    const retryLimit = step.retryLimit ?? 2;

    // 整体超时检查
    if (Date.now() - startTime > timeoutMs) {
      result.status = 'skipped';
      result.evidence = '（超出整体任务时间限制，已跳过）';
      continue;
    }

    result.status = 'running';
    session.currentStepIndex = i;
    onProgress?.(session);

    let verified = false;
    while (result.retryCount <= retryLimit) {
      // 执行
      try {
        result.evidence = await executeStep(step, provider);
      } catch (e) {
        result.evidence = `执行异常：${(e as Error).message}`;
      }

      // 验证
      const vr = await verifyStep(step.expectedOutcome, result.evidence, provider);
      result.verifierJudgement = vr.judgement;
      result.verifierReason    = vr.reason;

      if (vr.judgement === 'pass') {
        result.status = 'success';
        verified = true;
        break;
      }

      if (vr.judgement === 'uncertain') {
        // uncertain → Phase 1 保守策略：视为通过，继续下一步
        // Phase 2 可改为：暂停并询问用户是否继续
        result.status = 'success';
        result.evidence += `\n⚠️ 验证不确定：${vr.reason}`;
        verified = true;
        break;
      }

      // fail → 检查重试次数
      result.retryCount++;
      if (result.retryCount > retryLimit) break;
      // 重试：brief pause
      await new Promise(r => setTimeout(r, 800));
    }

    if (!verified) {
      result.status = 'failed';

      // ── 重规划：基于失败原因，让 Planner 生成补救步骤 ──
      const completedDescs = plan.steps
        .slice(0, i)
        .filter((_, idx) => session.results[idx].status === 'success')
        .map(s => s.description);

      let replanned = false;
      try {
        const newPlan = await replanFromFailure(
          plan.goal,
          provider,
          completedDescs,
          step.description,
          result.verifierReason || result.evidence.slice(0, 200),
        );

        if (newPlan.steps.length > 0) {
          // 追加补救步骤到当前 session（保留已有 results）
          const newResults = newPlan.steps.map(s => ({
            stepId:            s.id,
            status:            'pending' as const,
            evidence:          '',
            verifierJudgement: 'uncertain' as const,
            verifierReason:    '',
            retryCount:        0,
          }));
          plan.steps.push(...newPlan.steps);
          session.results.push(...newResults);
          replanned = true;
          console.log(`[Orchestrator] 重规划成功，追加 ${newPlan.steps.length} 个补救步骤`);
        }
      } catch (e) {
        console.warn('[Orchestrator] 重规划失败:', e);
      }

      if (!replanned) {
        // 重规划也失败 → 跳过剩余步骤并停止
        for (let j = i + 1; j < plan.steps.length; j++) {
          session.results[j].status   = 'skipped';
          session.results[j].evidence = `前序步骤「${step.description}」失败且重规划失败，已跳过`;
        }
        break;
      }
      // 重规划成功 → 继续循环（新步骤会在下一轮 i++ 后被执行）
    }

    onProgress?.(session);
  }

  return buildSummary(session);
}

// ── 执行报告生成 ──────────────────────────────────────────

function buildSummary(session: TaskSession): string {
  const { plan, results } = session;
  const successCount = results.filter(r => r.status === 'success').length;
  const failedResult  = results.find(r => r.status === 'failed');

  const stepLines = results.map((r, i) => {
    const step  = plan.steps[i];
    const icon  = r.status === 'success' ? '✅' : r.status === 'failed' ? '❌' : '⏭️';
    const retry = r.retryCount > 0 ? `（重试 ${r.retryCount} 次）` : '';
    return `${icon} ${step.description}${retry}`;
  });

  const lines = [
    `🎯 目标：${plan.goal}`,
    `📊 进度：${successCount}/${plan.steps.length} 步完成`,
    '',
    ...stepLines,
  ];

  if (failedResult) {
    const failedStep = plan.steps.find(s => s.id === failedResult.stepId);
    lines.push('', `⚠️ 卡住原因：${failedResult.verifierReason}`);
    lines.push(`💡 建议：手动检查「${failedStep?.description ?? failedResult.stepId}」步骤后重试`);
  } else if (successCount === plan.steps.length) {
    lines.push('', '🎉 所有步骤已完成！');
  }

  return lines.join('\n');
}
