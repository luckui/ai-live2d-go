/**
 * B站直播 WebSocket 协议解析
 * 基于 danmu_test/test_connect.py 验证的协议格式
 * 
 * 协议格式：
 * - 16 字节头部: [总长度(4) | 头长度(2) | 协议版本(2) | 操作码(4) | Sequence(4)]
 * - 操作码: 2=发送心跳, 3=心跳回复(人气值), 5=服务器消息, 7=认证请求, 8=认证响应
 * - 协议版本: 0/1=JSON明文, 2=zlib压缩, 3=brotli压缩
 */

import zlib from 'zlib';
import { promisify } from 'util';
import type { LiveEvent } from '../../types';

const brotliDecompress = promisify(zlib.brotliDecompress);
const inflateSync = promisify(zlib.inflate);

// 操作码
export const OP = {
  HEARTBEAT: 2,           // 客户端发送心跳
  HEARTBEAT_REPLY: 3,     // 服务端回复心跳（人气值）
  MESSAGE: 5,             // 服务端推送消息
  AUTH: 7,                // 客户端认证请求
  AUTH_REPLY: 8,          // 服务端认证响应
} as const;

// 协议版本
export const PROTO_VER = {
  JSON: 0,                // JSON 明文
  HEARTBEAT: 1,           // 心跳专用
  ZLIB: 2,                // zlib 压缩
  BROTLI: 3,              // brotli 压缩（推荐）
} as const;

const HEADER_LEN = 16;

/**
 * 构造认证包
 */
export function makeAuthPacket(roomId: number, uid: number, token: string): Buffer {
  const authBody = JSON.stringify({
    uid,
    roomid: roomId,
    protover: 3,          // 使用 brotli 压缩
    platform: 'web',
    type: 2,
    key: token,
  });

  const bodyBuf = Buffer.from(authBody, 'utf-8');
  const totalLen = HEADER_LEN + bodyBuf.length;

  const header = Buffer.alloc(HEADER_LEN);
  header.writeUInt32BE(totalLen, 0);          // 总长度
  header.writeUInt16BE(HEADER_LEN, 4);        // 头长度
  header.writeUInt16BE(PROTO_VER.JSON, 6);    // 协议版本（认证包用 JSON）
  header.writeUInt32BE(OP.AUTH, 8);           // 操作码
  header.writeUInt32BE(1, 12);                // Sequence

  return Buffer.concat([header, bodyBuf]);
}

/**
 * 构造心跳包
 */
export function makeHeartbeatPacket(): Buffer {
  const header = Buffer.alloc(HEADER_LEN);
  header.writeUInt32BE(HEADER_LEN, 0);        // 总长度（心跳包无 body）
  header.writeUInt16BE(HEADER_LEN, 4);        // 头长度
  header.writeUInt16BE(PROTO_VER.HEARTBEAT, 6); // 协议版本
  header.writeUInt32BE(OP.HEARTBEAT, 8);      // 操作码
  header.writeUInt32BE(1, 12);                // Sequence

  return header;
}

/**
 * 拆包：处理粘包，返回多个独立的包
 */
export function splitPackets(buffer: Buffer): Buffer[] {
  const packets: Buffer[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + HEADER_LEN > buffer.length) break;

    const totalLen = buffer.readUInt32BE(offset);
    if (offset + totalLen > buffer.length) break;

    packets.push(buffer.subarray(offset, offset + totalLen));
    offset += totalLen;
  }

  return packets;
}

/**
 * 解析单个包
 */
export async function parsePacket(packet: Buffer): Promise<ParsedPacket | null> {
  if (packet.length < HEADER_LEN) return null;

  const totalLen = packet.readUInt32BE(0);
  const headerLen = packet.readUInt16BE(4);
  const protoVer = packet.readUInt16BE(6);
  const op = packet.readUInt32BE(8);

  const body = packet.subarray(headerLen, totalLen);

  // 心跳回复（人气值）
  if (op === OP.HEARTBEAT_REPLY) {
    const popularity = body.length >= 4 ? body.readUInt32BE(0) : 0;
    return { type: 'heartbeat', popularity };
  }

  // 认证响应
  if (op === OP.AUTH_REPLY) {
    try {
      const data = JSON.parse(body.toString('utf-8'));
      return { type: 'auth', success: data.code === 0, data };
    } catch {
      return { type: 'auth', success: false };
    }
  }

  // 服务端消息
  if (op === OP.MESSAGE) {
    let decompressed: Buffer = body;

    // 解压缩
    if (protoVer === PROTO_VER.BROTLI) {
      decompressed = await brotliDecompress(body);
    } else if (protoVer === PROTO_VER.ZLIB) {
      decompressed = await inflateSync(body);
    }

    // 递归拆包（解压后可能有多个子包）
    if (protoVer === PROTO_VER.BROTLI || protoVer === PROTO_VER.ZLIB) {
      const subPackets = splitPackets(decompressed);
      const messages: any[] = [];
      for (const sub of subPackets) {
        const parsed = await parsePacket(sub);
        if (parsed?.type === 'message') {
          messages.push(...parsed.messages);
        }
      }
      return { type: 'message', messages };
    }

    // JSON 明文消息
    try {
      const json = JSON.parse(decompressed.toString('utf-8'));
      return { type: 'message', messages: [json] };
    } catch {
      return null;
    }
  }

  return null;
}

