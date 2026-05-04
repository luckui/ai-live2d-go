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
    this.reconnectDelay = 1000;

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

  /**
   * 尝试连接服务器列表
   */
  private async connectToServers(
    servers: Array<{ host: string; port: number; wss_port: number }>,
    token: string
  ): Promise<void> {
    for (const server of servers) {
      if (this.stopped) return;

      try {
        const wsUrl = `wss://${server.host}:${server.wss_port}/sub`;
        console.log(`[BiliClient] Connecting to ${wsUrl}`);

        await this.connect(wsUrl, token);
        return; // 连接成功，退出循环
      } catch (err) {
        console.warn(`[BiliClient] Failed to connect to ${server.host}:`, err);
        continue; // 尝试下一个服务器
      }
    }

    throw new Error('All servers failed');
  }

  /**
   * 连接到单个 WebSocket 服务器
   */
  private connect(wsUrl: string, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...(this.config.cookie ? { Cookie: this.config.cookie } : {}),
        },
      });

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Connection timeout'));
      }, 10000);

      ws.on('open', () => {
        clearTimeout(timeout);
        console.log('[BiliClient] WebSocket connected');
        this.emit('connected');

        // 发送认证包
        const uid = this.config.uid ?? 0;
        const authPacket = makeAuthPacket(this.realRoomId, uid, token);
        ws.send(authPacket);
      });

      ws.on('message', async (data: Buffer) => {
        try {
          await this.handleMessage(data);
        } catch (err) {
          console.error('[BiliClient] Message parse error:', err);
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        console.error('[BiliClient] WebSocket error:', err);
        this.emit('error', err);
        reject(err);
      });

      ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        console.log(`[BiliClient] WebSocket closed: ${code} ${reason}`);
        this.cleanup();
        this.emit('disconnected', `${code} ${reason}`);
        
        if (!this.stopped) {
          this.scheduleReconnect();
        }
      });

      // 认证成功回调
      const onAuthenticated = () => {
        this.ws = ws;
        this.startHeartbeat();
        this.reconnectDelay = 1000; // 重置重连延迟
        resolve();
      };

      // 临时监听认证事件
      this.once('authenticated', onAuthenticated);
      
      // 超时后移除监听器
      setTimeout(() => {
        this.off('authenticated', onAuthenticated);
      }, 15000);
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
            console.error('[BiliClient] Auth failed:', parsed.data);
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
