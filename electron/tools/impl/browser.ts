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
 *   16. browser_find        - 统一元素查找（button+link+keyword模糊过滤，首选）
 *   17. browser_get_state   - 查当前 URL/标题（零开销，操作前先确认位置）
 *   18. browser_get_links   - 扫描 <a> 链接，拿到 href 后直接 browser_open 跳过点击
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
 *  【点击 <a> 链接（搜索结果/弹窗内列表）】
 *    ① browser_click(text=链接文字)              → 标准点击，首选
 *    ② 点击超时/失败 → browser_get_links         → 拿到完整 href
 *    ③ browser_open(href)                        → 直接导航，彻底绕过点击问题
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
        '若要进行浏览器级 Google 搜索，必须使用前缀 google:关键词（例如 google:playwright 教程）。' +
        '【重要】在某网站内搜索内容请使用该网站搜索框（browser_find + browser_type），不要调用本工具做站内搜索。' +
        '不确定当前是否已在目标页时，先调用 browser_get_state 确认 URL，避免重复导航。',
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
    const q = query.trim();
    const isUrl = /^https?:\/\//i.test(q);
    const googleMatch = q.match(/^google\s*:\s*(.+)$/i);

    if (!isUrl && !googleMatch) {
      const current = await pageInfo();
      return (
        '⚠️ browser_open 已阻止本次操作：这看起来不是网址，也不是显式 Google 搜索。\n' +
        '若你要在当前网站内搜索，请改用该站点搜索框（browser_find 定位搜索框 + browser_type 输入）。\n' +
        '若你确实要全网搜索，请使用格式：google:关键词。\n' +
        `当前页面：${current}`
      );
    }

    const url = isUrl
      ? q
      : `https://www.google.com/search?q=${encodeURIComponent(googleMatch?.[1] ?? '')}`;

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
    const res: { ok: boolean; reason?: string; detail?: string } = await (page.evaluate as any)(`
      (() => {
        const selector = ${JSON.stringify(selector)};
        const all = Array.from(document.querySelectorAll(selector));
        if (all.length === 0) return { ok: false, reason: 'not_found' };

        const isVisible = (el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const st = window.getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
          return true;
        };

        const visibles = all.filter(isVisible);
        const pick = (list) => {
          for (const el of list) {
            const r = el.getBoundingClientRect();
            const cx = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2));
            const cy = Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2));
            const top = document.elementFromPoint(cx, cy);
            if (!top) continue;
            if (top === el || el.contains(top)) return el;
          }
          return list[0] || null;
        };

        const target = pick(visibles.length ? visibles : all);
        if (!target) return { ok: false, reason: 'no_target' };

        try {
          target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        } catch {}

        try { target.focus?.(); } catch {}

        const opts = { bubbles: true, cancelable: true, composed: true };
        try {
          target.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', button: 0 }));
          target.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0 }));
          target.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', button: 0 }));
          target.dispatchEvent(new MouseEvent('mouseup', { ...opts, button: 0 }));
          target.dispatchEvent(new MouseEvent('click', { ...opts, button: 0 }));
        } catch {
          // 老环境降级
          target.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0 }));
          target.dispatchEvent(new MouseEvent('mouseup', { ...opts, button: 0 }));
          target.dispatchEvent(new MouseEvent('click', { ...opts, button: 0 }));
        }

        // 某些组件只监听原生 click 方法
        try { target.click?.(); } catch {}

        const tag = target.tagName?.toLowerCase?.() || 'unknown';
        const cls = (target.className || '').toString().trim().slice(0, 80);
        return { ok: true, detail: '<' + tag + ' class="' + cls + '">' };
      })()
    `);

    if (!res.ok) return `❌ JS 点击失败：${res.reason ?? 'unknown'}（selector=${selector}）`;
    await waitSettle();
    return `✅ JS点击 [${selector}] ${res.detail ? `命中 ${res.detail}` : ''} → ${await pageInfo()}`;
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
        '扫描当前页面所有可见的可点击按钮（button、[role=button]、a、input[type=submit]，以及被样式伪装成按钮的 div/span 等），' +
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
            'button, [role="button"], input[type="submit"], input[type="button"], a[href], [onclick], [tabindex], [data-testid*="button" i], [class*="btn" i], [class*="button" i]'
          )
        ];

        // 补充：常见“伪按钮”容器（div/span/li）
        document.querySelectorAll('div, span, li').forEach((el) => {
          if (candidates.includes(el)) return;
          const cls = (el.className || '').toString();
          const role = (el.getAttribute('role') || '').toLowerCase();
          const hasTabindex = el.hasAttribute('tabindex');
          const style = window.getComputedStyle(el);
          const clickableLike =
            role === 'button' ||
            hasTabindex ||
            style.cursor === 'pointer' ||
            /(^|\s)(btn|button|submit|clickable)(-|_|\s|$)/i.test(cls);
          if (clickableLike) candidates.push(el);
        });
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