export type ParsedPacket =
  | { type: 'heartbeat'; popularity: number }
  | { type: 'auth'; success: boolean; data?: any }
  | { type: 'message'; messages: any[] };

/**
 * 将 B站 CMD 消息转换为通用 LiveEvent
 */
export function convertToLiveEvent(msg: any, roomId: number): LiveEvent | null {
  const cmd: string = msg.cmd || '';
  const ts = Date.now();

  // 弹幕
  if (cmd === 'DANMU_MSG') {
    const info = msg.info;
    if (!info || !Array.isArray(info) || info.length < 3) return null;
    return {
      id: `danmu-${ts}-${Math.random().toString(16).slice(2)}`,
      platform: 'bilibili',
      type: 'danmu',
      ts,
      uid: String(info[2]?.[0] ?? ''),
      uname: String(info[2]?.[1] ?? ''),
      text: String(info[1] ?? ''),
      raw: msg,
    };
  }

  // 礼物
  if (cmd === 'SEND_GIFT') {
    return {
      id: `gift-${ts}-${Math.random().toString(16).slice(2)}`,
      platform: 'bilibili',
      type: 'gift',
      ts,
      uid: String(msg.data?.uid ?? ''),
      uname: String(msg.data?.uname ?? ''),
      giftName: String(msg.data?.giftName ?? ''),
      giftCount: Number(msg.data?.num ?? 1),
      giftValue: Number(msg.data?.price ?? 0),
      raw: msg,
    };
  }

  // SC（醒目留言）
  if (cmd === 'SUPER_CHAT_MESSAGE') {
    return {
      id: `sc-${ts}-${Math.random().toString(16).slice(2)}`,
      platform: 'bilibili',
      type: 'super_chat',
      ts,
      uid: String(msg.data?.uid ?? ''),
      uname: String(msg.data?.user_info?.uname ?? ''),
      text: String(msg.data?.message ?? ''),
      giftValue: Number(msg.data?.price ?? 0),
      raw: msg,
    };
  }

  // 上舰
  if (cmd === 'GUARD_BUY') {
    return {
      id: `guard-${ts}-${Math.random().toString(16).slice(2)}`,
      platform: 'bilibili',
      type: 'guard',
      ts,
      uid: String(msg.data?.uid ?? ''),
      uname: String(msg.data?.username ?? ''),
      giftName: `guard-${msg.data?.guard_level ?? 0}`,
      giftValue: Number(msg.data?.price ?? 0),
      raw: msg,
    };
  }

  // 进场
  if (cmd === 'INTERACT_WORD') {
    return {
      id: `enter-${ts}-${Math.random().toString(16).slice(2)}`,
      platform: 'bilibili',
      type: 'enter',
      ts,
      uid: String(msg.data?.uid ?? ''),
      uname: String(msg.data?.uname ?? ''),
      raw: msg,
    };
  }

  // 点赞
  if (cmd === 'LIKE_INFO_V3_CLICK') {
    return {
      id: `like-${ts}-${Math.random().toString(16).slice(2)}`,
      platform: 'bilibili',
      type: 'like',
      ts,
      uid: String(msg.data?.uid ?? ''),
      uname: String(msg.data?.uname ?? ''),
      raw: msg,
    };
  }

  // 忽略的 CMD
  const IGNORE_CMDS = [
    'ONLINE_RANK_V2',
    'ONLINE_RANK_COUNT',
    'HOT_RANK_CHANGED',
    'STOP_LIVE_ROOM_LIST',
    'WIDGET_BANNER',
    'COMBO_SEND',
    'COMBO_END',
    'ENTRY_EFFECT',
    'ENTRY_EFFECT_MUST_RECEIVE',  // 进场特效（必须接收）
    'ROOM_REAL_TIME_MESSAGE_UPDATE',
    'WATCHED_CHANGE',
    'INTERACT_WORD_V2',  // protobuf 编码，无法解析
    'WIDGET_GIFT_STAR_PROCESS',
    'COMMON_NOTIFY_UNIFY_MSG',
    'POPULAR_RANK_CHANGED',
    'LIVE_PANEL_CHANGE_CONTENT',
    'CARD_MSG',
    'DM_INTERACTION',
    'HOT_ROOM_NOTIFY',
    'LOG_IN_NOTICE',
    'NOTICE_MSG',  // 系统通知（人气榜等）
  ];

  if (IGNORE_CMDS.includes(cmd)) {
    return null;
  }

  // 未知 CMD（调试用）
  if (cmd) {
    console.log(`[biliProtocol] Unknown CMD: ${cmd}`, msg);
  }

  return null;
}
