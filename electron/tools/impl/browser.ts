/**
 * 浏览器自动化工具集（基于 Playwright Chromium）
 *
 * 工具列表：
 *    1. browser_open        - 打开网址或搜索关键词
 *    2. browser_back        - 后退
 *    3. browser_refresh     - 刷新
 *    4. browser_wait        - 等待若干秒
 *    5. browser_click       - 点击元素（Playwright 定位器）
 *    6. browser_type        - 输入文字到普通表单（input/textarea）
 *    7. browser_scroll      - 滚动页面
 *    8. browser_hover       - 悬停触发下拉/Tooltip
 *    9. browser_screenshot  - 截图（返回图像给 AI 分析）
 *   10. browser_list_tabs   - 列出所有标签页
 *   11. browser_js_click    - JS 原生 click()，绕过可操作性检查（最终兜底）
 *   12. browser_switch_tab  - 切换标签页
 *   13. browser_get_inputs  - 扫描表单输入字段（含富文本编辑器），填表前必须调用
 *   14. browser_get_buttons - 扫描可点击按钮，点击前先调用
 *   15. browser_type_rich   - 向富文本编辑器（contenteditable div）输入文字
 *
 * ── 使用决策树 ───────────────────────────────────────────────────
 *
 *  【填写普通表单（input/textarea：登录框/搜索框）】
 *    browser_get_inputs → 拿到 selector（type ≠ rich-editor）→ browser_type
 *
 *  【填写富文本编辑器（contenteditable div：wangEditor/Quill/TipTap/Slate）】
 *    browser_get_inputs → 拿到 selector（type = rich-editor）→ browser_type_rich
 *
 *  【点击按钮（登录/提交/确认）】
 *    ① browser_get_buttons                      → 扫描全部按钮，拿到 Playwright + CSS selector
 *    ② browser_click(Playwright selector)        → 标准点击，首选
 *    ③ browser_click(Playwright sel, force=true) → ②超时时强制点击
 *    ④ browser_js_click(CSS selector)            → ③仍失败时 JS 原生点击（最终兜底）
 *
 *  【观察/确认页面状态】
 *    browser_screenshot  →  截图，从图像判断当前状态再决策
 *
 *  【多标签页场景】
 *    browser_list_tabs  →  browser_switch_tab
 *
 * ── 选择器说明 ────────────────────────────────────────────────────
 * browser_click / browser_type / browser_hover 接受 Playwright 定位器：
 *   text=提交          →  可见文字（browser_get_buttons 会直接提供此格式）
 *   #search-input      →  CSS id
 *   .btn-primary       →  CSS class
 *   role=button[name=Search]   →  ARIA 角色+名称
 *   input[placeholder=搜索]    →  属性选择器
 * browser_js_click 只接受标准 CSS 选择器（browser_get_buttons 会直接提供）
 * ─────────────────────────────────────────────────────────────────
 */

import { nativeImage } from 'electron';
import { browserSession } from './browserSession';
import type { ToolDefinition, ToolImageResult } from '../types';

/** 浏览器截图最大宽度，超出等比缩小 */
const SCREENSHOT_MAX_WIDTH = 1280;

// ── 辅助函数 ──────────────────────────────────────────────────────

/** 等待页面加载稳定，超时不报错 */
async function waitSettle(ms = 5000): Promise<void> {
  const page = browserSession.currentPage;
  if (!page) return;
  await page.waitForLoadState('domcontentloaded', { timeout: ms }).catch(() => {});
}