// ── 16. browser_find ─────────────────────────────────────────────

/**
 * 统一元素查找工具：一次性扫描所有可交互元素（button + a + role=button + onclick...），
 * 支持关键词模糊过滤，并直接告知 AI 应该用哪个工具执行下一步。
 *
 * 核心价值：AI 不需要判断目标是 button 还是 <a>，此工具统一返回。
 *   - <a> 元素：el.href 已自动解析为绝对 URL，推荐操作 browser_open(href)
 *   - 按钮元素：推荐操作 browser_click(selector)
 */
interface FindParams {
  keyword?: string;
  keywords?: string[];
  matchMode?: 'any' | 'all';
}

const browserFind: ToolDefinition<FindParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_find',
      description:
        '【统一元素查找】扫描当前页面可操作元素（button / <a>链接 / 输入框 input / textarea / select / 富文本）。' +
        '也会识别 div/span 伪按钮（cursor:pointer、role=button、tabindex、btn/button 类名等）。' +
        '支持多关键词匹配，自动给出下一步操作建议。\n' +
        '无需区分目标是 button / a / 输入框，返回结果中"→ 操作"列直接告诉你用哪个工具：\n' +
        '  • → browser_open("https://...")  ：<a>链接，直接导航无需点击\n' +
        '  • → browser_click("text=...")    ：按钮/交互元素，标准点击\n' +
        '  • → browser_type("selector", "...")：普通输入框\n' +
        '  • → browser_type_rich("selector", "...")：富文本编辑器\n' +
        '【用法】\n' +
        '  不传 keyword/keywords → 列出页面所有可见可操作元素（最多60个）\n' +
        '  传 keyword            → 单关键词（也可写成"词1 词2"，会自动拆分）\n' +
        '  传 keywords           → 多关键词数组（推荐）\n' +
        '  matchMode=all         → 必须同时命中全部关键词（默认 any）\n' +
        '【替代场景】任何需要"找到某个按钮或链接"的情况，用此工具代替分别调用 browser_get_buttons + browser_get_links。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description:
              '单个关键词（可选）。也支持写成"词1 词2"或"词1,词2"，内部会自动拆分为多关键词。',
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description:
              '多关键词数组（推荐）。例如 ["搜索", "帖子", "输入"]。',
          },
          matchMode: {
            type: 'string',
            enum: ['any', 'all'],
            description: '关键词匹配模式：any=命中任一关键词；all=必须全部命中。默认 any。',
          },
        },
        required: [],
      },
    },
  },

  async execute({ keyword = '', keywords = [], matchMode = 'any' }) {
    const page = browserSession.currentPage;
    if (!page) return '❌ 浏览器未打开，请先调用 browser_open';

    const fromKeyword = keyword
      .split(/[\s,，;；、|]+/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    const fromKeywords = (keywords ?? [])
      .map(s => (s ?? '').trim().toLowerCase())
      .filter(Boolean);
    const keywordTokens = Array.from(new Set([...fromKeyword, ...fromKeywords]));

    const tokensJson = JSON.stringify(keywordTokens);
    const modeJson = JSON.stringify(matchMode === 'all' ? 'all' : 'any');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const elements: Array<Record<string, string>> = await (page.evaluate as any)(/* js */`
      (() => {
        const tokens = ${tokensJson};
        const mode = ${modeJson};
        const results = [];
        const seen = new Set();

        const candidates = Array.from(document.querySelectorAll(
          'button, a[href], [role="button"], input, textarea, select, [contenteditable="true"], [onclick], [tabindex], [data-testid*="button" i], [class*="btn" i], [class*="button" i]'
        ));
        // 追加有 onclick 但不在上述选择器内的元素
        document.querySelectorAll('[onclick]').forEach((el) => {
          if (!candidates.includes(el)) candidates.push(el);
        });
        // 补充：常见伪按钮容器
        document.querySelectorAll('div, span, li').forEach((el) => {
          if (candidates.includes(el)) return;
          const cls = (el.className || '').toString();
          const role = (el.getAttribute('role') || '').toLowerCase();
          const hasTabindex = el.hasAttribute('tabindex');
          const style = window.getComputedStyle(el);
          const clickableLike =
            role === 'button' ||
            hasTabindex ||
            style.cursor === 'pointer' ||
            /(^|\s)(btn|button|submit|clickable)(-|_|\s|$)/i.test(cls);
          if (clickableLike) candidates.push(el);
        });

        candidates.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

          const tag = el.tagName.toLowerCase();
          const text = (
            el.innerText || el.value ||
            el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || ''
          ).trim().replace(/\\s+/g, ' ').slice(0, 80);
          const id = el.id || '';
          const name = el.getAttribute('name') || '';
          const placeholder = el.getAttribute('placeholder') || '';
          // el.href (DOM property) 已自动解析为完整 URL（相对路径 /post/123 → https://xxx.com/post/123）
          const href = tag === 'a' ? (el.href || '') : '';
          const isContentEditable = el.getAttribute('contenteditable') === 'true';

          // 过滤不可用输入
          if (tag === 'input') {
            const inputType = (el.getAttribute('type') || 'text').toLowerCase();
            if (inputType === 'hidden') return;
          }

          // 关键词过滤：文字/id/name/placeholder/href 任一字段匹配
          if (tokens.length) {
            const haystack = (text + ' ' + id + ' ' + name + ' ' + placeholder + ' ' + href).toLowerCase();
            const hitCount = tokens.filter(t => haystack.includes(t)).length;
            if (mode === 'all' && hitCount < tokens.length) return;
            if (mode === 'any' && hitCount === 0) return;
          }

          const uid = tag + '||' + id + '||' + text.slice(0, 30);
          if (seen.has(uid)) return;
          seen.add(uid);

          const type = el.getAttribute('type') || '';
          const classes = [...el.classList]
            .filter(c => c.length > 0 && c.length < 40)
            .slice(0, 5).join(' ');

          // CSS selector
          let cssSelector = '';
          if (id) {
            cssSelector = '#' + id;
          } else {
            const mainClass = [...el.classList].find(
              c => c.length > 1 && c.length < 30 &&
                   !/^(flex|grid|w-|h-|p-|m-|text-|bg-|border-|rounded|cursor|font|items-|justify-)/.test(c)
            );
            cssSelector = mainClass ? tag + '.' + mainClass
                        : type && type !== 'text' ? tag + '[type="' + type + '"]'
                        : tag;
          }
          const pwSelector = text ? 'text=' + text : cssSelector;

          const isFormField = isContentEditable || tag === 'textarea' || tag === 'select' ||
            (tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'].includes((type || '').toLowerCase()));

          // 推荐操作（<a> 直接导航；输入框建议输入；其余点击）
          const action = href
            ? 'browser_open("' + href + '")'
            : isContentEditable
              ? 'browser_type_rich("' + cssSelector + '", "...")'
              : isFormField
                ? 'browser_type("' + cssSelector + '", "...")'
                : 'browser_click("' + pwSelector + '")';

          results.push({ tag, text, id, name, placeholder, href, classes, type, cssSelector, pwSelector, action });
        });

        return results.slice(0, 60);
      })()
    `);

    if (elements.length === 0) {
      const hint = keywordTokens.length ? `关键词(${keywordTokens.join(' / ')})` : '页面上';
      return `⚠️ ${hint}未找到可操作元素`;
    }

    const lines = elements.map((el, i) => {
      const parts: string[] = [`[${i + 1}] <${el.tag}>`];
      if (el.text)    parts.push(`"${el.text}"`);
      if (el.id)      parts.push(`#${el.id}`);
      if (el.name)    parts.push(`name="${el.name}"`);
      if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
      if (el.href)    parts.push(`href="${el.href}"`);
      if (el.classes) parts.push(`class="${el.classes}"`);
      parts.push(`→ ${el.action}`);
      return '  ' + parts.join('  ');
    });

    const kw = keywordTokens.length ? `关键词(${keywordTokens.join(' / ')})相关的` : '';
    return (
      `🔍 ${kw}可操作元素（共 ${elements.length} 个，matchMode=${matchMode}）：\n${lines.join('\n')}\n\n` +
      `💡 直接执行"→ 操作"列：\n` +
      `  • browser_open(href)   ← <a>链接，直接导航，无需点击\n` +
      `  • browser_click(sel)   ← 按钮/交互元素，按 ②③④ 决策树点击\n` +
      `  • browser_type(sel, text) / browser_type_rich(sel, text) ← 输入框/富文本`
    );
  },
};

