/**
 * WeChat 桥接 Adapter
 *
 * 基于腾讯官方 iLink Bot API (https://ilinkai.weixin.qq.com)
 * 
 * 核心特性：
 *   - QR 码扫描登录（首次运行通过 UI 完成）
 *   - 长轮询接收消息（35 秒超时）
 *   - Context Token 管理（每个用户会话上下文）
 *   - 消息分片发送（速率限制保护）
 *
 * 参考：Hermes Agent gateway/platforms/weixin.py
 */

import type { WeChatBridgeConfig } from '../bridge.config';
import { sendChatMessage } from '../../aiService';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import QRCode from 'qrcode';

// ── Constants ────────────────────────────────────────────────────────

const ILINK_VER = '2.2.0';
const ILINK_CV = (2 << 16) | (2 << 8) | 0; // 131584
const CHANNEL_VERSION = '2.2.0';
const ILINK_APP_ID = 'bot';

const EP_GET_UPDATES = 'ilink/bot/getupdates';
const EP_SEND_MESSAGE = 'ilink/bot/sendmessage';
const EP_SEND_TYPING = 'ilink/bot/sendtyping';
const EP_GET_BOT_QR = 'ilink/bot/get_bot_qrcode';
const EP_GET_QR_STATUS = 'ilink/bot/get_qrcode_status';

const LONG_POLL_TIMEOUT_MS = 35_000;
const API_TIMEOUT_MS = 15_000;
const QR_TIMEOUT_MS = 35_000;

const ITEM_TEXT = 1;
const MSG_TYPE_USER = 1;
const MSG_STATE_FINISH = 2;

const MAX_MESSAGE_LENGTH = 4000;
const MAX_CONSECUTIVE_FAILURES = 3;
const RETRY_DELAY_SECONDS = 2;

// ── Types ────────────────────────────────────────────────────────────

interface ILinkMessage {
  from_user_id: string;
  to_user_id: string;
  client_id: string;
  message_type: number;
  message_state: number;
  context_token?: string;
  item_list: Array<{
    type: number;
    text_item?: { text: string };
    voice_item?: { text: string }; // 语音转文字
  }>;
}

interface GetUpdatesResponse {
  ret: number;
  msgs?: ILinkMessage[];
  get_updates_buf?: string;
  errmsg?: string;
}

interface QRCodeResponse {
  ret: number;
  qrcode?: string;
  qrcode_img_content?: string;
  errmsg?: string;
}

interface QRStatusResponse {
  ret: number;
  status?: string; // 'wait' | 'scaned' | 'confirmed' | 'expired'
  ilink_bot_id?: string;
  bot_token?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
  errmsg?: string;
}

interface AccountCredentials {
  accountId: string;
  token: string;
  baseUrl: string;
  userId?: string;
  savedAt: string;
}

// ── Helper Functions ─────────────────────────────────────────────────

function randomWeChatUin(): string {
  const value = Math.floor(Math.random() * 0xFFFFFFFF);
  return Buffer.from(String(value)).toString('base64');
}

function baseInfo() {
  return { channel_version: CHANNEL_VERSION };
}

