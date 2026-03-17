/**
 * 浏览器会话单例
 *
 * 使用 launchPersistentContext 持久化浏览器 Profile（Cookie / LocalStorage /
 * 历史记录），并注入 Init Script 隐藏 webdriver 标志，尽量规避人机验证。
 *
 * 反检测策略：
 *   1. launchPersistentContext — Profile 存入 AppData，再次打开仍是"老用户"
 *   2. navigator.webdriver = undefined — 抹掉最常见的机器人识别标志
 *   3. headless: false — 使用有界面模式，避免 Headless 特征
 *   4. 真实 Chrome User-Agent
 */

import { chromium, type BrowserContext, type Page } from 'playwright';
import { join } from 'path';
import { app } from 'electron';

/** 浏览器 Profile 目录（Cookie 等持久化到此处） */
function getProfileDir(): string {
  return join(app.getPath('userData'), 'browser-profile');
}

/**
 * 注入到每个新页面的反检测脚本：
 * - 隐藏 navigator.webdriver
 * - 补全 chrome runtime 对象（部分网站检测此对象是否存在）
 * - 修复 permissions.query 返回值（有些检测会查询 notifications 权限）
 */
const STEALTH_SCRIPT = `
  // 1. 隐藏 webdriver 标志
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // 2. 补全 window.chrome
  if (!window.chrome) {
    window.chrome = { runtime: {} };
  }

  // 3. 修复 permissions.query（让 notifications 看起来是 denied 而非 prompt）
  const _query = window.navigator.permissions.query.bind(window.navigator.permissions);
  window.navigator.permissions.query = (params) =>
    params.name === 'notifications'
      ? Promise.resolve({ state: 'denied', onchange: null })
      : _query(params);

  // 4. 补全 plugins（空插件列表是常见机器人特征）
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });

  // 5. 语言设置
  Object.defineProperty(navigator, 'languages', {
    get: () => ['zh-CN', 'zh', 'en-US', 'en'],
  });
`;

class BrowserSession {
  private _context: BrowserContext | null = null;
  private _page: Page | null = null;

  /**
   * 获取或创建当前 Page，自动启动持久化浏览器。
   */
  async ensurePage(): Promise<Page> {
    // 上下文不存在或浏览器已断开，重新创建
    if (!this._context || !this._context.browser()?.isConnected()) {
      this._context = await chromium.launchPersistentContext(getProfileDir(), {
        headless: false,
        viewport: { width: 1280, height: 800 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled', // 关键：关闭自动化控制标志
          '--disable-dev-shm-usage',
          '--disable-infobars',
        ],
        ignoreDefaultArgs: ['--enable-automation'], // 去掉 --enable-automation 参数
      });

      // 注入反检测脚本到所有新页面
      await this._context.addInitScript(STEALTH_SCRIPT);
      this._page = null;
    }

    // 页面关闭或未创建，新建一个
    if (!this._page || this._page.isClosed()) {
      // 复用已有 pages（比如用户手动打开的标签）
      const pages = this._context.pages();
      this._page = pages.length > 0 ? pages[pages.length - 1] : await this._context.newPage();
    }

    return this._page;
  }

  /** 获取当前页面（不自动创建）；浏览器未打开时返回 null */
  get currentPage(): Page | null {
    return this._page && !this._page.isClosed() ? this._page : null;
  }

  /** 关闭浏览器并释放所有资源（Profile 数据保留在磁盘） */
  async close(): Promise<void> {
    await this._context?.close().catch(() => {});
    this._context = null;
    this._page = null;
  }
}

export const browserSession = new BrowserSession();
