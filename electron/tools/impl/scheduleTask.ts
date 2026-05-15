/**
 * schedule_task — 定时任务管理工具
 *
 * 让 AI 能够创建/管理定时任务。定时任务到期时自动创建后台任务执行。
 *
 * 场景示例：
 *   - 用户："每天早上9点检查B站关注列表有没有新视频"
 *     AI 调用 schedule_task create → 定时调度 → 到期自动执行
 *   - 用户："30分钟后提醒我开会"
 *     AI 调用 schedule_task create → 一次性调度 → 到期通知
 */

import type { ToolDefinition } from '../types';
import { taskScheduler } from '../../taskScheduler';
import type { DBSchedule } from '../../db';

interface ScheduleTaskParams {
  action: 'create' | 'list' | 'pause' | 'resume' | 'remove' | 'trigger';
  title?: string;
  prompt?: string;
  schedule?: string;
  repeat_limit?: number;
  toolsets?: string[];
  schedule_id?: string;
}

function formatSchedule(s: DBSchedule): string {
  const enabledText = s.enabled ? '✅ 启用' : '⏸️ 暂停';
  const typeMap: Record<string, string> = {
    once: '⏰ 一次性',
    interval: '🔁 循环',
    cron: '📅 Cron',
  };
  const typeText = typeMap[s.schedule_type] ?? s.schedule_type;

  let scheduleDesc = '';
  if (s.schedule_type === 'once' && s.run_at) {
    scheduleDesc = `执行于 ${new Date(s.run_at).toLocaleString('zh-CN')}`;
  } else if (s.schedule_type === 'interval' && s.interval_ms) {
    const minutes = Math.round(s.interval_ms / 60_000);
    scheduleDesc = minutes >= 60
      ? `每 ${Math.round(minutes / 60)} 小时`
      : `每 ${minutes} 分钟`;
  } else if (s.schedule_type === 'cron' && s.cron_expr) {
    scheduleDesc = `cron: ${s.cron_expr}`;
  }

  const nextRun = s.next_run_at ? `\n   下次执行: ${new Date(s.next_run_at).toLocaleString('zh-CN')}` : '';
  const lastRun = s.last_run_at ? `\n   上次执行: ${new Date(s.last_run_at).toLocaleString('zh-CN')}` : '';
  const repeatInfo = s.repeat_limit !== null ? `\n   已执行: ${s.repeat_count}/${s.repeat_limit} 次` : `\n   已执行: ${s.repeat_count} 次`;

  return `📋 ${s.task_title}\n   ID: ${s.id}\n   状态: ${enabledText} | ${typeText}\n   调度: ${scheduleDesc}${nextRun}${lastRun}${repeatInfo}`;
}

const scheduleTaskTool: ToolDefinition<ScheduleTaskParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'schedule_task',
      description:
        '创建/管理定时任务。定时任务到期后自动在后台执行。\n' +
        '支持：一次性延迟（30m/2h）、循环间隔（every 30m）、指定时间。\n' +
        '适用场景：提醒、定期检查、周期性数据收集等。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: '操作类型：create=创建 | list=列出所有 | pause=暂停 | resume=恢复 | remove=删除 | trigger=立即触发一次',
            enum: ['create', 'list', 'pause', 'resume', 'remove', 'trigger'],
          },
          title: {
            type: 'string',
            description: '【create 必填】任务标题',
          },
          prompt: {
            type: 'string',
            description: '【create 必填】自包含的任务指令（每次执行时子智能体只能看到这段指令）',
          },
          schedule: {
            type: 'string',
            description: '【create 必填】调度表达式。格式：23:20（今天或明天该时刻）| 30m/2h/1d（一次性延迟）| every 30m/every 2h（循环）| cron:20 23 * * *（cron 5字段：分 时 日 月 周）| 2025-07-10T09:00（指定日期时间）',
          },
          repeat_limit: {
            type: 'integer',
            description: '【create 可选】循环任务的最大执行次数（默认无限）。一次性任务自动为 1',
          },
          toolsets: {
            type: 'array',
            description: '【create 可选】子智能体可用的工具集（默认 ["agent"]）',
            items: { type: 'string' },
          },
          schedule_id: {
            type: 'string',
            description: '【pause/resume/remove/trigger 必填】调度 ID',
          },
        },
        required: ['action'],
      },
    },
  },

  execute(params, context) {
    const { action } = params;

    switch (action) {
      case 'create': {
        if (!params.title?.trim()) return '❌ 缺少 title 参数';
        if (!params.prompt?.trim()) return '❌ 缺少 prompt 参数';
        if (!params.schedule?.trim()) return '❌ 缺少 schedule 参数';

        try {
          // 将来源对话 ID 存入 metadata，供调度器触发时注入聊天通知
          const schedMeta: Record<string, unknown> = {};
          if (params.toolsets) schedMeta.toolsets = params.toolsets;
          if (context?.conversationId) schedMeta.conversationId = context.conversationId;

          const sched = taskScheduler.createSchedule({
            title: params.title.trim(),
            prompt: params.prompt.trim(),
            schedule: params.schedule.trim(),
            repeatLimit: params.repeat_limit,
            metadata: Object.keys(schedMeta).length > 0 ? schedMeta : undefined,
          });

          const nextRun = sched.next_run_at
            ? new Date(sched.next_run_at).toLocaleString('zh-CN')
            : '待计算';

          return `✅ 定时任务已创建\n\n` +
            `📋 ${sched.task_title}\n` +
            `🆔 ${sched.id}\n` +
            `⏰ 下次执行: ${nextRun}\n` +
            `📅 类型: ${sched.schedule_type === 'once' ? '一次性' : sched.schedule_type === 'interval' ? '循环' : 'Cron'}`;
        } catch (err) {
          return `❌ 创建失败: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      case 'list': {
        const schedules = taskScheduler.listSchedules(false);
        if (schedules.length === 0) return '📭 当前没有定时任务';
        return `共 ${schedules.length} 个定时任务：\n\n` + schedules.map(formatSchedule).join('\n\n');
      }

      case 'pause': {
        if (!params.schedule_id) return '❌ 缺少 schedule_id 参数';
        return taskScheduler.pauseSchedule(params.schedule_id)
          ? `✅ 已暂停调度: ${params.schedule_id}`
          : `❌ 未找到调度: ${params.schedule_id}`;
      }

      case 'resume': {
        if (!params.schedule_id) return '❌ 缺少 schedule_id 参数';
        return taskScheduler.resumeSchedule(params.schedule_id)
          ? `✅ 已恢复调度: ${params.schedule_id}`
          : `❌ 未找到调度: ${params.schedule_id}`;
      }

      case 'remove': {
        if (!params.schedule_id) return '❌ 缺少 schedule_id 参数';
        return taskScheduler.removeSchedule(params.schedule_id)
          ? `✅ 已删除调度: ${params.schedule_id}`
          : `❌ 未找到调度: ${params.schedule_id}`;
      }

      case 'trigger': {
        if (!params.schedule_id) return '❌ 缺少 schedule_id 参数';
        return taskScheduler.triggerNow(params.schedule_id)
          ? `✅ 已触发立即执行: ${params.schedule_id}`
          : `❌ 未找到调度: ${params.schedule_id}`;
      }

      default:
        return `❌ 未知操作: ${action}`;
    }
  },
};

export default scheduleTaskTool;