// ── 17. browser_get_state ───────────────────────────────────────────

/**
 * 轻量状态查询：返回当前 URL、标题、标签页数，不截图不扫 DOM，几乎零开销。
 * AI 在执行任何操作前若不确定当前页面，主动调用此工具，而非盲目重新导航。
 */
const browserGetState: ToolDefinition<Record<string, never>> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_get_state',
      description:
        '查询当前浏览器状态：返回当前页面的 URL、标题和标签页数量。零开销，不截图不扫描 DOM。\n' +
        '【何时调用】\n' +
        '  • 收到用户新任务，不确定浏览器当前在哪个页面\n' +
        '  • 准备调用 browser_open 前，先确认是否已在目标页（避免重复导航）\n' +
        '  • 操作后想确认是否跳转，但不需要看截图',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  async execute() {
    const page = browserSession.currentPage;
    if (!page) return '🔴 浏览器未打开（尚未调用过 browser_open）';

    const title   = await page.title().catch(() => '（无标题）');
    const url     = page.url();
    const all     = browserSession.pages;
    const idx     = all.indexOf(page);
    const tabInfo = all.length > 1
      ? `共 ${all.length} 个标签页，当前第 ${idx + 1} 个`
      : '共 1 个标签页';

    return `🌐 当前页面（${tabInfo}）\n  标题：${title}\n  URL ：${url}`;
  },
};

