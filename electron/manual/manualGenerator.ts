/**
 * ManualGenerator - 说明书生成器（纯执行逻辑）
 *
 * 职责：
 *   1. 调用 LLM 总结会话历史，生成结构化 markdown 说明书
 *   2. 保存到 electron/manual/ 目录
 *
 * 异步调度由 TaskManager 统一管理（type: 'manual'），
 * 本模块只负责 LLM 调用 + 文件写入。
 *
 * 同步模式（syncExecute）供 manual_manage 工具直接调用。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { getMessages } from '../db';
import type { DBTask } from '../db';
import { fetchCompletion } from '../llmClient';
import aiConfig from '../ai.config';
import type { ChatMessage } from '../tools/types';
import { toolRegistry } from '../tools';

/**
 * 说明书目录路径（兼容开发模式和打包后）
 *
 * 开发时：app.getAppPath() 返回项目根目录
 * 打包后：process.resourcesPath 指向 resources/ 目录（需在 electron-builder 中配置 extraResources）
 */
const MANUAL_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'electron', 'manual')
  : path.join(app.getAppPath(), 'electron', 'manual');

export interface GenerationTask {
  type: 'create' | 'edit';
  name: string;
  title: string;
  description: string;
  conversationId?: string;
}

class ManualGenerator {