function headers(token: string | null, body: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'Content-Length': String(Buffer.byteLength(body)),
    'X-WECHAT-UIN': randomWeChatUin(),
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(ILINK_CV),
  };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function ilinkPost(
  baseUrl: string,
  endpoint: string,
  payload: any,
  token: string | null,
  timeoutMs = API_TIMEOUT_MS
): Promise<any> {
  const url = `${baseUrl.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
  const bodyStr = JSON.stringify(payload);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(token, bodyStr),
      body: bodyStr,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const rawText = await res.text();

    if (!res.ok) {
      console.error(`[WeChat API] HTTP ${res.status} ${endpoint}: ${rawText.slice(0, 300)}`);
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    try {
      return JSON.parse(rawText);
    } catch {
      console.error(`[WeChat API] JSON 解析失败 ${endpoint}: ${rawText.slice(0, 300)}`);
      throw new Error(`Invalid JSON from ${endpoint}`);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as any).name === 'AbortError') {
      // 长轮询超时是正常情况，返回空结果
      if (endpoint === EP_GET_UPDATES) {
        return { ret: 0, msgs: [], get_updates_buf: (payload as any).get_updates_buf || '' };
      }
      throw new Error('Request timeout');
    }
    throw err;
  }
}

function splitMessage(text: string, maxLength = MAX_MESSAGE_LENGTH): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let cutAt = remaining.lastIndexOf('\n', maxLength);
    if (cutAt < maxLength / 2) cutAt = maxLength;
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).trimStart();
  }
  return chunks;
}

function extractText(msg: ILinkMessage): string {
  const parts: string[] = [];
  for (const item of msg.item_list || []) {
    if (item.type === ITEM_TEXT && item.text_item?.text) {
      parts.push(item.text_item.text);
    } else if (item.voice_item?.text) {
      // 语音消息的转文字
      parts.push(`[用户发送了语音消息：「${item.voice_item.text}」]`);
    }
  }
  return parts.join('\n').trim();
}

// ── Account Persistence ──────────────────────────────────────────────

function getAccountDir(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'wechat-accounts');
}

function getAccountFilePath(accountId: string): string {
  return path.join(getAccountDir(), `${accountId}.json`);
}

async function saveAccount(creds: AccountCredentials): Promise<void> {
  const dir = getAccountDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = getAccountFilePath(creds.accountId);
  await fs.writeFile(filePath, JSON.stringify(creds, null, 2), 'utf-8');
  console.log(`[WeChat] 账号已保存: ${filePath}`);
}

async function loadAccount(accountId: string): Promise<AccountCredentials | null> {
  try {
    const filePath = getAccountFilePath(accountId);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ── Context Token Store ──────────────────────────────────────────────

class ContextTokenStore {
  private cache = new Map<string, string>(); // accountId:userId -> token
  private accountId: string;

  constructor(accountId: string) {
    this.accountId = accountId;
  }

  private key(userId: string): string {
    return `${this.accountId}:${userId}`;
  }

  get(userId: string): string | undefined {
    return this.cache.get(this.key(userId));
  }

  set(userId: string, token: string): void {
    this.cache.set(this.key(userId), token);
  }

  async restore(): Promise<void> {
    try {
      const dir = getAccountDir();
      const filePath = path.join(dir, `${this.accountId}.context-tokens.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      this.cache = new Map(Object.entries(data));
      console.log(`[WeChat] Context tokens 已恢复: ${this.cache.size} 条`);
    } catch {
      // 文件不存在或损坏，忽略
    }
  }

  async save(): Promise<void> {
    try {
      const dir = getAccountDir();
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${this.accountId}.context-tokens.json`);
      const data = Object.fromEntries(this.cache.entries());
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[WeChat] Context tokens 保存失败:', err);
    }
  }
}

// ── Sync Buffer Store ────────────────────────────────────────────────

async function loadSyncBuf(accountId: string): Promise<string> {
  try {
    const dir = getAccountDir();
    const filePath = path.join(dir, `${accountId}.sync.json`);
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return data.get_updates_buf || '';
  } catch {
    return '';
  }
}

async function saveSyncBuf(accountId: string, buf: string): Promise<void> {
  try {
    const dir = getAccountDir();
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${accountId}.sync.json`);
    await fs.writeFile(filePath, JSON.stringify({ get_updates_buf: buf }, null, 2), 'utf-8');
  } catch (err) {
    console.error('[WeChat] Sync buffer 保存失败:', err);
  }
}

// ── QR Login (Exported for UI) ───────────────────────────────────────

export interface QRLoginState {
  qrcode: string;
  qrcodeUrl: string;
  status: 'pending' | 'scanned' | 'confirmed' | 'expired' | 'error';
  credentials?: AccountCredentials;
  error?: string;
}

/**
 * QR 码登录流程（被 UI 调用）
 * 
 * @returns AsyncGenerator<QRLoginState> - 状态更新流
 */
