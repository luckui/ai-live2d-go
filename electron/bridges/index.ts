/**
 * 桥接管理器
 *
 * 统一启停所有平台 Adapter。
 * main.ts 中调用 startBridges(conversationId) 即可。
 *
 * 新增平台只需：
 *   1. 在 adapters/ 下新建 xxx.ts 实现 { start(), stop() }
 *   2. 在 bridge.config.ts 加对应配置字段
 *   3. 在此文件 adapters 数组里注册
 */

import { loadBridgeConfig } from './bridge.config';
import { DiscordAdapter } from './adapters/discord';
import { WeChatAdapter } from './adapters/wechat';

interface Adapter {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

const activeAdapters: Adapter[] = [];

/**
 * 启动所有已启用的桥接 Adapter。
 *
 * @param conversationId 绑定的对话 ID（来自 main.ts 创建/加载的对话）
 */
export async function startBridges(conversationId: string): Promise<void> {
  // 在此刻读取配置，保证 dotenv.config() 已经执行完毕
  const bridgeConfig = loadBridgeConfig();

  // ── Discord ─────────────────────────────────────────────────────
  if (bridgeConfig.discord.enabled) {
    if (!bridgeConfig.discord.token) {
      console.warn('[Bridges] Discord 已启用但未配置 DISCORD_TOKEN，跳过启动');
    } else {
      // 注入对话 ID（优先用 .env 里手动指定的，否则用传入的当前对话）
      if (!bridgeConfig.discord.conversationId) {
        bridgeConfig.discord.conversationId = conversationId;
      }
      const adapter = new DiscordAdapter(bridgeConfig.discord);
      activeAdapters.push({ name: 'discord', start: () => adapter.start(), stop: () => adapter.stop() });
      await adapter.start().catch(e =>
        console.error('[Bridges] Discord 启动失败:', (e as Error).message)
      );
    }
  }

  // ── WeChat ───────────────────────────────────────────────────────
  if (bridgeConfig.wechat.enabled) {
    if (!bridgeConfig.wechat.token && !bridgeConfig.wechat.accountId) {
      console.warn('[Bridges] WeChat 已启用但未配置 token/accountId，请先通过 UI 完成二维码登录');
    } else {
      // 注入对话 ID
      if (!bridgeConfig.wechat.conversationId) {
        bridgeConfig.wechat.conversationId = conversationId;
      }
      const adapter = new WeChatAdapter(bridgeConfig.wechat);
      activeAdapters.push({ name: 'wechat', start: () => adapter.start(), stop: () => adapter.stop() });
      await adapter.start().catch(e =>
        console.error('[Bridges] WeChat 启动失败:', (e as Error).message)
      );
    }
  }

  // ── Telegram（预留）──────────────────────────────────────────────
  // if (bridgeConfig.telegram?.enabled) { ... }
}

/** 应用退出时调用，优雅断开所有平台连接 */
export async function stopBridges(): Promise<void> {
  await Promise.allSettled(
    activeAdapters.map(a =>
      a.stop().catch(e => console.error(`[Bridges] ${a.name} 停止失败:`, (e as Error).message))
    )
  );
  activeAdapters.length = 0;
}
