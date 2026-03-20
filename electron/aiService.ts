/// <reference types="node" />
import aiConfig, { LLMProviderConfig } from './ai.config';
import { addMessage, getRecentContext, getMessages, renameConversation } from './db';
import { toolRegistry } from './tools/index';
import type { ChatMessage, ContentPart, ToolSchema } from './tools/types';
import { isToolImageResult } from './tools/types';
import { memoryManager, globalMemoryManager, recordMessageActivity } from './memory/index';
import { stripThinkTags } from './utils/textUtils';
import { fetchCompletion } from './llmClient';
import { runAgent } from './agent/orchestrator';
import { getManualTopicsForPrompt } from './tools/impl/manual';

// ── 工具调用调试事件 ─────────────────────────────────────
/** 单次工具调用的调试记录（推送给渲染层展示） */
export interface ToolCallEvent {
  /** 工具名，如 browser_click_smart */
  name: string;
  /** 解析后的参数对象 */
  args: Record<string, unknown>;
  /** 执行结果文字（截取前 300 字） */
  result: string;
  /** true = ✅ 成功；false = ❌ 失败 / ⏸️ 暂停 */
  ok: boolean;
  /** 执行耗时（毫秒） */
  durationMs: number;
}

let _toolEventListener: ((ev: ToolCallEvent) => void) | null = null;

/** 由 main.ts 调用，注册工具调用调试事件回调（传 null 取消） */
export function setToolEventListener(cb: ((ev: ToolCallEvent) => void) | null): void {
  _toolEventListener = cb;
}

/** 内部：执行工具并同时发射调试事件 */
async function execAndEmit(name: string, argsJson: string) {
  const t0 = Date.now();
  const result = await toolRegistry.execute(name, argsJson);
  const durationMs = Date.now() - t0;
  if (_toolEventListener) {
    const resultText = isToolImageResult(result) ? result.text : String(result);
    let parsedArgs: Record<string, unknown> = {};
    try { parsedArgs = JSON.parse(argsJson); } catch { /* ignore */ }
    _toolEventListener({
      name,
      args: parsedArgs,
      result: resultText.slice(0, 300),
      ok: !resultText.startsWith('❌') && !resultText.startsWith('[工具错误]'),
      durationMs,
    });
  }
  return result;
}

function getLatestRealUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content !== 'string') continue;
    const txt = m.content.trim();
    // 跳过内部注入提示
    if (txt.startsWith('【系统】') || txt.startsWith('【系统提示】')) continue;
    return txt;
  }
  return '';
}

function hasBrowserTools(toolSchemas?: ToolSchema[]): boolean {
  if (!toolSchemas?.length) return false;
  return toolSchemas.some((t) => t.function.name.startsWith('browser_'));
}

function isLikelyBrowseIntent(userText: string): boolean {
  const t = userText.toLowerCase();
  if (!t) return false;
  return /(打开|进入|访问|去|导航|网页|网站|页面|链接|网址|url|浏览器|搜索|查找|点击|查看|看看|点开|执行)/i.test(t);
}

/**
 * 检测用户请求是否属于"需要调用工具才能完成"的动作类意图。
 * 范围比 isLikelyBrowseIntent 更广：涵盖终端/截图/系统控制等。
 * 用于第一轮无工具调用时的通用兜底纠偏。
 */
function isLikelyActionIntent(userText: string): boolean {
  const t = userText.toLowerCase();
  if (!t) return false;
  return /(帮我|我要|请你|帮|打开|进入|访问|导航|搜索|点击|查看|看看|点开|执行|运行|截图|截屏|终端|cmd|powershell|命令|操作|控制|输入|填写|登录|登陆|提交|发布|发送|下载|上传|刷新|切换|关闭|退出|删除|复制|粘贴)/i.test(t);
}

/**
 * 轻量任务意图检测：用户消息含"请/帮/查/找/看/给/写/改/删/开"等请求性字眼时触发。
 * 用于在第一轮请求前预注入提示，提醒 AI 主动判断是否需要调用工具。
 */