  /**
   * 同步执行创建或编辑（阻塞直到生成完成，返回生成结果）
   * 用于用户主动要求总结说明书的场景（sync=true）
   */
  async syncExecute(task: GenerationTask): Promise<{ success: boolean; content?: string; error?: string }> {
    console.log(`[ManualGenerator] Sync ${task.type}: ${task.name}`);
    try {
      const content = await this.execute(task);
      return { success: true, content };
    } catch (error) {
      console.error(`[ManualGenerator] ❌ Sync ${task.type} failed: ${task.name}`, error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 执行单个生成任务：LLM 调用 + 文件写入 + 返回生成内容
   *
   * 供两个入口调用：
   *   - syncExecute() — manual_manage 工具的同步路径
   *   - executeManualTask() — TaskManager 的异步分发路径
   */
  async execute(task: GenerationTask): Promise<string> {
    // 1. 获取会话历史
    const messages = task.conversationId ? getMessages(task.conversationId) : [];
    console.log(`[ManualGenerator] Retrieved ${messages.length} messages from conversation ${task.conversationId}`);

    // 2. 调用 LLM 生成 manual 内容
    const content = await this.generateManualContent(task, messages);

    // 3. 确保目录存在（支持 name 中含分类路径如 "browser/新主题"）
    const filename = `${task.name}.md`;
    const filepath = path.join(MANUAL_DIR, filename);
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, content, 'utf-8');

    console.log(`[ManualGenerator] Saved to ${filepath} (${content.length} chars)`);
    return content;
  }

  /**
   * 调用 LLM 生成说明书 markdown 内容（带重试和工具名验证）
   */
  private async generateManualContent(task: GenerationTask, messages: ChatMessage[]): Promise<string> {
    // 获取当前活跃的 LLM provider
    const provider = aiConfig.providers[aiConfig.activeProvider];
    if (!provider) {
      throw new Error(`未找到 LLM provider: ${aiConfig.activeProvider}`);
    }

    // 构造 prompt
    const conversationContext = this.buildConversationSummary(messages);
    const systemPrompt = this.buildSystemPrompt(messages);
    const userPrompt = this.buildUserPrompt(task, conversationContext);

    // 调用 LLM（带429重试逻辑）
    let response;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount <= maxRetries) {
      try {
        response = await fetchCompletion(
          provider,
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          undefined, // 不需要工具调用
        );
        break; // 成功，退出重试循环
      } catch (error: any) {
        const is429 = error.message?.includes('429') || error.message?.includes('TooManyRequests');
        
        if (is429 && retryCount < maxRetries) {
          const waitTime = Math.pow(2, retryCount) * 2000; // 指数退避：2s, 4s, 8s
          console.warn(`[ManualGenerator] 429限流，等待 ${waitTime/1000}s 后重试... (${retryCount + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          retryCount++;
        } else {
          throw error; // 非429错误或重试次数耗尽
        }
      }
    }

    const content = response!.choices[0]?.message?.content;
    if (!content) {
      throw new Error('LLM 返回内容为空');
    }

    // 🔥 工具名验证（检测虚构工具，让AI返工而不是自动替换）
    const validationResult = this.validateToolNames(content.trim());
    
    if (validationResult.hasFakeTools) {
      console.warn(`[ManualGenerator] ❌ 检测到虚构工具: ${validationResult.fakeTools.join(', ')}`);
      console.warn(`[ManualGenerator] 🔄 让AI重新生成...`);
      
      // 构造反馈提示
      const feedbackPrompt = this.buildFeedbackPrompt(validationResult.fakeTools, task, conversationContext);
      
      // 重新调用LLM（带错误反馈）
      const retryResponse = await fetchCompletion(
        provider,
        [
          { role: 'system', content: this.buildSystemPrompt(messages) },
          { role: 'user', content: feedbackPrompt },
        ],
        undefined,
      );
      
      const retryContent = retryResponse.choices[0]?.message?.content;
      if (!retryContent) {
        throw new Error('LLM 重试后返回内容为空');
      }
      
      // 再次验证（如果还有问题，这次才替换）
      const retryValidation = this.validateToolNames(retryContent.trim());
      if (retryValidation.hasFakeTools) {
        console.error(`[ManualGenerator] ⚠️ AI重试后仍有虚构工具，执行自动替换`);
        return this.replaceFakeToolNames(retryContent.trim(), retryValidation.fakeTools);
      }
      
      console.log(`[ManualGenerator] ✅ AI重新生成成功，无虚构工具`);
      return retryContent.trim();
    }
    
    return content.trim();
  }

  /**
   * 构造系统提示（定义 AI 角色）
   * 
   * 参考 Hermes Agent skill 格式规范
   * 🔥 包含可用工具清单，强制约束AI不能瞎编工具名
   * 🔥 显式展示对话中已使用的工具，强化AI对自身工作记录的重视
   */
  private buildSystemPrompt(messages: ChatMessage[]): string {
    // 获取所有可用工具名（运行时动态获取）
    const availableTools = Array.from(toolRegistry.getToolNames()).sort();
    const toolListFormatted = availableTools
      .map((tool, idx) => `${idx + 1}. ${tool}`)
      .join('\n');
    
    const toolCount = availableTools.length;
    
    // 🔥 提取对话历史中已使用的工具（显式展示给AI）
    const usedToolCalls = this.extractToolNamesFromHistory(messages);
    const usedToolsSection = usedToolCalls.length > 0
      ? '\n\n## 📋 你在本次对话中的工具调用记录（按时间顺序）\n\n' +
        '以下是你**实际执行过的工具调用**，包含参数和调用顺序：\n\n' +
        usedToolCalls.join('\n') +
        '\n\n⚠️ **重要提示**：\n' +
        '- 生成Manual时，**优先参考上述工作流程**（这是你已验证有效的操作顺序）\n' +
        '- 工具名和参数都是从你的实际调用记录中提取的，确保准确性\n' +
        '- `tools_used` 字段应包含上述工具名（去重）\n' +
        '- 「操作步骤」章节应反映上述调用顺序\n' +
        '- 如果需要其他工具，从下述' + toolCount + '个可用工具清单中选择\n'
      : '';
    
    return (
      '你是专业的技术工作流文档编写助手。你的任务是根据用户提供的对话历史和任务描述，' +
      '生成一个结构化的工作流说明书（Manual/Skill）。' +
      usedToolsSection + '\n\n' +
      '## ⚠️ 可用工具清单（共 ' + toolCount + ' 个，必须从此清单选择）\n\n' +
      toolListFormatted + '\n\n' +
      '**🔥 重要约束**：\n' +
      '- `tools_used` 字段**只能**从上述清单中选择\n' +
      '- 禁止创造新工具名（如 bilibili_search、web_browser、web_element_operation 等虚构工具）\n' +
      '- 从对话历史的 [工具调用] 标记中提取真实使用的工具名\n' +
      '- 如果对话历史中没有工具调用记录，参考任务类型从清单中选择合适的工具\n\n' +
      '## 格式要求（严格遵守）\n\n' +
      '### 1. YAML Frontmatter（必需，位于文档开头）\n' +
      '```yaml\n' +
      '---\n' +
      'name: workflow-name-in-kebab-case\n' +
      'description: 一句话描述工作流用途（50-100 字）\n' +
      'tags: [关键词1, 关键词2, 工具类别]\n' +
      'tools_used: [browser_open, browser_screenshot]  # 从上述清单中选择\n' +
      'created_at: YYYY-MM-DD\n' +
      '---\n' +
      '```\n\n' +
      '### 2. 文档结构（按此顺序）\n\n' +
      '```markdown\n' +
      '# [工作流标题]\n\n' +
      '## 概述\n' +
      '[2-3 句话描述此工作流的目的、适用场景和核心价值]\n\n' +
      '## 触发条件\n' +
      '何时应该使用此工作流：\n' +
      '- 用户明确提到 XXX 需求\n' +
      '- 需要完成 YYY 类型任务\n' +
      '- 前置条件：ZZZ\n\n' +
      '## 工具建议\n' +
      '**CRITICAL**: 必须明确列出每个工具的使用场景和调用方式：\n\n' +
      '- **场景描述** → 使用 `tool_name`：\n' +
      '  ```bash\n' +
      '  # 具体命令示例（带参数）\n' +
      '  tool_name --arg value\n' +
      '  ```\n' +
      '  说明：什么情况下用此工具，预期输出是什么\n\n' +
      '示例：\n' +
      '- **查看文件内容** → 使用 `read_file`：\n' +
      '  ```typescript\n' +
      '  await tools.read_file({ path: "src/config.ts", startLine: 1, endLine: 50 });\n' +
      '  ```\n' +
      '  获取配置文件前 50 行，检查现有设置\n\n' +
      '## 操作步骤\n' +
      '**每个步骤 = 2-5 分钟内可完成的原子操作**\n\n' +
      '### 步骤 1: [具体动作]\n' +
      '**目标**: [此步骤完成什么]\n\n' +
      '**执行**:\n' +
      '```bash\n' +
      '# 命令或代码\n' +
      '```\n\n' +
      '**预期结果**: [应该看到什么输出/效果]\n\n' +
      '### 步骤 2: [下一个动作]\n' +
      '...\n\n' +
      '## 常见陷阱\n' +
      '从实际对话中提取的错误模式和规避方法：\n' +
      '- ⚠️ **陷阱名称**: 详细描述问题和解决方案\n' +
      '- ⚠️ **禁止**: 明确列出不该做的事\n\n' +
      '## 验证步骤\n' +
      '如何确认工作流执行成功：\n' +
      '1. **验证点 1**: 检查 XXX，预期结果是 YYY\n' +
      '2. **验证点 2**: 运行 `command`，输出应包含 ZZZ\n' +
      '```\n\n' +
      '## 关键提示\n' +
      '1. **tools_used 字段**：从对话历史的 [工具调用] 中提取真实工具名，必须在上述 ' + toolCount + ' 个可用工具清单中\n' +
      '2. **工具建议章节**：不能省略，这是最重要的部分 - 让未来的 AI 知道该用什么工具\n' +
      '3. **代码示例**：必须包含实际可运行的命令，带真实参数（从对话中提取）\n' +
      '4. **原子化步骤**：参照 Hermes "bite-sized tasks" 原则，每步 2-5 分钟\n' +
      '5. **从失败中学习**：如果对话中有错误尝试，在"常见陷阱"中记录\n\n' +
      '⚠️ 再次强调：禁止使用不在清单中的工具名！如果不确定，请参考对话历史中的 [工具调用] 标记。\n\n' +
      '请严格按照上述模板生成说明书内容。输出纯 Markdown，不要附加任何解释。'
    );
  }

  /**
   * 构造用户提示（提供任务描述和对话历史）
   */
  private buildUserPrompt(task: GenerationTask, conversationContext: string): string {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    return (
      `请根据以下信息生成工作流说明书：\n\n` +
      `**标题**：${task.title}\n` +
      `**描述**：${task.description}\n` +
      `**创建日期**：${today}\n\n` +
      `## 对话历史（含工具调用细节）\n` +
      `${conversationContext}\n\n` +
      `## 生成要求\n` +
      `1. **提取 tools_used**：从对话历史的 [工具调用] 标记中提取所有工具名，去重后填入 frontmatter\n` +
      `2. **生成 tags**：根据任务类型和工具类别，添加 3-5 个关键词标签\n` +
      `3. **编写工具建议**：对于每个使用的工具，写明：\n` +
      `   - 什么场景下使用\n` +
      `   - 具体调用命令（从对话中提取真实参数）\n` +
      `   - 预期输出是什么\n` +
      `4. **细化操作步骤**：每步 2-5 分钟可完成，包含验证命令\n` +
      `5. **记录失败教训**：如果对话中有工具调用失败或错误尝试，在"常见陷阱"中说明\n\n` +
      `请生成完整的说明书内容（包含 YAML frontmatter），严格遵循系统提示中的模板格式。` +
      `只输出 Markdown 内容，不要包含任何额外的解释或元信息。`
    );
  }

  /**
   * 构造对话历史摘要（提取关键工具调用和结果）
   * 
   * 参考 Hermes Agent 风格：详细记录工具名、参数、结果
   */
  private buildConversationSummary(messages: ChatMessage[]): string {
    if (messages.length === 0) {
      return '（无对话历史）';
    }

    // 提取最近 20 条消息
    const recentMessages = messages.slice(-20);

    // 构造详细摘要
    const summary = recentMessages
      .map((msg, idx) => {
        const role = msg.role === 'user' ? '👤 用户' : msg.role === 'assistant' ? '🤖 AI' : msg.role === 'tool' ? '⚙️ 工具结果' : '📋 系统';
        let content = msg.content ?? '';

        // 处理多模态内容（user 角色可能是 ContentPart[]）
        if (Array.isArray(content)) {
          const textParts = content.filter((p) => p.type === 'text').map((p) => (p as any).text);
          content = textParts.join(' ');
        }

        // 截断过长内容
        if (typeof content === 'string' && content.length > 400) {
          content = content.slice(0, 400) + '...(已截断)';
        }

        let toolInfo = '';

        // 工具调用信息（assistant 角色）
        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
          const toolDetails = msg.tool_calls.map((tc) => {
            const name = tc.function?.name ?? 'unknown';
            let argsPreview = '';
            try {
              if (tc.function?.arguments) {
                const args = JSON.parse(tc.function.arguments);
                // 提取关键参数（限制长度）
                const keyArgs = Object.entries(args)
                  .slice(0, 3) // 只显示前 3 个参数
                  .map(([k, v]) => {
                    const valStr = typeof v === 'string' ? v : JSON.stringify(v);
                    const truncated = valStr.length > 50 ? valStr.slice(0, 50) + '...' : valStr;
                    return `${k}: ${truncated}`;
                  });
                argsPreview = keyArgs.length > 0 ? `(${keyArgs.join(', ')})` : '';
              }
            } catch {
              argsPreview = '(参数解析失败)';
            }
            return `    - ${name}${argsPreview}`;
          });
          toolInfo = `\n  [工具调用]\n${toolDetails.join('\n')}`;
        }

        // 工具返回结果（tool 角色）
        if (msg.role === 'tool' && msg.tool_call_id) {
          const resultPreview = typeof content === 'string' && content.length > 0
            ? `结果: ${content.slice(0, 150)}${content.length > 150 ? '...' : ''}`
            : '(无返回内容)';
          toolInfo = `\n  [工具返回] ${resultPreview}`;
        }

        const mainContent = typeof content === 'string' && content.length > 0 ? content : '(无文本内容)';
        return `${idx + 1}. ${role}: ${mainContent}${toolInfo}`;
      })
      .join('\n\n');

    return summary;
  }

  /**
   * 从对话历史中提取完整的工具调用记录（含参数和顺序）
   * 
   * 用途：在System Prompt中显式展示"你是怎么工作的"，强化AI对自身工作流程的重视
   * 
   * @param messages 对话历史消息
   * @returns 按时间顺序的工具调用记录（包含工具名、参数摘要、调用序号）
   */
  private extractToolNamesFromHistory(messages: ChatMessage[]): string[] {
    interface ToolCall {
      index: number;
      name: string;
      args: string; // 参数摘要（格式化后的字符串）
    }

    const toolCalls: ToolCall[] = [];
    let callIndex = 0;

    for (const msg of messages) {
      // 只提取 assistant 角色的工具调用
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          const toolName = tc.function?.name;
          if (!toolName) continue;

          // 解析参数（提取关键字段）
          let argsPreview = '';
          try {
            if (tc.function?.arguments) {
              const args = JSON.parse(tc.function.arguments);
              // 提取前3个参数，截断长度
              const keyArgs = Object.entries(args)
                .slice(0, 3)
                .map(([k, v]) => {
                  const valStr = typeof v === 'string' ? v : JSON.stringify(v);
                  const truncated = valStr.length > 60 ? valStr.slice(0, 60) + '...' : valStr;
                  return `${k}="${truncated}"`;
                });
              argsPreview = keyArgs.length > 0 ? keyArgs.join(', ') : '(无参数)';
            } else {
              argsPreview = '(无参数)';
            }
          } catch {
            argsPreview = '(参数解析失败)';
          }

          toolCalls.push({
            index: ++callIndex,
            name: toolName,
            args: argsPreview,
          });
        }
      }
    }

    // 格式化为字符串数组（保持顺序）
    return toolCalls.map(tc => `${tc.index}. ${tc.name}(${tc.args})`);
  }

  /**
   * 验证Markdown中的工具名（检测但不替换）
   * 
   * @returns 验证结果：是否有虚构工具 + 虚构工具列表
   */
  private validateToolNames(markdown: string): { hasFakeTools: boolean; fakeTools: string[] } {
    const availableTools = toolRegistry.getToolNames();
    const fakeTools: string[] = [];
    
    // 提取所有可能的工具名（形如 xxx_yyy）
    const toolPattern = /\b([a-z_]+_[a-z_]+)\b/g;
    const matches = markdown.match(toolPattern) || [];
    
    for (const match of new Set(matches)) {
      if (!availableTools.has(match)) {
        // 常见虚构工具名模式
        const fakeToolPatterns = [
          'bilibili_', 'web_browser', 'web_element_', 'web_page_', 'web_search_',
          'api_call', 'http_request', 'search_engine'
        ];
        
        if (fakeToolPatterns.some(pattern => match.includes(pattern))) {
          fakeTools.push(match);
        }
      }
    }
    
    return {
      hasFakeTools: fakeTools.length > 0,
      fakeTools: Array.from(new Set(fakeTools)),
    };
  }

  /**
   * 构造反馈Prompt（告诉AI哪些工具是虚构的）
   */
  private buildFeedbackPrompt(
    fakeTools: string[],
    task: GenerationTask,
    conversationContext: string
  ): string {
    const today = new Date().toISOString().split('T')[0];
    const availableTools = Array.from(toolRegistry.getToolNames()).sort();
    
    // 为每个虚构工具推荐真实工具
    const suggestions = fakeTools.map(fakeTool => {
      if (fakeTool.includes('bilibili') || fakeTool.includes('web_search')) {
        return `  - ❌ ${fakeTool} → ✅ 使用 browser_open`;
      } else if (fakeTool.includes('web_element') || fakeTool.includes('click_element')) {
        return `  - ❌ ${fakeTool} → ✅ 使用 browser_click 或 browser_find`;
      } else if (fakeTool.includes('web_page') || fakeTool.includes('web_browser')) {
        return `  - ❌ ${fakeTool} → ✅ 使用 browser_open 或 browser_read_page`;
      } else {
        return `  - ❌ ${fakeTool} → ✅ 请从可用工具清单中选择`;
      }
    }).join('\n');
    
    return (
      `## ❌ 上一次生成中检测到虚构工具\n\n` +
      `以下工具名不在可用工具清单中：\n${suggestions}\n\n` +
      `请重新生成，严格遵守以下规则：\n` +
      `1. tools_used 字段**只能**从系统提示中的可用工具清单（共 ${availableTools.length} 个）中选择\n` +
      `2. 参考对话历史的 [工具调用] 标记提取真实使用的工具名\n` +
      `3. 禁止创造新工具名\n\n` +
      `---\n\n` +
      `请根据以下信息重新生成工作流说明书：\n\n` +
      `**标题**：${task.title}\n` +
      `**描述**：${task.description}\n` +
      `**创建日期**：${today}\n\n` +
      `## 对话历史（含工具调用细节）\n` +
      `${conversationContext}\n\n` +
      `## 生成要求\n` +
      `1. **提取 tools_used**：从对话历史的 [工具调用] 标记中提取所有工具名\n` +
      `2. **验证工具名**：确保每个工具都在系统提示的可用工具清单中\n` +
      `3. **生成 tags**：根据任务类型和工具类别添加关键词标签\n` +
      `4. **编写工具建议**：对于每个使用的工具，写明场景、调用命令、预期输出\n` +
      `5. **只输出 Markdown**：包含 YAML frontmatter，不要附加解释\n`
    );
  }

  /**
   * 替换虚构工具名（降级方案，仅在AI重试失败后使用）
   */
  private replaceFakeToolNames(markdown: string, fakeTools: string[]): string {
    let fixed = markdown;
    
    const replacementMap = new Map<string, string>([
      ['web_browser', 'browser_open'],
      ['web_search', 'browser_open'],
      ['browser_navigate', 'browser_open'],
      ['bilibili_search', 'browser_open'],
      ['web_element_operation', 'browser_find'],
      ['click_element', 'browser_click'],
      ['web_page_visit', 'browser_open'],
      ['web_page_read', 'browser_read_page'],
    ]);
    
    for (const fakeTool of fakeTools) {
      const realTool = replacementMap.get(fakeTool);
      if (realTool) {
        const pattern = new RegExp(`\\b${fakeTool}\\b`, 'g');
        fixed = fixed.replace(pattern, realTool);
        console.warn(`[ManualGenerator] ⚠️ 自动替换: ${fakeTool} → ${realTool}`);
      } else {
        console.error(`[ManualGenerator] ❌ 无法自动替换虚构工具: ${fakeTool}`);
      }
    }
    
    return fixed;
  }

  /**
   * 验证并修复Markdown中的虚构工具名
   * 
   * @deprecated 已被 validateToolNames + buildFeedbackPrompt 替代
   * 检测虚构工具，返回验证结果
   */
  private validateAndFixToolNames(markdown: string): string {
    const availableTools = toolRegistry.getToolNames();
    let fixed = markdown;
    
    // 虚构工具名映射表（根据语义推断真实工具）
    const fakeToolMapping = new Map<RegExp, string>([
      // web_browser系列 → browser_open
      [/\bweb_browser\b/g, 'browser_open'],
      [/\bweb_search\b/g, 'browser_open'],
      [/\bbrowser_navigate\b/g, 'browser_open'],
      
      // bilibili系列 → browser_open + browser_find
      [/\bbilibili_search\b/g, 'browser_open'],
      
      // web_element系列 → browser_find / browser_click
      [/\bweb_element_operation\b/g, 'browser_find'],
      [/\bclick_element\b/g, 'browser_click'],
      
      // web_page系列 → browser_open
      [/\bweb_page_visit\b/g, 'browser_open'],
      [/\bweb_page_read\b/g, 'browser_read_page'],
    ]);
    
    // 应用替换
    let replacementCount = 0;
    for (const [pattern, realTool] of fakeToolMapping) {
      const beforeLength = fixed.length;
      fixed = fixed.replace(pattern, realTool);
      if (fixed.length !== beforeLength) {
        replacementCount++;
        console.warn(`[ManualGenerator] ⚠️ 替换虚构工具: ${pattern.source} → ${realTool}`);
      }
    }
    
    // 扫描剩余的潜在虚构工具（形如 xxx_yyy 但不在真实工具列表中）
    const toolPattern = /\b([a-z_]+_[a-z_]+)\b/g;
    const matches = fixed.match(toolPattern) || [];
    
    for (const match of new Set(matches)) {
      if (!availableTools.has(match)) {
        // 检查是否是常见虚构模式
        const commonFakePrefixes = ['api_', 'http_', 'search_'];
        if (commonFakePrefixes.some(prefix => match.startsWith(prefix))) {
          console.error(`[ManualGenerator] ❌ 检测到未映射的虚构工具: ${match}`);
          console.error(`   请手动检查生成的文档并更新 fakeToolMapping 映射表`);
        }
      }
    }
    
    if (replacementCount > 0) {
      console.log(`[ManualGenerator] ✅ 已修复 ${replacementCount} 个虚构工具名`);
    }
    
    return fixed;
  }
}

// 单例模式
const manualGenerator = new ManualGenerator();

export function getManualGenerator(): ManualGenerator {
  return manualGenerator;
}

/**
 * TaskManager 分发入口：从 DBTask 提取参数，调用 ManualGenerator.execute()
 *
 * TaskManager._startAsync() 中 type === 'manual' 时调用此函数。
 * metadata 中应包含 { manualAction, name, title, description }
 */
export async function executeManualTask(task: DBTask): Promise<string> {
  const meta = task.metadata ? JSON.parse(task.metadata) : {};
  const genTask: GenerationTask = {
    type: meta.manualAction ?? 'create',
    name: meta.name ?? task.title,
    title: meta.title ?? task.title,
    description: meta.description ?? task.prompt,
    conversationId: task.conversation_id ?? undefined,
  };
  return manualGenerator.execute(genTask);
}
