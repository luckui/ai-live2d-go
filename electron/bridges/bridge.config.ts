/**
 * 平台桥接配置
 *
 * 从 .env 加载（dotenv 在 main.ts 最顶部已调用，此处直接读 process.env）。
 *
 * .env 示例：
 *   DISCORD_ENABLED=true
 *   DISCORD_TOKEN=your_bot_token_here
 *   DISCORD_ALLOWED_CHANNELS=123456789,987654321   # 逗号分隔频道 ID，留空=全部
 *   DISCORD_CONVERSATION_ID=                        # 留空=自动使用最新对话
 */

export interface DiscordBridgeConfig {
  enabled: boolean;
  /** Bot Token，来自 Discord Developer Portal */
  token: string;
  /** 白名单频道 ID 列表，空数组=响应所有频道 */
  allowedChannels: string[];
  /**
   * 绑定的对话 ID（ai.config.ts 里的 conversationId）。
   * 留空时由 bridges/index.ts 在启动后自动注入最新对话 ID。
   */
  conversationId: string;
  /**
   * HTTP/HTTPS 代理地址，例如 http://127.0.0.1:7890
   * 国内环境访问 Discord 必须配置代理。留空则直连。
   */
  proxyUrl: string;
}

export interface BridgeConfig {
  discord: DiscordBridgeConfig;
  // telegram: TelegramBridgeConfig;  // 以后加
}

function parseBool(val: string | undefined, def = false): boolean {
  if (!val) return def;
  return val.toLowerCase() === 'true' || val === '1';
}

function parseList(val: string | undefined): string[] {
  if (!val) return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * 按需读取配置 —— 必须在 dotenv.config() 调用之后才调用此函数。
 *
 * 注意：不要在模块顶层直接调用，Rollup 打包后 bridge.config.ts
 * 的模块初始化代码早于 main.ts 里的 dotenv.config() 执行，
 * 会导致所有 env 变量读到 undefined。
 */
export function loadBridgeConfig(): BridgeConfig {
  const cfg: BridgeConfig = {
    discord: {
      enabled:         parseBool(process.env['DISCORD_ENABLED']),
      token:           process.env['DISCORD_TOKEN'] ?? '',
      allowedChannels: parseList(process.env['DISCORD_ALLOWED_CHANNELS']),
      conversationId:  process.env['DISCORD_CONVERSATION_ID'] ?? '',
      proxyUrl:        process.env['DISCORD_PROXY'] ?? '',
    },
  };
  console.log('[Bridges] 配置加载:', {
    discordEnabled: cfg.discord.enabled,
    hasToken:       !!cfg.discord.token,
    tokenLen:       cfg.discord.token.length,
    proxy:          cfg.discord.proxyUrl || '(无代理)',
  });
  return cfg;
}
