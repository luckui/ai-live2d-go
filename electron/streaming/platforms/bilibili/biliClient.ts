/**
 * B站直播 WebSocket 客户端
 * 管理连接、心跳、重连逻辑
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { getRealRoomId, getDanmuConfig } from './biliApi';
import {
  makeAuthPacket,
  makeHeartbeatPacket,
  splitPackets,
  parsePacket,
  convertToLiveEvent,
} from './biliProtocol';
import type { LiveEvent } from '../../types';

export interface BiliClientConfig {
  roomId: number;
  uid?: number;
  cookie?: string;
}

export interface BiliClientEvents {
  connected: () => void;
  authenticated: () => void;
  event: (event: LiveEvent) => void;
  popularity: (count: number) => void;
  error: (error: Error) => void;
  disconnected: (reason: string) => void;
}

export declare interface BiliClient {
  on<K extends keyof BiliClientEvents>(event: K, listener: BiliClientEvents[K]): this;
  emit<K extends keyof BiliClientEvents>(event: K, ...args: Parameters<BiliClientEvents[K]>): boolean;
}

/**
 * B站直播 WebSocket 客户端
 * 
 * 功能：
 * - 自动获取真实 room_id
 * - 自动获取 token 和 WebSocket 服务器
 * - 认证、心跳（30秒）
 * - 指数退避重连（1s, 2s, 4s, 8s, max 60s）
 * - 粘包拆包、brotli/zlib 解压
 * - CMD 事件转换为通用 LiveEvent
 */
export class BiliClient extends EventEmitter {
  private config: BiliClientConfig;
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 60000;
  private realRoomId = 0;
  private stopped = false;

  constructor(config: BiliClientConfig) {
    super();
    this.config = config;
  }

  /**
   * 启动连接
   */
  async start(): Promise<void> {
    this.stopped = false;

    try {
      // 1. 获取真实 room_id
      this.realRoomId = await getRealRoomId(this.config.roomId);
      console.log(`[BiliClient] Real room_id: ${this.realRoomId}`);

      // 2. 获取弹幕配置
      const danmuConfig = await getDanmuConfig(this.realRoomId, this.config.cookie);
      console.log(`[BiliClient] Token received, ${danmuConfig.servers.length} servers available`);

      // 3. 尝试连接服务器
      await this.connectToServers(danmuConfig.servers, danmuConfig.token);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      this.scheduleReconnect();
    }
  }

  /**
   * 停止连接
   */
  stop(): void {
    this.stopped = true;
    this.cleanup();
    console.log('[BiliClient] Stopped');
  }

  /** 内置兜底服务器（API 节点全部失败时最后尝试） */
  private static readonly FALLBACK_SERVERS: Array<{ host: string; port: number; wss_port: number }> = [
    { host: 'broadcastlv.chat.bilibili.com', port: 2243, wss_port: 443 },
    { host: 'broadcastlv.chat.bilibili.com', port: 2245, wss_port: 2245 },
  ];

  /**
   * 尝试连接服务器列表
   * - 随机打乱 API 返回的服务器顺序，避免总是压同一台边缘节点
   * - 追加内置兜底服务器，确保至少有一条退路
   */
  private async connectToServers(
    servers: Array<{ host: string; port: number; wss_port: number }>,
    token: string
  ): Promise<void> {
    // 随机打乱，分散连接压力
    const shuffled = [...servers].sort(() => Math.random() - 0.5);
    // 追加兜底（过滤掉 API 已包含的主机）
    const extra = BiliClient.FALLBACK_SERVERS.filter(
      f => !servers.some(s => s.host === f.host)
    );
    const allServers = [...shuffled, ...extra];

    for (const server of allServers) {
      if (this.stopped) return;

      const wsUrl = `wss://${server.host}:${server.wss_port}/sub`;
      console.log(`[BiliClient] Connecting to ${wsUrl}`);
      try {
        await this.connect(wsUrl, token);
        return; // 连接 + 认证成功
      } catch (err) {
        console.warn(`[BiliClient] ${server.host} failed: ${(err as Error).message}`);
        // 继续尝试下一台
      }
    }

    throw new Error('All WebSocket servers failed');
  }

