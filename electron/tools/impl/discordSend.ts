/**
 * 原子工具：discord_send
 *
 * 向指定 Discord 频道发送文字消息，可选附带本地文件（图片 / 任意附件）。
 *
 * 安全守卫：
 *   - 仅当 DiscordAdapter.activeClient 非空时可用（Bot 在线）
 *   - 只应在收到含 [来源：Discord | ...] 标签的消息后才调用此工具
 */

import { AttachmentBuilder, TextChannel } from 'discord.js';
import fs from 'fs';
import path from 'path';
import type { ToolDefinition } from '../types';
import { DiscordAdapter } from '../../bridges/adapters/discord';

interface DiscordSendParams {
  /** 目标频道 ID（数字串） */
  channel_id: string;
  /** 要发送的文字内容（可为空字符串，但不可与 files 同时为空） */
  content?: string;
  /** 要附带的本地文件绝对路径列表，最多 10 个 */
  files?: string[];
}

const discordSendTool: ToolDefinition<DiscordSendParams> = {
  hideWhenSkills: true,   // discord_send_file Skill 存在时自动隐藏，AI 优先走 Skill
  schema: {
    type: 'function',
    function: {
      name: 'discord_send',
      description:
        '通过 Discord Bot 向用户所在频道发送文件或附件消息。\n' +
        '【何时调用】当用户消息含 [来源：Discord | 频道：xxx | ...] 标签，且满足以下任一条件：\n' +
        '  1. 用户要求发送/分享某个文件（"发给我"、"把 XX 文件发过来" 等）\n' +
        '  2. 需要附带截图、图片等二进制内容一起回复\n' +
        '  3. 纯文字以外、需要以附件形式传递的任何内容\n' +
        '【channel_id 取法】从消息标签"频道："字段直接取（如 [来源：Discord | 频道：123456 | ...]，则 channel_id="123456"）\n' +
        '【files 参数】本地文件绝对路径列表；路径未知时先用 run_command 查找，再传入此工具\n' +
        '【何时不调用】无 Discord 标签的桌面聊天，绝对禁止调用\n' +
        '【与文字回复的关系】纯文字 AI 回复由系统自动发回频道，此工具专用于携带文件附件的情况',
      parameters: {
        type: 'object',
        properties: {
          channel_id: {
            type: 'string',
            description: '目标 Discord 频道 ID（从消息标签中的"频道"字段取得）',
          },
          content: {
            type: 'string',
            description: '要发送的文字内容。可为空（此时必须提供 files）。',
          },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: '要附带的本地文件绝对路径列表（最多 10 个）。例如截图路径。',
          },
        },
        required: ['channel_id'],
      },
    },
  },

  async execute({ channel_id, content, files }) {
    // 守卫：Bot 必须在线
    const client = DiscordAdapter.activeClient;
    if (!client) {
      return '❌ Discord Bot 当前不在线，无法发送消息。';
    }

    // 参数合法性检查
    const hasContent = typeof content === 'string' && content.trim().length > 0;
    const hasFiles   = Array.isArray(files) && files.length > 0;
    if (!hasContent && !hasFiles) {
      return '❌ content 和 files 不能同时为空。';
    }
    if (hasFiles && files!.length > 10) {
      return '❌ 附件最多 10 个。';
    }

    // 获取频道对象
    let channel;
    try {
      channel = await client.channels.fetch(channel_id);
    } catch (e) {
      return `❌ 无法获取频道 ${channel_id}：${(e as Error).message}`;
    }

    if (!channel || !('send' in channel)) {
      return `❌ 频道 ${channel_id} 不可发送消息（可能是语音频道或无权限）。`;
    }
    const textChannel = channel as TextChannel;

    // 构建附件
    const attachments: AttachmentBuilder[] = [];
    if (hasFiles) {
      for (const filePath of files!) {
        if (!fs.existsSync(filePath)) {
          return `❌ 文件不存在：${filePath}`;
        }
        attachments.push(new AttachmentBuilder(filePath, { name: path.basename(filePath) }));
      }
    }

    // 发送
    try {
      await textChannel.send({
        content: hasContent ? content!.trim() : undefined,
        files: attachments.length > 0 ? attachments : undefined,
      });
    } catch (e) {
      return `❌ 发送失败：${(e as Error).message}`;
    }

    const fileInfo = hasFiles ? `，附带 ${files!.length} 个文件` : '';
    return `✅ 已向频道 ${channel_id} 发送消息${fileInfo}。`;
  },
};

export default discordSendTool;