function isLikelyTaskRequest(userText: string): boolean {
  // 排除纯聊天性短句（问候、感谢、是否确认等）
  if (/^(好的|嗯|谢谢|谢|ok|好|是的|对|不了|没事|算了|随便)[\s。！？]*$/i.test(userText.trim())) return false;
  return /(请|帮|查|找|看|给|写|改|删|开|关|装|跑|执行|运行|搜|列|显示|告诉我|能不能|可以吗|帮我|帮忙|需要你)/i.test(userText);
}

function isLikelyToolFreeBrowserHallucination(replyText: string): boolean {
  const t = replyText.toLowerCase();
  return /(已打开|已经打开|已进入|已经进入|我已到达|已访问|当前页面|我在该网站|已跳转|我已搜索|搜索完成|正在打开|正在点击|马上去|马上打开|马上进入|已找到)/i.test(t);
}

function isLikelyProgressOnlyText(replyText: string): boolean {
  const t = replyText.toLowerCase();
  return /(正在|马上|立刻|这就|等一会|稍等|马上去|马上打开|正在打开|正在点击)/i.test(t);
}

function isLikelyDomParseIntent(userText: string): boolean {
  const t = userText.toLowerCase();
  if (!t) return false;
  return /(解析|html|a元素|标签|outerhtml|源码|原封不动|元素代码|dom)/i.test(t);
}

function isLikelyCannotParseExcuse(replyText: string): boolean {
  const t = replyText.toLowerCase();
  return /(无法|不能|不支持|没有.*功能|没办法|无法直接解析|不能解析html|看不了源码)/i.test(t);
}

// ── 工具调用循环 ──────────────────────────────────────────

/**
 * 调用 LLM 并自动处理工具调用循环。
 *
 * - 若 toolRegistry 为空，直接发起单次请求
 * - 若 LLM 返回 finish_reason === 'tool_calls'，并行执行所有工具，
 *   将结果以 `tool` 角色回填，再次请求，直到得到最终回复
 * - 设有最大循环轮数保护，防止意外死循环
 */