/** 返回当前页面简短状态描述（含 tab 索引） */
async function pageInfo(): Promise<string> {
  const page = browserSession.currentPage;
  if (!page) return '（浏览器未打开）';
  const title = await page.title().catch(() => '（无标题）');
  const all = browserSession.pages;
  const idx = all.indexOf(page);
  const tabTag = all.length > 1 ? ` [Tab ${idx + 1}/${all.length}]` : '';
  return `"${title}"${tabTag} | ${page.url()}`;
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

interface ClickParams { selector: string; force?: boolean }

const browserClick: ToolDefinition<ClickParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_click',
      description:
        '点击页面上的元素（决策树第②/③步）。' +
        '【重要】点击按钮前先调用 browser_get_buttons 扫描页面，' +
        '直接使用返回的"Playwright selector"列（如 text=登录、#submit-btn），无需从截图猜测。' +
        '点击后若发生页面跳转会自动等待加载。' +
        '如果点击超时（元素被遮罩/pointer-events:none），设 force=true 进入第③步强制点击；' +
        '若③仍失败，使用 browser_get_buttons 返回的"CSS selector"调用 browser_js_click（第④步）。',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description:
              'Playwright 定位器，例如：text=登录、#submit-btn、.search-button、' +
              'role=button[name=确定]、input[type=submit]',
          },
          force: {
            type: 'boolean',
            description:
              '是否强制点击（绕过 pointer-events/visibility 检查）。' +
              '当标准点击无反应时设为 true，默认 false。',
          },
        },
        required: ['selector'],
      },
    },
  },

  async execute({ selector, force = false }) {
    const page = browserSession.currentPage;
    if (!page) return '❌ 浏览器未打开，请先调用 browser_open';

    try {
      await page.locator(selector).first().click({ timeout: 8000, force });
    } catch (e) {
      const msg = (e as Error).message ?? '';
      const isTimeout = msg.includes('Timeout') || msg.includes('timeout');
      if (isTimeout && !force) {
        return `⚠️ 点击超时 [${selector}]：元素可能被遮罩或设置了 pointer-events:none。` +
          `\n建议：① 先截图确认按钮状态；② 重试时加 force=true；③ 若仍无效改用 browser_js_click。`;
      }
      if (isTimeout && force) {
        return `⚠️ 强制点击也超时 [${selector}]：请改用 browser_js_click（传入 CSS 选择器如 button.login、#login-btn）。`;
      }
      return `❌ 点击失败 [${selector}]：${msg.slice(0, 120)}`;
    }
    await waitSettle();
    return `✅ 已点击 [${selector}]${force ? ' (force)' : ''} → ${await pageInfo()}`;
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
        '仅适用于普通表单元素（input / textarea / select），' +
        '对 contenteditable 富文本编辑器（type=rich-editor）无效，请改用 browser_type_rich。' +
        '【重要】填写表单前必须先调用 browser_get_inputs 获取精确 selector，' +
        '不要用模糊 selector（如 role=textbox、input）以免填错字段。' +
        '特别注意：密码框 type=password，selector 应为 input[type="password"] 或对应 id/name，' +
        '不可用昵称/用户名框的 selector 代替。',
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

    const rawBuffer = await page.screenshot({ type: 'png', fullPage: false });
    // 等比压缩，超过 1280px 才缩小（减少 token 开销）
    let img = nativeImage.createFromBuffer(rawBuffer);
    const { width } = img.getSize();
    if (width > SCREENSHOT_MAX_WIDTH) {
      img = nativeImage.createFromBuffer(
        img.resize({ width: SCREENSHOT_MAX_WIDTH }).toPNG()
      );
    }
    const buffer = img.toPNG();
    const title = await page.title().catch(() => '（无标题）');
    const all = browserSession.pages;
    const idx = all.indexOf(page);
    const tabTag = all.length > 1 ? ` [Tab ${idx + 1}/${all.length}]` : '';

    return {
      text: `📸 浏览器截图${tabTag} | ${title} | ${page.url()}`,
      imageBase64: buffer.toString('base64'),
      mimeType: 'image/png',
    };
  },
};

// ── 10. browser_list_tabs ────────────────────────────────────────

const browserListTabs: ToolDefinition<Record<string, never>> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_list_tabs',
      description:
        '列出当前浏览器所有打开的 tab（标签页），显示每个 tab 的序号、标题和网址。' +
        '当不确定现在有几个 tab、用户看到的是哪个页面时，先调用此工具确认。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  async execute() {
    const all = browserSession.pages;
    if (all.length === 0) return '❌ 浏览器未打开任何页面';
    const current = browserSession.currentPage;
    const lines = await Promise.all(
      all.map(async (p, i) => {
        const title = await p.title().catch(() => '（无标题）');
        const mark = p === current ? ' ◀ 当前' : '';
        return `  [${i + 1}] "${title}" | ${p.url()}${mark}`;
      })
    );
    return `📋 共 ${all.length} 个 tab：\n${lines.join('\n')}`;
  },
};

