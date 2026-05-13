/**
 * Skill: speak
 *
 * TTS 朗读工具：将指定文字通过语音合成大声朗读出来。
 *
 * 设计目的：
 *   - 供后台 agent 任务（schedule_task / async_task）主动触发 TTS
 *   - 典型场景：watch_bilibili_video 返回视频信息后，agent 调用 speak 朗读解说词
 *   - 聊天路径（sendChatMessage）会自动 TTS，无需显式调用本工具
 *
 * TTS 链路：
 *   speak → playTTSAudio → mainWin.webContents.send('tts:play') → 渲染进程合成+播放
 */

import type { ToolDefinition } from '../types';
import { playTTSAudio } from '../../main';

interface SpeakParams {
  text: string;
}

const speakTool: ToolDefinition<SpeakParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'speak',
      description:
        '🔊 TTS 朗读工具：将文字通过语音合成大声朗读给观众听。\n' +
        '用法：直接把要朗读的解说词、通知、总结等内容作为 text 传入，工具立即播放，无需其他操作。\n' +
        '典型用途：watch_bilibili_video 返回视频信息后，把自行编写的解说词填入 text 调用本工具。\n' +
        '⚠️ 只有 TTS 服务已启动时才有效；text 建议 30～150 字，过长自动截断。',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '要朗读的文字内容（30～150 字为宜）',
          },
        },
        required: ['text'],
      },
    },
  },

  async execute({ text }) {
    if (!text?.trim()) return '❌ text 不能为空';

    // 清理指令标记，只保留自然语言
    const cleanText = text
      .replace(/【.*?】/g, '')
      .replace(/\[.*?\]/g, '')
      .trim();

    if (!cleanText) return '❌ 清理后文本为空';

    // 截断超长文本（TTS 过长会阻塞播放队列）
    const speakText = cleanText.length > 200 ? cleanText.slice(0, 200) + '…' : cleanText;

    const success = await playTTSAudio(speakText);
    if (success) {
      return `✅ 已发送 TTS 朗读（${speakText.length} 字）`;
    } else {
      return '⚠️ TTS 暂不可用（主窗口未就绪或 TTS 服务未启动），朗读已跳过';
    }
  },
};

export default speakTool;