async function callWithToolLoop(
  provider: LLMProviderConfig,
  messages: ChatMessage[],
  toolSchemas?: ToolSchema[],
): Promise<string> {
  const withTools = !!toolSchemas?.length;
  // 在副本上操作，不污染调用方的数组
  const msgBuf: ChatMessage[] = [...messages];
  let antiHallucinationNudgeUsed = false;

  const MAX_ROUNDS = 10;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const data = await fetchCompletion(provider, msgBuf, withTools ? toolSchemas : undefined);
    const choice = data.choices[0];

    // ── 无工具调用 → 返回最终文本 ──
    if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls?.length) {
      const finalText = stripThinkTags(choice.message.content?.trim() ?? '');
      // ── 第一轮无工具调用通用兜底 ──────────────────────────────────────
      // reasoning 模型在新对话里容易「觉得自己能直接回答」而不调工具。
      // 只要第一轮有动作类意图但没有调工具，注入强制纠偏让模型重新决策。
      if (round === 0 && !antiHallucinationNudgeUsed && withTools) {
        const latestUser = getLatestRealUserText(msgBuf);
        if (isLikelyActionIntent(latestUser)) {
          antiHallucinationNudgeUsed = true;
          msgBuf.push({ role: 'assistant', content: choice.message.content ?? finalText });
          msgBuf.push({
            role: 'user',
            content:
              '【系统纠偏】你刚才没有调用任何工具就直接回复了，但用户的请求需要实际操作。' +
              '你拥有工具调用能力（浏览器操作/打开终端/截图/系统控制等），' +
              '必须调用对应工具后再回复，不能只用文字描述意图。' +
              '请重新理解用户请求，直接调用工具。',
          });
          continue;
        }
      }
      // 防浏览器幻觉：用户要求访问/操作网站，但模型未调用工具却给出“已完成/进行中”口头回复。
      if (!antiHallucinationNudgeUsed && withTools && hasBrowserTools(toolSchemas)) {
        const latestUser = getLatestRealUserText(msgBuf);
        const needToolAction = isLikelyBrowseIntent(latestUser);
        const fakeDone = isLikelyToolFreeBrowserHallucination(finalText) || isLikelyProgressOnlyText(finalText);
        if (needToolAction && fakeDone) {
          antiHallucinationNudgeUsed = true;
          msgBuf.push({
            role: 'assistant',
            content: choice.message.content ?? finalText,
          });
          msgBuf.push({
            role: 'user',
            content:
              '【系统纠偏】你刚才在未调用任何浏览器工具的情况下，给出了“已执行/进行中”的口头回复，这是不允许的。' +
              '必须先调用 browser_get_state / browser_open / browser_find / browser_click 等工具获取真实结果，' +
              '再基于工具结果回答。禁止臆测当前页面状态，禁止只回复“正在打开/正在点击”。',
          });
          continue;
        }

        const needDomParse = isLikelyDomParseIntent(latestUser);
        const giveExcuse = isLikelyCannotParseExcuse(finalText);
        if (needDomParse && giveExcuse) {
          antiHallucinationNudgeUsed = true;
          msgBuf.push({
            role: 'assistant',
            content: choice.message.content ?? finalText,
          });
          msgBuf.push({
            role: 'user',
            content:
              '【系统纠偏】你具备 DOM 解析工具，不能以“无法解析 HTML”作为回复。' +
              '请调用 browser_get_elements_html（必要时结合 browser_find / browser_get_links）获取真实 outerHTML，' +
              '并把元素原文返回给用户。',
          });
          continue;
        }
      }

      return finalText;
    }

    // ── 有工具调用 → 追加 assistant 消息 ──
    msgBuf.push({
      role: 'assistant',
      content: choice.message.content,
      tool_calls: choice.message.tool_calls,
    });

    // ── 并行执行本轮所有工具 ──
    const execResults = await Promise.all(
      choice.message.tool_calls.map(async (tc) => ({
        tc,
        result: await execAndEmit(tc.function.name, tc.function.arguments),
      }))
    );

    // ── 回填结果：普通文本 → tool 消息；图像 → tool 消息 + user 多模态消息 ──
    for (const { tc, result } of execResults) {
      if (isToolImageResult(result)) {
        // 1. tool 消息（文字描述，让模型知道工具已执行）
        msgBuf.push({ role: 'tool', tool_call_id: tc.id, content: result.text });
        // 2. user 多模态消息（注入图像，让视觉模型能"看到"截图）
        const imageParts: ContentPart[] = [
          { type: 'text', text: '（以下是截取的屏幕截图，请结合图像内容回答用户的问题）' },
          {
            type: 'image_url',
            image_url: {
              url: `data:${result.mimeType};base64,${result.imageBase64}`,
              detail: 'low',
            },
          },
        ];
        msgBuf.push({ role: 'user', content: imageParts });
      } else {
        // 普通文本结果
        msgBuf.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
    }
    // 每轮工具结果回填后注入提示
    // 若本轮有任意工具返回 🔄（Skill 继续），注入强制继续指令，否则注入通用提醒
    const hasSkillContinue = execResults.some(({ result }) => {
      const text = isToolImageResult(result) ? result.text : String(result);
      return text.startsWith('🔄');
    });

    // run_command 失败：注入专用纠偏，禁止 AI 解释错误原因，强制查说明书
    const hasCommandFailure = execResults.some(({ tc, result }) => {
      if (tc.function.name !== 'run_command') return false;
      const text = isToolImageResult(result) ? result.text : String(result);
      return text.startsWith('❌');
    });

    if (hasSkillContinue) {
      msgBuf.push({
        role: 'user',
        content:
          '【系统强制】上面的工具返回了 🔄，表示 Skill 流程尚未完成，你必须立刻调用【必须立即执行】中指定的工具继续执行。' +
          '禁止输出任何文字回复，禁止和用户聊天，直接调用工具。',
      });
    } else if (hasCommandFailure) {
      msgBuf.push({
        role: 'user',
        content:
          '【系统纠偏】run_command 执行失败（见上方 ❌ 输出）。' +
          '必须立即调用 read_manual 查阅正确命令写法，然后用修正后的命令重试。' +
          '若说明书中没有相关内容，再考虑其他方案。',
      });
    } else {
      msgBuf.push({
        role: 'user',
        content: '【系统】根据以上工具结果，直接执行下一步操作或给出最终回复。禁止输出推理过程。',
      });
    }
    // 继续循环，带上工具结果再请求
  }

  // 超出轮数：追加系统提示，让 AI 用自然语言总结失败原因并回复用户
  msgBuf.push({
    role: 'user',
    content:
      '【系统提示】你已经连续调用了 ' + MAX_ROUNDS + ' 轮工具，操作仍未完成。' +
      '请停止继续调用工具，用自然语言向用户总结：① 你尝试了哪些步骤，② 哪一步卡住了，③ 可能的原因是什么。',
  });
  try {
    const fallback = await fetchCompletion(provider, msgBuf); // 不带工具，强制输出文字
    return stripThinkTags(fallback.choices[0]?.message.content?.trim() ?? '（操作超出轮数，且无法生成总结）');
  } catch {
    return `（操作未完成：工具调用超过 ${MAX_ROUNDS} 轮，请检查页面状态后重试）`;
  }
}