// ── 18. browser_get_links ─────────────────────────────────────────

/**
 * 扫描当前页面（含弹窗/对话框内部）所有可见 <a> 标签，
 * 返回链接文字 + 完整 href。
 *
 * 核心用途：弹窗/搜索结果列表里的帖子链接点击失败时，
 * 用此工具拿到 href 直接调用 browser_open 跳转，无需点击。
 */
const browserGetLinks: ToolDefinition<Record<string, never>> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_get_links',
      description:
        '扫描当前页面（含弹窗/模态框内部）所有可见 <a> 标签，' +
        '返回每条链接的文字和完整 URL（href）。\n' +
        '【核心用途】当 browser_click 点击链接失败或元素被遮罩时，' +
        '用此工具拿到目标 href，直接调用 browser_open(href) 跳转，完全绕过点击问题。\n' +
        '典型场景：搜索结果弹窗里有帖子链接但点击不上 → browser_get_links → browser_open(帖子href)。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  async execute() {
    const page = browserSession.currentPage;
    if (!page) return '❌ 浏览器未打开，请先调用 browser_open';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const links: Array<Record<string, string>> = await (page.evaluate as any)(/* js */`
      (() => {
        const results = [];
        const seen = new Set();
        const pageOrigin = location.origin;
        document.querySelectorAll('a[href]').forEach((el) => {
          const href = el.href || '';
          // 过滤 javascript: / 纯锚点 / 空链接
          if (!href || href.startsWith('javascript:') || href === pageOrigin + '/#' || href === '#') return;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return;
          const text = (el.innerText || el.getAttribute('title') || el.getAttribute('aria-label') || '')
            .trim().replace(/\\s+/g, ' ').slice(0, 80);
          const key = href + '||' + text;
          if (seen.has(key)) return;
          seen.add(key);
          const isExternal = !href.startsWith(pageOrigin);
          results.push({ text: text || '（无文字）', href, external: isExternal ? '1' : '0' });
        });
        return results.slice(0, 60); // 最多返回 60 条防止过长
      })()
    `);

    if (links.length === 0) return '⚠️ 当前页面未找到可见的 <a> 链接';

    const lines = links.map((l, i) => {
      const extFlag = l.external === '1' ? ' [外链]' : '';
      return `  [${i + 1}]${extFlag} "${l.text}"  →  ${l.href}`;
    });

    return (
      `🔗 当前页面共 ${links.length} 条可见链接：\n${lines.join('\n')}\n\n` +
      `💡 点击链接失败时：直接用目标 href 调用 browser_open 跳转，无需点击。`
    );
  },
};