  /**
   * 连接到单个 WebSocket 服务器，并等待认证完成。
   *
   * Promise 语义：
   *   resolve — 认证成功（收到 OP=8 且 success=true）
   *   reject  — 任何错误：连接超时、auth 超时、ws error、认证前 close
   *
   * close 发生在认证 *之后* 时不 reject（连接已成功建立），而是触发正常重连流程。
   */
  private connect(wsUrl: string, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) { settled = true; fn(); }
      };

      const ws = new WebSocket(wsUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': 'https://live.bilibili.com',
          'Referer': `https://live.bilibili.com/${this.config.roomId}`,
          ...(this.config.cookie ? { Cookie: this.config.cookie } : {}),
        },
      });

      // TCP 连接超时（10s）
      const connTimeout = setTimeout(() => {
        ws.terminate();
        settle(() => reject(new Error('connection timeout')));
      }, 10000);

      let authTimeout: NodeJS.Timeout | null = null;

      ws.on('open', () => {
        clearTimeout(connTimeout);
        console.log('[BiliClient] WebSocket connected');
        this.emit('connected');

        // 发送认证包
        const uid = this.config.uid ?? 0;
        const authPacket = makeAuthPacket(this.realRoomId, uid, token);
        ws.send(authPacket);

        // 认证超时（8s）：服务端接受连接但不响应认证视为失败
        authTimeout = setTimeout(() => {
          ws.terminate();
          settle(() => reject(new Error('auth timeout — no response from server')));
        }, 8000);
      });

      ws.on('message', async (data: Buffer) => {
        try {
          await this.handleMessage(data);
        } catch (err) {
          console.error('[BiliClient] Message parse error:', err);
        }
      });

      ws.on('error', (err) => {
        clearTimeout(connTimeout);
        if (authTimeout) clearTimeout(authTimeout);
        this.off('authenticated', onAuthenticated);
        console.error('[BiliClient] WebSocket error:', err);
        this.emit('error', err);
        settle(() => reject(err));
      });

      ws.on('close', (code, reason) => {
        clearTimeout(connTimeout);
        if (authTimeout) clearTimeout(authTimeout);
        this.off('authenticated', onAuthenticated);
        console.log(`[BiliClient] WebSocket closed: ${code} ${reason}`);
        this.cleanup();
        this.emit('disconnected', `${code} ${reason}`);

        if (!settled) {
          // 认证完成前断开 → 让 connectToServers 继续尝试下一台
          settle(() => reject(new Error(`closed before auth: ${code}`)));
        } else if (!this.stopped) {
          // 正常运行中断开 → 从头重连（重新获取 token + 选服务器）
          this.scheduleReconnect();
        }
      });

      // 认证成功回调
      const onAuthenticated = () => {
        if (authTimeout) clearTimeout(authTimeout);
        this.ws = ws;
        this.startHeartbeat();
        this.reconnectDelay = 1000; // 重置退避延迟
        settle(() => resolve());
      };

      this.once('authenticated', onAuthenticated);
    });
  }

  /**
   * 处理 WebSocket 消息
   */
  private async handleMessage(data: Buffer): Promise<void> {
    const packets = splitPackets(data);

    for (const packet of packets) {
      const parsed = await parsePacket(packet);
      if (!parsed) continue;

      switch (parsed.type) {
        case 'heartbeat':
          this.emit('popularity', parsed.popularity);
          break;

        case 'auth':
          if (parsed.success) {
            console.log('[BiliClient] Authenticated');
            this.emit('authenticated');
          } else {
            // 不打印完整响应体（可能含 uid / token 片段）
            const authCode = typeof parsed.data === 'object' && parsed.data !== null
              ? (parsed.data as Record<string, unknown>).code ?? '?'
              : parsed.data;
            console.error(`[BiliClient] Auth failed: code=${authCode}`);
            this.emit('error', new Error('Auth failed'));
            this.ws?.close();
          }
          break;

        case 'message':
          for (const msg of parsed.messages) {
            const event = convertToLiveEvent(msg, this.realRoomId);
            if (event) {
              console.log(`[BiliClient] Event received: type=${event.type}, uname=${event.uname || '(none)'}, text=${event.text?.slice(0, 50) || '(none)'}`);
              this.emit('event', event);
            }
          }
          break;
      }
    }
  }

  /**
   * 启动心跳（30秒）
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const packet = makeHeartbeatPacket();
        this.ws.send(packet);
      }
    }, 30000);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 计划重连（指数退避）
   */
  private scheduleReconnect(): void {
    if (this.stopped) return;

    this.cleanup();

    console.log(`[BiliClient] Reconnecting in ${this.reconnectDelay}ms`);
    this.reconnectTimer = setTimeout(() => {
      void this.start();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }
}
