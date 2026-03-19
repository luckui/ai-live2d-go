/**
 * Discord 桥接 Adapter
 *
 * 职责：监听 Discord 频道消息 → 转发给 sendChatMessage → 把回复发回频道。
 * 完全无业务逻辑，只做消息搬运。
 *
 * 特性：
 *   - 忽略 Bot 自身消息（防止自响应死循环）
 *   - 支持频道白名单过滤
 *   - 消息超长时自动分段（Discord 单条上限 2000 字符）
 *   - 打字指示器（typing）：AI 思考期间显示"正在输入..."
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  Message,
  TextChannel,
} from 'discord.js';
import { ProxyAgent } from 'undici';
import * as net from 'node:net';
import * as tls from 'node:tls';
import type { DiscordBridgeConfig } from '../bridge.config';
import { sendChatMessage } from '../../aiService';

const DISCORD_MAX_LEN = 1900; // 留 100 字符余量

/** 把长文本按 Discord 限制切段 */
function splitMessage(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_LEN) {
      chunks.push(remaining);
      break;
    }
    // 尽量在换行处切断
    let cutAt = remaining.lastIndexOf('\n', DISCORD_MAX_LEN);
    if (cutAt < DISCORD_MAX_LEN / 2) cutAt = DISCORD_MAX_LEN;
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).trimStart();
  }
  return chunks;
}

export class DiscordAdapter {
  private client: Client;
  private cfg: DiscordBridgeConfig;