// ── 主接口 ────────────────────────────────────────────────

/**
 * 发送消息并返回 AI 回复。
 * - 自动保存 user / assistant 消息至 SQLite
 * - 维护 contextWindowRounds 轮短期记忆
 * - 若 toolRegistry 注册了工具，自动启用 Function Calling 并处理多轮工具循环
 * - 第一轮对话自动以用户首句命名对话
 */
export async function sendChatMessage(
  conversationId: string,
  userContent: string
): Promise<{ content: string; created_at: number }> {
  const provider = aiConfig.providers[aiConfig.activeProvider];
  if (!provider) throw new Error(`未找到 provider: ${aiConfig.activeProvider}`);

  // 1. 保存用户消息
  addMessage({ conversation_id: conversationId, role: 'user', content: userContent });

  // 2. 构建上下文（含刚保存的 user 消息）
  const context = getRecentContext(conversationId, aiConfig.contextWindowRounds);

  // 将本对话历史片段 + 全局核心记忆 一并 append 到角色提示词末尾
  const memoryAppend =
    memoryManager.buildMemoryAppend(conversationId) +
    globalMemoryManager.buildGlobalMemoryAppend();
  // 动态注入说明书目录（每次对话初始化时刷新，新增/删除文件立即生效）
  const manualTopics = getManualTopicsForPrompt();
  const systemContent = (provider.systemPrompt ?? '') + manualTopics + memoryAppend;

  const messages: ChatMessage[] = [
    ...(systemContent ? [{ role: 'system' as const, content: systemContent }] : []),
    ...context.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

  // 任务意图预提示：用户消息含请求性字眼时，在第一轮前轻量注入，
  // 提醒 AI 主动判断是否需要调用工具，减少"口头描述代替实际执行"的幻觉。
  if (toolRegistry.isEmpty === false && isLikelyTaskRequest(userContent)) {
    messages.push({
      role: 'user',
      content: '【系统提示】检测到用户可能在请求执行一项任务。请先判断：这是需要调用工具才能完成的操作，还是普通聊天？如果需要工具，直接调用，不要只用文字描述你打算做什么。',
    });
  }

  // 3. 调用 AI（含工具调用循环）
  let replyContent: string;
  try {
    const mode = aiConfig.agentMode ?? 'off';
    if (mode === 'force') {
      // 强制 Agent：用户输入直接作为目标执行（显式开关即视为用户授权）
      replyContent = await runAgent(userContent, provider);
    } else {
      // 普通模式：禁用 agent_start，避免未获同意就进入 planner
      // getSchemasForMode 会在有 Skill 时自动隐藏 sys_* 原子工具，降低 AI 选择压力
      const normalTools = toolRegistry.isEmpty
        ? undefined
        : toolRegistry.getSchemasForMode().filter(s => s.function.name !== 'agent_start');
      replyContent = await callWithToolLoop(provider, messages, normalTools);
    }
  } catch (e) {
    replyContent = `（请求失败：${(e as Error).message}）`;
  }

  // 4. 保存 AI 最终回复
  const saved = addMessage({
    conversation_id: conversationId,
    role: 'assistant',
    content: replyContent,
  });

  // 记录消息活跃时间（供空闲调度器判断何时触发后台总结，不再在热路径调用 LLM）
  recordMessageActivity();

  // 6. 首轮对话自动用用户首句命名
  const allUserMsgs = getMessages(conversationId).filter((m) => m.role === 'user');
  if (allUserMsgs.length === 1) {
    const title = userContent.length > 18 ? userContent.slice(0, 18) + '…' : userContent;
    renameConversation(conversationId, title);
  }

  return { content: replyContent, created_at: saved.created_at };
}