// ── 12. browser_switch_tab ────────────────────────────────────────

interface SwitchTabParams { index: number }

const browserSwitchTab: ToolDefinition<SwitchTabParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_switch_tab',
      description:
        '切换到指定序号的 tab（从 1 开始计数）。' +
        '当点击链接或按钮后产生了新 tab、或需要切换到另一个已打开的页面时使用。' +
        '切换后建议立刻用 browser_screenshot 确认页面内容。',
      parameters: {
        type: 'object',
        properties: {
          index: {
            type: 'number',
            description: 'tab 序号，从 1 开始（用 browser_list_tabs 查看序号）',
          },
        },
        required: ['index'],
      },
    },
  },

  async execute({ index }) {
    const all = browserSession.pages;
    if (all.length === 0) return '❌ 浏览器未打开任何页面';
    if (index < 1 || index > all.length) {
      return `❌ 序号 ${index} 超出范围，当前共 ${all.length} 个 tab（1~${all.length}）`;
    }
    browserSession.switchToPage(index - 1); // switchToPage 接受 0-based index
    return `✅ 已切换 → ${await pageInfo()}`;
  },
};

// ── 11. browser_js_click ─────────────────────────────────────────

/**
 * 通过 JavaScript 直接调用目标元素的 .click() 方法，完全绕过 Playwright
 * 的可操作性检查（pointer-events、visibility、滚动位置等）。
 * 适用场景：
 *   - 元素有 pointer-events:none 但实际绑定了 JS 事件
 *   - 按钮被其他元素遮盖（透明遮罩等）
 *   - browser_click 反复无效时的最后手段
 */
interface JsClickParams { selector: string }

