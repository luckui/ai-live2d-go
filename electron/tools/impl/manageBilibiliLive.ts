import type { SkillPauseResult, ToolDefinition } from '../types';
import { streamerSession } from '../../streaming/streamerSession';
import { streamerController } from '../../streaming/streamerController';
import type { EphemeralLiveCredentials, LiveEvent, StreamerSessionConfig } from '../../streaming/types';

interface ManageBilibiliLiveParams {
  action: 'start' | 'stop' | 'status' | 'ingest_test' | 'flush' | 'replies' | 'set_auto_reply';
  room_id?: number;
  topic?: string;
  cookie?: string;
  require_cookie?: boolean;
  auto_reply?: boolean;
  enabled?: boolean;
  event_type?: LiveEvent['type'];
  uid?: string;
  uname?: string;
  text?: string;
  gift_name?: string;
  gift_count?: number;
  gift_value?: number;
  limit?: number;
}

function formatStatus() {
  const status = streamerSession.status();
  return JSON.stringify(status, null, 2);
}

function requestRoomIdPause(topic?: string): SkillPauseResult {
  return {
    __pause: true,
    trace: [
      'Bilibili live start requested.',
      'No room_id was provided in this tool call.',
      'room_id must be collected from the user.',
    ],
    userMessage:
      `要开始 B 站直播${topic ? `（主题：${topic}）` : ''}，请提供直播间的房间号（room_id）。` +
      '可以在 B 站直播间 URL 中找到，例如 live.bilibili.com/26835777 中的 26835777。',
    resumeHint:
      '用户提供房间号后，立刻重新调用 manage_bilibili_live(action="start", room_id=用户提供的房间号, topic=原主题)。',
  };
}

function requestCookiePause(roomId: number, topic?: string): SkillPauseResult {
  return {
    __pause: true,
    trace: [
      'Bilibili live start requested.',
      'No Cookie was provided in this tool call.',
      'Cookie must be collected from the user for this start attempt only.',
    ],
    userMessage:
      `要连接 B 站直播间 ${roomId}${topic ? `（主题：${topic}）` : ''}，请提供本次使用的 B 站 Cookie。` +
      '我不会把 Cookie 写入源码、数据库或长期配置；这次启动流程结束或停止直播后就丢弃。',
    resumeHint:
      '用户提供 Cookie 后，立刻重新调用 manage_bilibili_live(action="start", room_id=原房间号, topic=原主题, cookie=用户提供的 Cookie)。' +
      '不要把 Cookie 写入文件、记忆、日志或普通聊天总结。',
  };
}

const manageBilibiliLiveTool: ToolDefinition<ManageBilibiliLiveParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'manage_bilibili_live',
      description:
        '管理 B 站直播主播后台会话：启动/停止 streamer 会话、查看弹幕池状态、注入测试弹幕、触发一次回复规划。' +
        'start 动作：如果缺少 room_id 或 Cookie，工具会暂停并要求 AI 向用户询问。Cookie 只能临时使用，禁止写入文件、记忆或数据库。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['start', 'stop', 'status', 'ingest_test', 'flush', 'replies', 'set_auto_reply'],
            description: 'start 启动直播会话；stop 停止；status 状态；ingest_test 注入测试事件；flush 生成/规划一条回复；replies 查看最近回复；set_auto_reply 动态开关自动回复',
          },
          room_id: { type: 'integer', description: 'B 站直播间 room_id。start 时如果不提供，工具会暂停并询问用户。' },
          topic: { type: 'string', description: '本场直播主题，例如打游戏、读书、一起冲浪' },
          cookie: { type: 'string', description: '本次 start 调用使用的 B 站 Cookie。不得硬编码、不得持久化、不得写入记忆；缺失时工具会要求 AI 询问用户。' },
          require_cookie: { type: 'boolean', description: 'start 是否要求 Cookie。默认 true。仅离线测试弹幕池时可设为 false。' },
          auto_reply: { type: 'boolean', description: '是否自动调用 LLM 生成回复。默认 false，仅规划 prompt，避免未接 TTS/发言链路时自动说话。' },
          enabled: { type: 'boolean', description: 'set_auto_reply 动作的开关值' },
          event_type: { type: 'string', enum: ['danmu', 'gift', 'super_chat', 'guard', 'enter', 'like', 'system'], description: 'ingest_test 的事件类型' },
          uid: { type: 'string', description: '测试事件用户 uid' },
          uname: { type: 'string', description: '测试事件用户名' },
          text: { type: 'string', description: '测试弹幕/SC 文本' },
          gift_name: { type: 'string', description: '测试礼物名称' },
          gift_count: { type: 'integer', description: '测试礼物数量' },
          gift_value: { type: 'number', description: '测试礼物价值，单位由上游适配器归一化' },
          limit: { type: 'integer', description: 'replies 返回条数，默认 10' },
        },
        required: ['action'],
      },
    },
  },

  async execute(params, context) {
    switch (params.action) {
      case 'start': {
        // 1. 检查 room_id
        if (!params.room_id) {
          return requestRoomIdPause(params.topic);
        }

        // 2. 检查 Cookie
        const requireCookie = params.require_cookie ?? true;
        if (requireCookie && !params.cookie?.trim()) {
          return requestCookiePause(params.room_id, params.topic);
        }

        // 3. 启动会话
        const config: StreamerSessionConfig = {
          platform: 'bilibili',
          roomId: params.room_id,
          topic: params.topic,
          conversationId: context?.conversationId,
          autoReply: params.auto_reply ?? false,
        };
        const credentials: EphemeralLiveCredentials | undefined = params.cookie?.trim()
          ? { cookie: params.cookie.trim(), receivedAt: Date.now() }
          : undefined;
        const status = streamerSession.start(config, credentials);
        
        // 4. 启动主控循环
        streamerController.start({
          autoTTS: true,
          autoLive2D: true,
          idleThresholdMs: 45_000,
          checkIntervalMs: 3_000,
        });
        
        return `B 站 streamer 会话已启动。\n${JSON.stringify(status, null, 2)}`;
      }
      case 'stop': {
        // 停止主控循环
        streamerController.stop();
        // 停止会话
        const status = streamerSession.stop();
        return `B 站 streamer 会话已停止。\n${JSON.stringify(status, null, 2)}`;
      }
      case 'status':
        return formatStatus();
      case 'ingest_test': {
        const event: LiveEvent = {
          id: `test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          platform: 'bilibili',
          type: params.event_type ?? 'danmu',
          ts: Date.now(),
          uid: params.uid,
          uname: params.uname,
          text: params.text,
          giftName: params.gift_name,
          giftCount: params.gift_count,
          giftValue: params.gift_value,
        };
        const result = streamerSession.ingest(event);
        return JSON.stringify(result, null, 2);
      }
      case 'flush': {
        const reply = await streamerSession.flushOnce();
        return reply ? JSON.stringify(reply, null, 2) : '当前没有待处理的直播事件。';
      }
      case 'replies':
        return JSON.stringify(streamerSession.listReplies(params.limit ?? 10), null, 2);
      case 'set_auto_reply': {
        const enabled = params.enabled ?? true;
        const success = streamerSession.setAutoReply(enabled);
        if (!success) {
          return '设置失败：当前没有活跃的直播会话。请先使用 action="start" 启动直播会话。';
        }
        return `自动回复已${enabled ? '开启' : '关闭'}。${enabled ? '现在会自动调用 AI 回复弹幕。' : '现在只规划回复内容，不自动生成 AI 回复。'}`;
      }
      default:
        return `未知操作: ${params.action}`;
    }
  },
};

export default manageBilibiliLiveTool;