export async function* qrLogin(baseUrl = 'https://ilinkai.weixin.qq.com'): AsyncGenerator<QRLoginState> {
  let qrcode = '';
  let qrcodeUrl = '';
  let currentBaseUrl = baseUrl;

  try {
    // 步骤 1: 获取二维码
    const qrResp: QRCodeResponse = await ilinkPost(
      currentBaseUrl,
      `${EP_GET_BOT_QR}?bot_type=3`,
      {},
      null,
      QR_TIMEOUT_MS
    );

    if ((qrResp.ret !== undefined && qrResp.ret !== 0) || !qrResp.qrcode) {
      yield { qrcode: '', qrcodeUrl: '', status: 'error', error: qrResp.errmsg || '获取二维码失败' };
      return;
    }

    qrcode = qrResp.qrcode;
    // qrcode_img_content 是微信 URL，需转成 data URI 才能在 <img> 中展示
    const rawUrl = qrResp.qrcode_img_content || qrcode;
    qrcodeUrl = await QRCode.toDataURL(rawUrl, { width: 256, margin: 2 });
    yield { qrcode, qrcodeUrl, status: 'pending' };

    // 步骤 2: 轮询状态（最多 8 分钟）
    const deadline = Date.now() + 480_000;
    let refreshCount = 0;

    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      try {
        const statusResp: QRStatusResponse = await ilinkPost(
          currentBaseUrl,
          `${EP_GET_QR_STATUS}?qrcode=${qrcode}`,
          {},
          null,
          QR_TIMEOUT_MS
        );

        const status = statusResp.status || 'wait';

        if (status === 'scaned') {
          yield { qrcode, qrcodeUrl, status: 'scanned' };
        } else if (status === 'scaned_but_redirect') {
          if (statusResp.redirect_host) {
            currentBaseUrl = `https://${statusResp.redirect_host}`;
          }
        } else if (status === 'expired') {
          refreshCount++;
          if (refreshCount > 3) {
            yield { qrcode, qrcodeUrl, status: 'expired', error: '二维码多次过期' };
            return;
          }
          // 刷新二维码
          const newQrResp: QRCodeResponse = await ilinkPost(
            baseUrl,
            `${EP_GET_BOT_QR}?bot_type=3`,
            {},
            null,
            QR_TIMEOUT_MS
          );
          if (newQrResp.qrcode) {
            qrcode = newQrResp.qrcode;
            const newRawUrl = newQrResp.qrcode_img_content || qrcode;
            qrcodeUrl = await QRCode.toDataURL(newRawUrl, { width: 256, margin: 2 });
            yield { qrcode, qrcodeUrl, status: 'pending' };
          }
        } else if (status === 'confirmed') {
          // 登录成功！
          const accountId = statusResp.ilink_bot_id || '';
          const token = statusResp.bot_token || '';
          const baseUrl = statusResp.baseurl || currentBaseUrl;
          const userId = statusResp.ilink_user_id || '';

          if (!accountId || !token) {
            yield { qrcode, qrcodeUrl, status: 'error', error: '凭证不完整' };
            return;
          }

          const creds: AccountCredentials = {
            accountId,
            token,
            baseUrl,
            userId,
            savedAt: new Date().toISOString(),
          };

          await saveAccount(creds);
          yield { qrcode, qrcodeUrl, status: 'confirmed', credentials: creds };
          return;
        }
      } catch (err) {
        console.warn('[WeChat] QR 轮询错误:', err);
        // 继续重试
      }
    }

    yield { qrcode, qrcodeUrl, status: 'expired', error: '登录超时' };
  } catch (err) {
    yield { qrcode, qrcodeUrl, status: 'error', error: String(err) };
  }
}

// ── WeChat Adapter ───────────────────────────────────────────────────

export class WeChatAdapter {
  /** 当 WeChat Bot 在线时指向实例；停止后置 null */
  static activeAdapter: WeChatAdapter | null = null;

  private cfg: WeChatBridgeConfig;
  private token!: string;
  private accountId!: string;
  private baseUrl!: string;
  private tokenStore!: ContextTokenStore;
  private syncBuf = '';
  private running = false;
  private pollLoopPromise: Promise<void> | null = null;

  constructor(cfg: WeChatBridgeConfig) {
    this.cfg = cfg;
  }

  async start(): Promise<void> {
    // 加载或验证 token
    if (!this.cfg.token || !this.cfg.accountId) {
      // 尝试从磁盘加载最新账号
      const dir = getAccountDir();
      try {
        const files = await fs.readdir(dir);
        const accountFiles = files.filter(f => f.endsWith('.json') && !f.includes('context-tokens') && !f.includes('sync'));
        if (accountFiles.length > 0) {
          const latestFile = accountFiles.sort().reverse()[0];
          const accountId = latestFile.replace('.json', '');
          const creds = await loadAccount(accountId);
          if (creds) {
            this.cfg.token = creds.token;
            this.cfg.accountId = creds.accountId;
            this.cfg.baseUrl = creds.baseUrl;
            console.log(`[WeChat] 使用已保存账号: ${accountId}`);
          }
        }
      } catch {
        // 目录不存在或读取失败
      }

      if (!this.cfg.token || !this.cfg.accountId) {
        throw new Error('WeChat 未配置 token/accountId，请先通过 UI 完成二维码登录');
      }
    }

    this.token = this.cfg.token;
    this.accountId = this.cfg.accountId;
    this.baseUrl = this.cfg.baseUrl || 'https://ilinkai.weixin.qq.com';
    this.tokenStore = new ContextTokenStore(this.accountId);

    // 恢复状态
    await this.tokenStore.restore();
    this.syncBuf = await loadSyncBuf(this.accountId);

    console.log(`[WeChat] 启动中... accountId=${this.accountId.slice(0, 8)}*** baseUrl=${this.baseUrl}`);
    console.log(`[WeChat] conversationId=${this.cfg.conversationId || '(未绑定，将在 startBridges 中注入)'}`);

    this.running = true;
    WeChatAdapter.activeAdapter = this;
    this.pollLoopPromise = this.pollLoop();
    console.log('[WeChat] 长轮询已启动，等待消息...');
  }

