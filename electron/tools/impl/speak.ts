/**
 * Skill: speak
 *
 * 主动通知工具：将指定文字注入对话聊天窗口并通过 TTS 朗读出来。
 *
 * 设计目的：
 *   - 供后台 agent 任务（schedule_task / async_task）主动通知用户
 *   - 消息会同时出现在聊天窗口（可见）和 TTS 播报（可听）
 *   - 典型场景：后台任务执行完毕后，agent 调用本工具向用户汇报结果
 *   - 聊天路径（sendChatMessage）会自动 TTS，无需显式调用本工具
 *
 * 消息链路：
 *   speak → injectAgentMessage → 保存到对话历史 + chat:agent-message IPC + TTS 播报
 *   如无父对话（如独立 cron 任务），则仅 TTS 播报作为降级方案
 */

import type { ToolDefinition } from '../types';
import { injectAgentMessage, playTTSAudio } from '../../main';
import { taskManager } from '../../taskManager';

interface SpeakParams {
  text: string;
}

const speakTool: ToolDefinition<SpeakParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'speak',
      description:
        '🔔 主动通知工具：将消息显示在聊天窗口并通过语音朗读给用户。\n' +
        '用法：把要告知用户的内容作为 text 传入，工具立即在聊天框显示消息气泡并触发 TTS 播报。\n' +
        '典型用途：任务完成后汇报结果、中途进度更新、提醒用户注意事项。\n' +
        '⚠️ text 建议 30～150 字，过长自动截断。',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '要通知用户的文字内容（30～150 字为宜）',
          },
        },
        required: ['text'],
      },
    },
  },

  async execute({ text }, context) {
    if (!text?.trim()) return '❌ text 不能为空';

    // 清理指令标记，只保留自然语言
    const cleanText = text
      .replace(/【.*?】/g, '')
      .replace(/\[.*?\]/g, '')
      .trim();

    if (!cleanText) return '❌ 清理后文本为空';

    // 截断超长文本
    const speakText = cleanText.length > 200 ? cleanText.slice(0, 200) + '…' : cleanText;

    // 解析目标对话 ID：
    //   - 直接对话（agent/chat 模式）：context.conversationId 本身即对话 ID
    //   - 后台任务（agentRunner）：context.conversationId = 'task-{taskId}'，需从任务记录取父对话
    const ctxConvId = context?.conversationId;
    let targetConvId: string | null = null;
    if (ctxConvId?.startsWith('task-')) {
      const taskId = ctxConvId.slice(5);
      const task = taskManager.getTask(taskId);
      targetConvId = task?.conversation_id ?? null;
    } else if (ctxConvId) {
      targetConvId = ctxConvId;
    }

    if (targetConvId) {
      // 注入聊天气泡（持久可见）+ TTS 播报
      await injectAgentMessage(targetConvId, speakText);
      return `✅ 已向对话注入消息并触发 TTS（${speakText.length} 字）`;
    }

    // 降级：仅 TTS（无对话上下文，如独立 cron 任务）
    const success = await playTTSAudio(speakText);
    if (success) {
      return `✅ 已发送 TTS 朗读（${speakText.length} 字）`;
    } else {
      return '⚠️ TTS 暂不可用（主窗口未就绪或 TTS 服务未启动），朗读已跳过';
    }
  },
};

export default speakTool;
