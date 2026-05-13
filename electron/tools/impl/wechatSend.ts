/**
 * 原子工具：wechat_send
 *
 * 向指定微信用户发送消息，可选附带本地文件（图片/视频/文档）。
 *
 * 安全守卫：
 *   - 仅当 WeChatAdapter.activeAdapter 非空时可用（Bot 在线）
 *   - 只应在收到含 [来源：WeChat | ...] 标签的消息后才调用此工具
 *
 * 注意：
 *   - 微信 iLink API 使用 AES-128-ECB 加密 CDN 传输媒体文件
 *   - 支持的媒体类型：图片(image_item)、视频(video_item)、文件(file_item)、语音(voice_item)
 */

import fs from 'fs';
import path from 'path';
import type { ToolDefinition } from '../types';
import { WeChatAdapter } from '../../bridges/adapters/wechat';

interface WeChatSendParams {
  /** 目标微信用户 ID（字符串） */
  user_id: string;
  /** 要发送的文字内容（可为空字符串，但不可与 files 同时为空） */
  content?: string;
  /** 要附带的本地文件绝对路径列表，最多 10 个 */
  files?: string[];
}

const wechatSendTool: ToolDefinition<WeChatSendParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'wechat_send',
      description:
        '通过微信 Bot 向用户发送文件或附件消息。\n' +
        '【何时调用】当用户消息含 [来源：WeChat | 用户：xxx] 标签，且满足以下任一条件：\n' +
        '  1. 用户要求发送/分享某个文件（"发给我"、"把 XX 文件发过来" 等）\n' +
        '  2. 需要附带截图、图片等二进制内容一起回复\n' +
        '  3. 纯文字以外、需要以附件形式传递的任何内容\n' +
        '【user_id 取法】从消息标签"用户："字段直接取（如 [来源：WeChat | 用户：abc123]，则 user_id="abc123"）\n' +
        '【files 参数】本地文件绝对路径列表；路径未知时先用 run_command 查找，再传入此工具\n' +
        '【何时不调用】无 WeChat 标签的桌面聊天，绝对禁止调用\n' +
        '【与文字回复的关系】纯文字 AI 回复由系统自动发回，此工具专用于携带文件附件的情况\n' +
        '【媒体类型支持】图片(JPG/PNG)、视频(MP4)、文档(PDF/DOCX)、任意文件',
      parameters: {
        type: 'object',
        properties: {
          user_id: {
            type: 'string',
            description: '目标微信用户 ID（从消息标签中的"用户"字段取得）',
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
        required: ['user_id'],
      },
    },
  },

  async execute({ user_id, content, files }) {
    // 守卫：Bot 必须在线
    const adapter = WeChatAdapter.activeAdapter;
    if (!adapter) {
      return '❌ WeChat Bot 当前不在线，无法发送消息。';
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

    // 验证文件存在性
    if (hasFiles) {
      for (const filePath of files!) {
        if (!fs.existsSync(filePath)) {
          return `❌ 文件不存在：${filePath}`;
        }
      }
    }

    // 发送文本消息
    if (hasContent) {
      try {
        await adapter.sendText(user_id, content!.trim());
      } catch (e) {
        return `❌ 发送文本失败：${(e as Error).message}`;
      }
    }

    // 发送文件附件
    if (hasFiles) {
      for (const filePath of files!) {
        try {
          await adapter.sendFile(user_id, filePath);
        } catch (e) {
          return `❌ 发送文件失败（${path.basename(filePath)}）：${(e as Error).message}`;
        }
      }
    }

    const fileInfo = hasFiles ? `，附带 ${files!.length} 个文件` : '';
    return `✅ 已向微信用户 ${user_id.slice(0, 8)}*** 发送消息${fileInfo}。`;
  },
};

export default wechatSendTool;