  async stop(): Promise<void> {
    this.running = false;
    WeChatAdapter.activeAdapter = null;
    if (this.pollLoopPromise) {
      await this.pollLoopPromise;
    }
    await this.tokenStore.save();
    await saveSyncBuf(this.accountId, this.syncBuf);
    console.log('[WeChat] Bot 已下线');
  }

  private async pollLoop(): Promise<void> {
    let consecutiveFailures = 0;

    while (this.running) {
      try {
        const resp: GetUpdatesResponse = await ilinkPost(
          this.baseUrl,
          EP_GET_UPDATES,
          {
            get_updates_buf: this.syncBuf,
            base_info: baseInfo(),
          },
          this.token,
          LONG_POLL_TIMEOUT_MS + 5000 // 稍长于长轮询超时
        );

        if (resp.ret === undefined || resp.ret === 0) {
          consecutiveFailures = 0;
          this.syncBuf = resp.get_updates_buf || this.syncBuf;
          await saveSyncBuf(this.accountId, this.syncBuf);

          if (resp.msgs && resp.msgs.length > 0) {
            console.log(`[WeChat] 收到 ${resp.msgs.length} 条消息`);
            for (const msg of resp.msgs) {
              await this.handleMessage(msg).catch(err =>
                console.error('[WeChat] 消息处理失败:', err)
              );
            }
          }
        } else {
          console.warn(`[WeChat] getUpdates 异常响应:`, JSON.stringify(resp).slice(0, 500));
          consecutiveFailures++;
        }
      } catch (err) {
        console.error('[WeChat] 轮询错误:', (err as Error).message);
        consecutiveFailures++;
      }

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error('[WeChat] 连续失败次数过多，暂停 30 秒');
        await new Promise(resolve => setTimeout(resolve, 30_000));
        consecutiveFailures = 0;
      } else if (consecutiveFailures > 0) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_SECONDS * 1000));
      }
    }
  }

  private async handleMessage(msg: ILinkMessage): Promise<void> {
    // 仅处理用户发来的消息
    if (msg.message_type !== MSG_TYPE_USER) return;
    if (msg.message_state !== MSG_STATE_FINISH) return;

    const fromUserId = msg.from_user_id;
    const contextToken = msg.context_token;
    const text = extractText(msg);

    if (!text) return;

    // 更新 context token
    if (contextToken) {
      this.tokenStore.set(fromUserId, contextToken);
    }

    console.log(`[WeChat] 收到消息 from=${fromUserId.slice(0, 8)}***: ${text.slice(0, 50)}`);

    const conversationId = this.cfg.conversationId;
    if (!conversationId) {
      console.warn('[WeChat] 未绑定 conversationId，忽略消息');
      return;
    }

    // 发送 typing 状态
    await this.sendTyping(fromUserId, true);

    try {
      const platformTag = `[来源：WeChat | 用户：${fromUserId}]`;
      const taggedContent = `${platformTag}\n${text}`;
      const result = await sendChatMessage(conversationId, taggedContent);

      // 分片发送回复
      const chunks = splitMessage(result.content);
      for (const chunk of chunks) {
        await this.sendText(fromUserId, chunk);
        if (chunks.length > 1 && this.cfg.sendChunkDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, this.cfg.sendChunkDelay * 1000));
        }
      }
    } catch (err) {
      const errMsg = String(err);
      console.error('[WeChat] 消息处理失败:', errMsg);
      await this.sendText(fromUserId, `❌ AI 响应出错：${errMsg.slice(0, 100)}`);
    } finally {
      await this.sendTyping(fromUserId, false);
    }
  }

  private async sendText(userId: string, text: string): Promise<void> {
    const contextToken = this.tokenStore.get(userId);
    const payload = {
      msg: {
        from_user_id: '',
        to_user_id: userId,
        client_id: `lp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        message_type: 2, // bot -> user
        message_state: MSG_STATE_FINISH,
        context_token: contextToken,
        item_list: [
          {
            type: ITEM_TEXT,
            text_item: { text },
          },
        ],
      },
      base_info: baseInfo(),
    };

    await ilinkPost(this.baseUrl, EP_SEND_MESSAGE, payload, this.token);
  }

  private async sendTyping(userId: string, isTyping: boolean): Promise<void> {
    try {
      await ilinkPost(
        this.baseUrl,
        EP_SEND_TYPING,
        {
          to_user_id: userId,
          typing: isTyping ? 1 : 2,
          base_info: baseInfo(),
        },
        this.token,
        5000
      );
    } catch {
      // 忽略 typing 错误
    }
  }
}
