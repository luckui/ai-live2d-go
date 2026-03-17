/**
 * 浏览器自动化工具集（基于 Playwright Chromium）
 *
 * 工具列表：
 *   browser_open       - 打开网址或搜索关键词
 *   browser_back       - 后退
 *   browser_refresh    - 刷新
 *   browser_wait       - 等待若干秒
 *   browser_click      - 点击元素
 *   browser_type       - 输入文字
 *   browser_scroll     - 滚动页面
 *   browser_hover      - 悬停元素
 *   browser_screenshot - 截取当前浏览器页面（返回图像给 AI）
 *
 * ── 选择器说明 ────────────────────────────────────────────────────
 * click / type / hover / scroll_to_element 接受 Playwright 定位器语法：
 *   text=提交          →  可见文字（最常用，从截图读取按钮文字即可）
 *   #search-input      →  CSS id
 *   .btn-primary       →  CSS class
 *   role=button[name=Search]   →  ARIA 角色+名称
 *   input[placeholder=搜索]    →  属性选择器
 * ─────────────────────────────────────────────────────────────────
 */

import { browserSession } from './browserSession';
import type { ToolDefinition, ToolImageResult } from '../types';

// ── 辅助函数 ──────────────────────────────────────────────────────

/** 等待页面加载稳定，超时不报错 */
async function waitSettle(ms = 5000): Promise<void> {
  const page = browserSession.currentPage;
  if (!page) return;
  await page.waitForLoadState('domcontentloaded', { timeout: ms }).catch(() => {});
}

/** 返回当前页面简短状态描述 */
async function pageInfo(): Promise<string> {
  const page = browserSession.currentPage;
  if (!page) return '（浏览器未打开）';
  const title = await page.title().catch(() => '（无标题）');
  return `"${title}" | ${page.url()}`;
}

// ── 1. browser_open ───────────────────────────────────────────────

interface OpenParams { query: string }