const browserJsClick: ToolDefinition<JsClickParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_js_click',
      description:
        '通过 JavaScript 直接触发元素的 click() 事件，完全绕过浏览器的可操作性检查（决策树第④步，最终兜底）。' +
        '当 browser_click 和 browser_click(force=true) 均无效时才使用此工具。' +
        '【selector 来源】直接使用 browser_get_buttons 返回的"CSS selector"列（如 #login-btn、button.submit），' +
        '无需重新猜测，此工具不支持 Playwright 专属语法（如 text=xxx）。',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS 选择器（不支持 Playwright 专属语法如 text=），如 #login-btn、button.submit、.login-form button',
          },
        },
        required: ['selector'],
      },
    },
  },

  async execute({ selector }) {
    const page = browserSession.currentPage;
    if (!page) return '❌ 浏览器未打开，请先调用 browser_open';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clicked: boolean = await (page.evaluate as any)(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;
      })()
    `);

    if (!clicked) return `❌ 未找到元素：${selector}`;
    await waitSettle();
    return `✅ JS点击 [${selector}] → ${await pageInfo()}`;
  },
};

// ── 12. browser_get_inputs ────────────────────────────────────────

/**
 * 扫描当前页面所有可见的 input / textarea / select，
 * 返回各字段的 DOM 属性（type / name / id / placeholder / aria-label / 关联 label 文字）。
 * AI 填写表单前应先调用此工具，拿到精确 selector 再调用 browser_type，
 * 避免因 selector 模糊而填错字段（如把密码写进用户名框）。
 */
const browserGetInputs: ToolDefinition<Record<string, never>> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_get_inputs',
      description:
        '扫描当前页面所有可见的表单输入元素（input / textarea / select）' +
        '以及富文本编辑器（contenteditable div，如 wangEditor / Quill / Slate / TipTap），' +
        '返回每个字段的 type、name、id、placeholder、aria-label 及关联 label 文字。' +
        '当 type=rich-editor 时，必须用 browser_type_rich 而非 browser_type 来填写。' +
        '【重要】填写任何表单前必须先调用此工具，根据返回的推荐 selector 精确定位字段。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  async execute() {
    const page = browserSession.currentPage;
    if (!page) return '❌ 浏览器未打开，请先调用 browser_open';

    // page.evaluate 内的代码在浏览器环境运行，用字符串传入以绕过 Node tsconfig 类型检查
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputs: Array<Record<string, string>> = await (page.evaluate as any)(/* js */`
      (() => {
        const results = [];
        const elements = document.querySelectorAll(
          'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])'
        );
        let visibleIdx = 0;
        elements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
          visibleIdx++;
          const tag   = el.tagName.toLowerCase();
          const type  = el.type || tag;
          const name  = el.name || '';
          const id    = el.id || '';
          const ph    = el.placeholder || el.getAttribute('aria-placeholder') || '';
          const aria  = el.getAttribute('aria-label') || '';
          const value = el.value || '';
          let label   = '';
          if (id) {
            const lbl = document.querySelector('label[for="' + id + '"]');
            if (lbl) label = lbl.textContent.trim();
          }
          if (!label) {
            const parentLbl = el.closest('label');
            if (parentLbl) {
              const clone = parentLbl.cloneNode(true);
              clone.querySelectorAll('input,select,textarea').forEach(n => n.remove());
              label = clone.textContent.trim();
            }
          }
          if (!label) {
            const prev = el.previousElementSibling;
            if (prev && !['INPUT','SELECT','TEXTAREA'].includes(prev.tagName)) {
              label = prev.textContent.trim().slice(0, 30);
            }
          }
          let rec = '';
          if (id) rec = '#' + id;
          else if (name) rec = tag + '[name="' + name + '"]';
          else if (type && type !== 'text' && type !== 'textarea') rec = tag + '[type="' + type + '"]';
          else if (ph) rec = tag + '[placeholder="' + ph.replace(/"/g, '\\"').slice(0, 50) + '"]';
          else if (aria) rec = tag + '[aria-label="' + aria.replace(/"/g, '\\"').slice(0, 50) + '"]';
          else rec = tag;
          results.push({ index: String(visibleIdx), tag, type, name, id,
            placeholder: ph, ariaLabel: aria, label,
            currentValue: type === 'password' ? '(hidden)' : value.slice(0, 20),
            recommended: rec });
        });
        // ── 扫描富文本编辑器（contenteditable div：wangEditor/Quill/Slate/TipTap）──
        const ceEls = document.querySelectorAll('[contenteditable="true"]');
        ceEls.forEach((ce) => {
          if (ce.tagName === 'BODY' || ce.tagName === 'HTML') return;
          const rect = ce.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          const st = window.getComputedStyle(ce);
          if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return;
          visibleIdx++;
          const ctag  = ce.tagName.toLowerCase();
          const cid   = ce.id || '';
          const caria = ce.getAttribute('aria-label') || '';
          const cph   = ce.getAttribute('placeholder') || ce.getAttribute('data-placeholder') || '';
          const crole = ce.getAttribute('role') || '';
          const cval  = (ce.innerText || '').trim().slice(0, 20);
          let crec = '';
          if (cid) crec = '#' + cid;
          else if (ce.hasAttribute('data-slate-editor')) crec = '[data-slate-editor]';
          else crec = '[contenteditable="true"]';
          const clabel = (crole === 'textarea' || crole === 'textbox') ? '富文本编辑器'
                       : crole ? '富文本(' + crole + ')' : '富文本编辑器';
          results.push({ index: String(visibleIdx), tag: ctag, type: 'rich-editor', name: '', id: cid,
            placeholder: cph, ariaLabel: caria, label: clabel,
            currentValue: cval || '（空）', recommended: crec });
        });
        return results;
      })()
    `);

    if (inputs.length === 0) return '⚠️ 当前页面未找到可见的表单输入元素';

    const lines = inputs.map((f) => {
      const parts = [
        `[${f.index}] <${f.tag}> type=${f.type}`,
        f.id          ? `id="${f.id}"`                  : null,
        f.name        ? `name="${f.name}"`              : null,
        f.placeholder ? `placeholder="${f.placeholder}"`: null,
        f.ariaLabel   ? `aria-label="${f.ariaLabel}"`   : null,
        f.label       ? `label="《${f.label}》"`        : null,
        f.currentValue && f.currentValue !== '(hidden)' && f.currentValue
                      ? `当前值="${f.currentValue}"`    : null,
        `→ 推荐selector: ${f.recommended}`,
      ].filter(Boolean).join('  ');
      return `  ${parts}`;
    });

    return `📋 当前页面共 ${inputs.length} 个表单元素：\n${lines.join('\n')}\n\n` +
      `💡 type=rich-editor → 使用 browser_type_rich 填写；其他 type → 使用 browser_type 填写。`;
  },
};

// ── 15. browser_type_rich ─────────────────────────────────────────

/**
 * 向富文本编辑器（contenteditable div）输入文字。
 * wangEditor / Quill / TipTap / Slate.js 等编辑器均属此类。
 *
 * 【强制键盘模拟，无例外】
 * execCommand('insertText') 在 Slate.js 下会触发 React reconciler 重新 normalize，
 * 导致输入内容末尾残留 U+FEFF 零宽字符（&#xFEFF;）。
 * 键盘事件经过编辑器自己的 onKeyDown/beforeinput 处理链，输出干净，
 * 且 # @ 等触发字符能正确激活自动补全浮窗，因此始终使用键盘模拟。
 */
interface TypeRichParams { selector: string; text: string; clear?: boolean }

const browserTypeRich: ToolDefinition<TypeRichParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_type_rich',
      description:
        '向富文本编辑器（contenteditable div，如 wangEditor、Quill、TipTap、Slate 等）输入文字。' +
        '当 browser_get_inputs 返回的字段 type=rich-editor 时，必须用此工具。' +
        '【禁止用 browser_type 代替】browser_type 对 contenteditable 元素完全无效，' +
        '且 execCommand 直接写入会在 Slate 编辑器里产生 U+FEFF 乱码，本工具始终使用键盘模拟。' +
        'selector 直接使用 browser_get_inputs 返回的推荐 selector（如 #w-e-textarea-1、[data-slate-editor]）。' +
        '默认先清空再写入（clear=true），追加内容时设 clear=false。' +
        '【注意】输入 # @ 等字符后编辑器可能弹出自动补全浮窗，' +
        '输入完成后必须截图确认，如有浮窗需要点击选项才能完成插入。',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS 选择器，如 #w-e-textarea-1、[data-slate-editor]、[contenteditable="true"]',
          },
          text: {
            type: 'string',
            description: '要输入的文字内容',
          },
          clear: {
            type: 'boolean',
            description: '是否先清空编辑器再写入，默认 true',
          },
        },
        required: ['selector', 'text'],
      },
    },
  },

  async execute({ selector, text, clear = true }) {
    const page = browserSession.currentPage;
    if (!page) return '❌ 浏览器未打开，请先调用 browser_open';

    // 检查元素是否存在
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exists: boolean = await (page.evaluate as any)(
      `!!document.querySelector(${JSON.stringify(selector)})`
    );
    if (!exists) return `❌ 未找到元素：${selector}`;

    // 始终使用键盘模拟，避免 execCommand 在 Slate 等框架下产生 U+FEFF 残留
    try {
      await page.locator(selector).first().click({ timeout: 5000 });
      if (clear) {
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Delete');
        // 等待编辑器 re-render 完成
        await new Promise(r => setTimeout(r, 120));
      }
      await page.keyboard.type(text, { delay: 60 });
      await waitSettle();
      return `✅ 已向富文本编辑器输入"${text}"（键盘模拟）\n` +
        `💡 若输入了 # @ 等触发字符，请立即截图确认是否弹出自动补全浮窗，如有则需点击对应选项完成插入。`;
    } catch (e) {
      return `❌ 富文本输入失败 [${selector}]：${(e as Error).message.slice(0, 120)}`;
    }
  },
};