  constructor(cfg: DiscordBridgeConfig) {
    this.cfg = cfg;
    // REST 代理：undici ProxyAgent 只支持 http/https。socks5 跳过，REST 会直连。
    const parsedProxy = cfg.proxyUrl ? (() => { try { return new URL(cfg.proxyUrl); } catch { return null; } })() : null;
    const restOptions = parsedProxy && (parsedProxy.protocol === 'http:' || parsedProxy.protocol === 'https:')
      ? { agent: new ProxyAgent(cfg.proxyUrl) }
      : {};
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
      rest: restOptions,
    });
  }

  async start(): Promise<void> {
    const { token, allowedChannels } = this.cfg;

    // WebSocket 代理：覆盖 ws 包的 createConnection
    // （ws 自己设 opts.createConnection = tlsConnect 会绕过 agent，必须提前注入）
    if (this.cfg.proxyUrl) {
      await this._setupWsProxy(this.cfg.proxyUrl);
    }

    // ── 诊断用事件监听（帮助定位卡住位置）──────────────────────
    this.client.on('error', (error) => {
      console.error('[Discord] 客户端错误:', error.message);
    });
    this.client.on('warn', (info) => {
      console.warn('[Discord] 警告:', info);
    });
    this.client.on('debug', (info) => {
      // 只打印 Gateway / WebSocket 相关日志，避免刷屏
      if (/gateway|websocket|identify|hello|ready|session|heartbeat|shard/i.test(info)) {
        console.log('[Discord Debug]', info.slice(0, 500));
      }
    });

    this.client.once('ready', () => {
      console.log(`[Discord] Bot 已上线：${this.client.user?.tag}`);
    });

    this.client.on('messageCreate', async (msg: Message) => {
      // 忽略 Bot 自身和其他 Bot
      if (msg.author.bot) return;

      // 白名单过滤
      if (allowedChannels.length > 0 && !allowedChannels.includes(msg.channelId)) return;

      const content = msg.content.trim();
      if (!content) return;

      const conversationId = this.cfg.conversationId;
      if (!conversationId) {
        await msg.reply('⚠️ 未绑定对话 ID，请检查配置。');
        return;
      }

      // 打字指示器（仅支持 sendTyping 的频道类型）
      if ('sendTyping' in msg.channel && typeof msg.channel.sendTyping === 'function') {
        (msg.channel.sendTyping as () => Promise<void>)().catch(() => {});
      }

      try {
        const result = await sendChatMessage(conversationId, content);
        const chunks = splitMessage(result.content);
        for (const chunk of chunks) {
          await msg.reply(chunk);
        }
      } catch (e) {
        const errMsg = (e as Error).message ?? String(e);
        console.error('[Discord] 消息处理失败:', errMsg);
        await msg.reply(`❌ AI 响应出错：${errMsg.slice(0, 200)}`).catch(() => {});
      }
    });

    console.log('[Discord] 正在调用 login()...');
    await this.client.login(token);
    console.log('[Discord] login() 已返回，等待 ready 事件...');
  }

  /**
   * 覆盖 ws 包的 createConnection，让 WebSocket 握手走代理。
   *
   * ws 内部：opts.createConnection = opts.createConnection || tlsConnect
   * 我们提前注入，|| 短路，ws 就不会再覆盖为 tlsConnect。
   *
   * 支持：
   *   http(s)://  → 手动 HTTP CONNECT 隧道 + TLS
   *   socks5://   → socks 包建立 SOCKS5 隧道 + TLS
   */
  private async _setupWsProxy(proxyUrl: string): Promise<void> {
    const parsed = new URL(proxyUrl);
    const proxyHost = parsed.hostname;
    const isSocks = parsed.protocol === 'socks5:' || parsed.protocol === 'socks4:' || parsed.protocol === 'socks:';

    type ConnCb = (err: Error | null, socket?: tls.TLSSocket) => void;
    let wsCreateConnection: (opts: Record<string, unknown>, cb: ConnCb) => void;

    if (isSocks) {
      const { SocksClient } = await import('socks');
      const proxyPort = parseInt(parsed.port || '1080');
      const socksType = parsed.protocol === 'socks4:' ? 4 : 5;

      wsCreateConnection = (opts, cb) => {
        SocksClient.createConnection({
          proxy: { host: proxyHost, port: proxyPort, type: socksType as 4 | 5 },
          command: 'connect',
          destination: { host: opts.host as string, port: (opts.port as number) || 443 },
        })
          .then(({ socket }) => {
            const tlsSocket = tls.connect({
              socket,
              servername: (opts.servername as string) || (opts.host as string),
              rejectUnauthorized: true,
            });
            tlsSocket.on('error', cb);
            tlsSocket.once('secureConnect', () => cb(null, tlsSocket));
          })
          .catch((e: Error) => cb(e));
      };
      console.log(`[Discord] SOCKS5 WebSocket 代理：${proxyUrl}`);
    } else {
      // HTTP(S) 代理：手动 CONNECT 隧道 + TLS
      const proxyPort = parseInt(parsed.port || '8080');

      wsCreateConnection = (opts, cb) => {
        const tcp = net.connect(proxyPort, proxyHost, () => {
          const host = opts.host as string;
          const port = (opts.port as number) || 443;
          tcp.write(
            `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\nProxy-Connection: keep-alive\r\n\r\n`
          );
          let buf = '';
          const onData = (chunk: Buffer) => {
            buf += chunk.toString('utf8');
            if (!buf.includes('\r\n\r\n')) return; // 头还没读完
            tcp.removeListener('data', onData);
            const code = parseInt((buf.split(' ')[1] ?? '0'));
            if (code !== 200) {
              tcp.destroy();
              cb(new Error(`HTTP CONNECT 失败，代理返回：${code}`));
              return;
            }
            const tlsSocket = tls.connect({
              socket: tcp,
              servername: (opts.servername as string) || host,
              rejectUnauthorized: true,
            });
            tlsSocket.on('error', cb);
            tlsSocket.once('secureConnect', () => cb(null, tlsSocket));
          };
          tcp.on('data', onData);
        });
        tcp.on('error', cb);
      };
      console.log(`[Discord] HTTP CONNECT WebSocket 代理：${proxyUrl}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wsModule = require('ws') as { WebSocket: new (...args: any[]) => any };
    const OrigWS = wsModule.WebSocket;
    wsModule.WebSocket = class PatchedWS extends OrigWS {
      constructor(...args: any[]) {
        // 提前写入 createConnection，ws 的 || 赋值就不会覆盖
        args[2] = { ...(args[2] as Record<string, unknown> ?? {}), createConnection: wsCreateConnection };
        super(...args);
      }
    } as any;
  }

  async stop(): Promise<void> {
    this.client.destroy();
    console.log('[Discord] Bot 已下线');
  }
}