const browserOpen: ToolDefinition<OpenParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_open',
      description:
        '打开浏览器并导航到指定网址或搜索关键词。' +
        '如果参数是完整网址（以 http:// 或 https:// 开头），直接打开；' +
        '否则用 Google 搜索该关键词。' +
        '调用后建议用 browser_screenshot 查看页面内容。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              '网址（如 https://github.com）或搜索词（如 playwright 教程）',
          },
        },
        required: ['query'],
      },
    },
  },

  async execute({ query }) {
    const url = /^https?:\/\//i.test(query.trim())
      ? query.trim()
      : `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    const page = await browserSession.ensurePage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return `✅ 已打开 ${await pageInfo()}`;
  },
};

// ── 2. browser_back ───────────────────────────────────────────────

const browserBack: ToolDefinition<Record<string, never>> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_back',
      description: '浏览器后退到上一页。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  async execute() {
    const page = browserSession.currentPage;
    if (!page) return '❌ 浏览器未打开，请先调用 browser_open';
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
    return `✅ 已后退 → ${await pageInfo()}`;
  },
};

// ── 3. browser_refresh ────────────────────────────────────────────

const browserRefresh: ToolDefinition<Record<string, never>> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_refresh',
      description: '刷新当前浏览器页面。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  async execute() {
    const page = browserSession.currentPage;
    if (!page) return '❌ 浏览器未打开，请先调用 browser_open';
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    return `✅ 已刷新 → ${await pageInfo()}`;
  },
};

// ── 4. browser_wait ───────────────────────────────────────────────

interface WaitParams { seconds: number }

const browserWait: ToolDefinition<WaitParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_wait',
      description:
        '等待指定秒数，用于等待页面动态内容加载、动画完成或网络请求完成。' +
        '一般等 1-3 秒即可，不超过 10 秒。',
      parameters: {
        type: 'object',
        properties: {
          seconds: {
            type: 'number',
            description: '等待秒数（0.5 ~ 10）',
          },
        },
        required: ['seconds'],
      },
    },
  },

  async execute({ seconds }) {
    const ms = Math.max(200, Math.min(10000, Math.round(seconds * 1000)));
    await new Promise((resolve) => setTimeout(resolve, ms));
    return `✅ 已等待 ${seconds} 秒`;
  },
};

// ── 5. browser_click ──────────────────────────────────────────────

interface ClickParams { selector: string }

const browserClick: ToolDefinition<ClickParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_click',
      description:
        '点击页面上的元素。' +
        '推荐使用可见文字定位（text=提交），也可用 CSS（#btn）或 ARIA（role=button[name=搜索]）。' +
        '点击后若发生页面跳转会自动等待加载。',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description:
              'Playwright 定位器，例如：text=登录、#submit-btn、.search-button、' +
              'role=button[name=确定]、input[type=submit]',
          },
        },
        required: ['selector'],
      },
    },
  },

  async execute({ selector }) {
    const page = browserSession.currentPage;
    if (!page) return '❌ 浏览器未打开，请先调用 browser_open';

    await page.locator(selector).first().click({ timeout: 8000 });
    await waitSettle();
    return `✅ 已点击 [${selector}] → ${await pageInfo()}`;
  },
};

// ── 6. browser_type ───────────────────────────────────────────────

interface TypeParams { selector: string; text: string; submit?: boolean }

const browserType: ToolDefinition<TypeParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_type',
      description:
        '清空指定输入框并输入文字，可选提交（按 Enter）。' +
        '适用于搜索框、登录表单、文本域等输入场景。',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: '输入框定位器，如 input[name=q]、#username、role=textbox',
          },
          text: {
            type: 'string',
            description: '要输入的文字内容',
          },
          submit: {
            type: 'boolean',
            description: '输入完成后是否按 Enter 提交，默认 false',
          },
        },
        required: ['selector', 'text'],
      },
    },
  },

  async execute({ selector, text, submit = false }) {
    const page = browserSession.currentPage;
    if (!page) return '❌ 浏览器未打开，请先调用 browser_open';

    const locator = page.locator(selector).first();
    await locator.fill(text, { timeout: 8000 });

    if (submit) {
      await locator.press('Enter');
      await waitSettle();
    }

    return `✅ 已输入"${text}" → ${submit ? '已提交，' : ''}${await pageInfo()}`;
  },
};

// ── 7. browser_scroll ─────────────────────────────────────────────

interface ScrollParams {
  direction: 'up' | 'down' | 'left' | 'right';
  amount?: number;
}

const browserScroll: ToolDefinition<ScrollParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_scroll',
      description:
        '滚动当前页面，用于查看屏幕外的内容。' +
        '向下滚动可以看到更多内容，截图后判断是否还需要继续滚动。',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right'],
            description: '滚动方向',
          },
          amount: {
            type: 'number',
            description: '滚动像素数，默认 400',
          },
        },
        required: ['direction'],
      },
    },
  },

  async execute({ direction, amount = 400 }) {
    const page = browserSession.currentPage;
    if (!page) return '❌ 浏览器未打开，请先调用 browser_open';

    const dx =
      direction === 'left' ? -amount : direction === 'right' ? amount : 0;
    const dy =
      direction === 'up' ? -amount : direction === 'down' ? amount : 0;

    await page.evaluate(
      `window.scrollBy({ left: ${dx}, top: ${dy}, behavior: 'smooth' })`
    );
    // 等待滚动动画完成
    await new Promise((r) => setTimeout(r, 400));

    return `✅ 已向 ${direction} 滚动 ${amount}px`;
  },
};

// ── 8. browser_hover ──────────────────────────────────────────────

interface HoverParams { selector: string }

const browserHover: ToolDefinition<HoverParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_hover',
      description:
        '将鼠标悬停在页面元素上，用于触发下拉菜单、Tooltip、hover 状态等。' +
        '悬停后建议用 browser_screenshot 查看出现的新内容。',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: '要悬停的元素定位器，如 text=产品、#menu-item',
          },
        },
        required: ['selector'],
      },
    },
  },

  async execute({ selector }) {
    const page = browserSession.currentPage;
    if (!page) return '❌ 浏览器未打开，请先调用 browser_open';

    await page.locator(selector).first().hover({ timeout: 8000 });
    await new Promise((r) => setTimeout(r, 300));
    return `✅ 已悬停在 [${selector}]`;
  },
};

// ── 9. browser_screenshot ─────────────────────────────────────────

const browserScreenshot: ToolDefinition<Record<string, never>> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description:
        '截取当前浏览器页面的可见区域，以图像形式返回给 AI 分析。' +
        '这是最重要的辅助工具：导航后截图确认内容，根据截图决定下一步操作。' +
        '当不确定页面结构时，先截图观察再行动。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  async execute(): Promise<ToolImageResult> {
    const page = browserSession.currentPage;
    if (!page) {
      return {
        text: '❌ 浏览器未打开，请先调用 browser_open',
        imageBase64: '',
        mimeType: 'image/png',
      };
    }

    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    const title = await page.title().catch(() => '（无标题）');

    return {
      text: `📸 浏览器截图 | ${title} | ${page.url()}`,
      imageBase64: buffer.toString('base64'),
      mimeType: 'image/png',
    };
  },
};

// ── 导出工具列表 ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const browserTools: ToolDefinition<any>[] = [
  browserOpen,
  browserBack,
  browserRefresh,
  browserWait,
  browserClick,
  browserType,
  browserScroll,
  browserHover,
  browserScreenshot,
];
