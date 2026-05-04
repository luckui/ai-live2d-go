/**
 * 直播平台适配器工厂
 * 支持多平台扩展
 */

import { EventEmitter } from 'events';
import type { LiveEvent, LivePlatform, StreamerSessionConfig } from '../types';
import { BiliClient } from './bilibili/biliClient';

export interface PlatformAdapter extends EventEmitter {
  start(): Promise<void>;
  stop(): void;
  on(event: 'event', listener: (event: LiveEvent) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'connected' | 'authenticated' | 'disconnected', listener: () => void): this;
}

/**
 * 创建平台适配器
 */
export function createPlatformAdapter(
  config: StreamerSessionConfig,
  cookie?: string
): PlatformAdapter {
  switch (config.platform) {
    case 'bilibili': {
      // 从 Cookie 提取 uid（如果有）
      let uid: number | undefined;
      if (cookie) {
        const match = /DedeUserID=(\d+)/.exec(cookie);
        if (match) {
          uid = parseInt(match[1], 10);
        }
      }

      return new BiliClient({
        roomId: config.roomId,
        uid,
        cookie,
      });
    }

    default:
      throw new Error(`Unsupported platform: ${config.platform}`);
  }
}

/**
 * 获取平台显示名称
 */
export function getPlatformDisplayName(platform: LivePlatform): string {
  const names: Record<LivePlatform, string> = {
    bilibili: 'B站直播',
  };
  return names[platform] || platform;
}

/**
 * 验证平台配置
 */
export function validatePlatformConfig(config: StreamerSessionConfig): string | null {
  if (!config.roomId || config.roomId <= 0) {
    return 'Invalid room_id';
  }

  switch (config.platform) {
    case 'bilibili':
      // B站直播间 ID 通常是正整数
      if (!Number.isInteger(config.roomId)) {
        return 'Bilibili room_id must be an integer';
      }
      return null;

    default:
      return `Unsupported platform: ${config.platform}`;
  }
}