// ── 14. browser_get_buttons ───────────────────────────────────────

/**
 * 扫描当前页面所有可见的可点击按钮，返回可直接使用的 Playwright selector 和 CSS selector，
 * 并用 🔑 标记疑似"登录/提交"的主要按钮。
 *
 * 标准调用流程：
 *   browser_get_buttons  →  browser_click(Playwright sel)
 *                        →（超时）browser_click(Playwright sel, force=true)
 *                        →（仍失败）browser_js_click(CSS sel)
 */
const browserGetButtons: ToolDefinition<Record<string, never>> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_get_buttons',
      description:
        '扫描当前页面所有可见的可点击按钮（button、[role=button]、a、input[type=submit] 等），' +
        '返回每个按钮的文字内容、id、CSS类，以及可直接使用的 Playwright selector 和 CSS selector，' +
        '并用 🔑 标记疑似登录/提交/确认的主要操作按钮。' +
        '【重要】点击任何按钮前必须先调用此工具，直接使用返回的 selector，不要从截图猜测。' +
        '拿到结果后：browser_click 使用"Playwright"列，browser_js_click 使用"CSS"列。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  async execute() {
    const page = browserSession.currentPage;
    if (!page) return '❌ 浏览器未打开，请先调用 browser_open';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buttons: Array<Record<string, string>> = await (page.evaluate as any)(/* js */`
      (() => {
        const LOGIN_KW = [
          '登录','登陆','log in','login','sign in','signin','sign-in',
          '注册','register','submit','提交','确定','确认','立即','进入',
          '开始','继续','next','下一步','verify','验证'
        ];
        const results = [];
        const seen = new Set();
        const candidates = [
          ...document.querySelectorAll(
            'button, [role="button"], input[type="submit"], input[type="button"], a[href]'
          )
        ];
        let idx = 0;
        candidates.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
          const text = (
            el.innerText || el.value ||
            el.getAttribute('aria-label') || el.getAttribute('title') || ''
          ).trim().replace(/\\s+/g, ' ').slice(0, 60);
          const uid = (el.id || '') + '||' + text + '||' + el.className.toString().slice(0, 40);
          if (seen.has(uid)) return;
          seen.add(uid);
          idx++;
          const tag    = el.tagName.toLowerCase();
          const id     = el.id || '';
          const type   = el.type || '';
          const classes = [...el.classList]
            .filter(c => c.length > 0 && c.length < 40)
            .slice(0, 5).join(' ');
          let cssRec = '';
          if (id) {
            cssRec = '#' + id;
          } else {
            const mainClass = [...el.classList].find(
              c => c.length > 1 && c.length < 30 &&
                   !/^(flex|grid|w-|h-|p-|m-|text-|bg-|border-|rounded|cursor|font|items-|justify-)/.test(c)
            );
            cssRec = mainClass ? tag + '.' + mainClass
                   : type && type !== 'text' ? tag + '[type="' + type + '"]'
                   : tag;
          }
          const pwRec = text ? 'text=' + text : cssRec;
          const textLower = text.toLowerCase();
          const isLogin = LOGIN_KW.some(k => textLower.includes(k.toLowerCase()));
          results.push({
            index: String(idx), tag, text, id, classes, type,
            isLogin: isLogin ? '1' : '0',
            cssSelector: cssRec, playwrightSelector: pwRec
          });
        });
        return results;
      })()
    `);

    if (buttons.length === 0) return '⚠️ 当前页面未找到可见的可点击按钮';

    const lines = buttons.map((b) => {
      const flag = b.isLogin === '1' ? ' 🔑' : '';
      const parts = [
        `[${b.index}]${flag} <${b.tag}>`,
        b.text    ? `文字="${b.text}"`       : '（无文字）',
        b.id      ? `id="${b.id}"`           : null,
        b.classes ? `class="${b.classes}"`   : null,
        b.type    ? `type=${b.type}`          : null,
        `CSS: ${b.cssSelector}`,
        `Playwright: ${b.playwrightSelector}`,
      ].filter(Boolean).join('  ');
      return `  ${parts}`;
    });

    const loginBtns = buttons.filter(b => b.isLogin === '1');
    let tip = `\n💡 使用说明：\n`;
    tip += `  • 第②步 browser_click(selector)              → 使用"Playwright"列（如 text=登录）\n`;
    tip += `  • 第③步 browser_click(selector, force=true)  → 点击超时时，同上加 force=true\n`;
    tip += `  • 第④步 browser_js_click(selector)           → 使用"CSS"列（如 #login-btn）\n`;
    if (loginBtns.length > 0) {
      tip += `  🔑 疑似登录/提交按钮：${loginBtns.map(b => `"${b.text || b.cssSelector}"`).join('、')}`;
    }

    return `📋 当前页面共 ${buttons.length} 个可点击按钮：\n${lines.join('\n')}${tip}`;
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
  browserListTabs,
  browserJsClick,
  browserSwitchTab,
  browserGetInputs,
  browserTypeRich,
  browserGetButtons,
];