// ── 19. browser_get_elements_html ─────────────────────────────────

interface GetElementsHtmlParams {
  keyword?: string;
  tag?: string;
  limit?: number;
}

const browserGetElementsHtml: ToolDefinition<GetElementsHtmlParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'browser_get_elements_html',
      description:
        '按关键词解析并返回页面元素的原始 HTML（outerHTML）。' +
        '适用于用户要求“原封不动给我 a 元素 / div 按钮源码”之类场景。' +
        '可按 tag 限定元素类型（如 a/div/button），并按关键词过滤文字、href、title、aria-label。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '关键词过滤（可选），例如：间谍过家家、收到的赞。',
          },
          tag: {
            type: 'string',
            description: '标签过滤（可选），例如：a / div / button。默认 *（全部标签）。',
          },
          limit: {
            type: 'number',
            description: '最多返回条数，默认 5，最大 20。',
          },
        },
        required: [],
      },
    },
  },

  async execute({ keyword = '', tag = '*', limit = 5 }) {
    const page = browserSession.currentPage;
    if (!page) return '❌ 浏览器未打开，请先调用 browser_open';

    const kw = keyword.trim().toLowerCase();
    const t = (tag || '*').trim().toLowerCase();
    const safeTag = /^[a-z][a-z0-9-]*$/.test(t) ? t : '*';
    const max = Math.max(1, Math.min(20, Math.floor(limit || 5)));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: Array<Record<string, string>> = await (page.evaluate as any)(/* js */`
      (() => {
        const kw = ${JSON.stringify(kw)};
        const tag = ${JSON.stringify(safeTag)};
        const max = ${JSON.stringify(max)};
        const nodes = Array.from(document.querySelectorAll(tag));
        const out = [];

        for (const el of nodes) {
          if (out.length >= max) break;

          const rect = el.getBoundingClientRect();
          const st = window.getComputedStyle(el);
          if ((rect.width === 0 && rect.height === 0) || st.display === 'none' || st.visibility === 'hidden') continue;

          const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 120);
          const href = (el.tagName.toLowerCase() === 'a' ? (el.href || '') : '');
          const title = el.getAttribute('title') || '';
          const aria = el.getAttribute('aria-label') || '';
          const haystack = (text + ' ' + href + ' ' + title + ' ' + aria).toLowerCase();
          if (kw && !haystack.includes(kw)) continue;

          out.push({
            tag: el.tagName.toLowerCase(),
            text,
            href,
            outerHTML: (el.outerHTML || '').trim(),
          });
        }
        return out;
      })()
    `);

    if (items.length === 0) {
      return `⚠️ 未找到匹配元素（tag=${safeTag}${kw ? `, keyword=${kw}` : ''}）`;
    }

    const lines = items.map((it, i) => {
      const head = `  [${i + 1}] <${it.tag}>${it.text ? ` text="${it.text}"` : ''}${it.href ? ` href="${it.href}"` : ''}`;
      const html = (it.outerHTML || '').slice(0, 1200);
      return `${head}\n${html}`;
    });

    return `🧩 匹配元素（共 ${items.length} 条）：\n${lines.join('\n\n')}`;
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
  browserFind,
  browserGetState,
  browserGetLinks,
  browserGetElementsHtml,
];
