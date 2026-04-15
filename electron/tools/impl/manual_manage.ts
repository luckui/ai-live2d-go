/**
 * 工具：manual_manage
 *
 * 管理说明书（创建、编辑、查阅、列表）
 * 实验性功能：AI 在完成复杂任务后，可主动将工作流程保存为新说明书。
 *
 * Actions:
 *   create - 创建新说明书（后台异步生成，立即返回）
 *   edit   - 编辑现有说明书（后台异步更新，立即返回）
 *   read   - 读取说明书内容（复用 read_manual）
 *   list   - 列出所有说明书（复用 read_manual 无参）
 *
 * 设计原则：
 *   - create/edit 操作异步后台执行，不阻塞对话流程
 *   - LLM 总结会话历史 → 生成结构化 markdown → 保存到 electron/manual/
 *   - 调用前必须征得用户同意
 *   - 跳过简单一次性任务，聚焦可复用流程
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { ToolDefinition, ToolContext } from '../types';
import { getManualGenerator } from '../../manual/manualGenerator';

/**
 * 说明书目录路径（兼容开发模式和打包后）
 *
 * 开发时：app.getAppPath() 返回项目根目录
 * 打包后：process.resourcesPath 指向 resources/ 目录（需在 electron-builder 中配置 extraResources）
 */
const MANUAL_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'electron', 'manual')
  : path.join(app.getAppPath(), 'electron', 'manual');

const MAX_NAME_LENGTH = 64;
const VALID_NAME_RE = /^[\u4e00-\u9fa5a-zA-Z0-9][_\-\u4e00-\u9fa5a-zA-Z0-9\s]*$/;

/**
 * 验证说明书名称（允许中英文、数字、下划线、连字符、空格）
 */
function validateName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return '说明书名称不能为空';
  }
  const trimmed = name.trim();
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `说明书名称过长（最大 ${MAX_NAME_LENGTH} 字符）`;
  }
  if (!VALID_NAME_RE.test(trimmed)) {
    return '说明书名称只能包含中英文、数字、下划线、连字符和空格，且必须以字母或数字开头';
  }
  return null;
}

/**
 * 检查说明书是否已存在
 */
function manualExists(name: string): boolean {
  if (!fs.existsSync(MANUAL_DIR)) return false;
  const filename = `${name.trim()}.md`;
  return fs.existsSync(path.join(MANUAL_DIR, filename));
}

/**
 * 列出所有说明书
 */
function listManuals(): string[] {
  if (!fs.existsSync(MANUAL_DIR)) return [];
  return fs
    .readdirSync(MANUAL_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''));
}

interface ManualManageParams {
  action: 'create' | 'edit' | 'read' | 'list';
  name?: string;
  title?: string;
  description?: string;
}

const manualManageTool: ToolDefinition<ManualManageParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'manual_manage',
      description:
        '管理说明书（创建、编辑、查阅、列表）。说明书是你的程序性记忆——针对特定任务类型的可复用方法。\n' +
        '【何时创建】\n' +
        '  • 复杂任务成功完成（5+ 工具调用、多次迭代、克服错误）\n' +
        '  • 用户纠正过的方法有效后\n' +
        '  • 发现非平凡工作流程\n' +
        '  • 用户明确要求记录流程时\n' +
        '【何时编辑】\n' +
        '  • 使用说明书时发现步骤过时/错误\n' +
        '  • 遇到说明书未覆盖的陷阱\n' +
        '  • 发现更好的方法\n' +
        '【注意事项】\n' +
        '  • 创建/编辑前必须征得用户同意\n' +
        '  • 跳过简单一次性任务\n' +
        '  • create/edit 会在后台异步生成内容（不阻塞对话）\n' +
        '  • 优秀说明书应包含：触发条件、分步指令、命令示例、常见陷阱、验证步骤\n' +
        '【Actions】\n' +
        '  create - 创建新说明书（需要 name, title, description）\n' +
        '  edit   - 编辑现有说明书（需要 name, title, description）\n' +
        '  read   - 读取说明书内容（需要 name）\n' +
        '  list   - 列出所有说明书（无需参数）',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'edit', 'read', 'list'],
            description: '操作类型：create=创建, edit=编辑, read=读取, list=列出所有',
          },
          name: {
            type: 'string',
            description:
              '说明书名称（中英文、数字、下划线、连字符、空格）。' +
              'create 时作为新文件名，edit/read 时定位现有文件。' +
              '示例："Git 冲突解决流程"、"Django Migration 修复"',
          },
          title: {
            type: 'string',
            description:
              '说明书标题（简短描述，2-10 字）。' +
              '用于 create/edit 生成 markdown 前言。' +
              '示例："Git 冲突解决"、"Migration 修复"',
          },
          description: {
            type: 'string',
            description:
              '说明书描述（50-200 字）。' +
              '用于 create/edit 指导 LLM 生成内容。' +
              '应包含：任务背景、关键步骤、预期结果。' +
              '示例："当 git pull 遇到冲突时，如何查看冲突文件、手动解决、验证并提交"',
          },
        },
        required: ['action'],
      },
    },
  },

  execute({ action, name, title, description }, context?: ToolContext): string {
    // ── list：列出所有说明书 ──────────────────────────────────────
    if (action === 'list') {
      const manuals = listManuals();
      if (manuals.length === 0) {
        return (
          '📖 说明书目录为空。\n' +
          `知识库路径：${MANUAL_DIR}\n` +
          '使用 manual_manage(action="create", name="...", title="...", description="...") 创建新说明书。'
        );
      }
      return (
        `📖 可用说明书（共 ${manuals.length} 篇）：\n` +
        manuals.map(m => `  • ${m}`).join('\n') +
        '\n\n调用 manual_manage(action="read", name="...") 查阅具体内容。'
      );
    }

    // ── read：读取说明书内容 ──────────────────────────────────────
    if (action === 'read') {
      if (!name) {
        return '❌ read 操作需要 name 参数';
      }
      const filename = `${name.trim()}.md`;
      const filepath = path.join(MANUAL_DIR, filename);
      if (!fs.existsSync(filepath)) {
        const manuals = listManuals();
        return (
          `❌ 未找到说明书"${name}"。\n\n` +
          `当前可用说明书：${manuals.join('、')}\n\n` +
          '请检查名称是否正确。'
        );
      }
      try {
        const content = fs.readFileSync(filepath, 'utf-8').trim();
        if (!content) return `⚠️ 说明书"${name}"内容为空。`;
        const MAX = 3000;
        const truncated =
          content.length > MAX
            ? content.slice(0, MAX) + `\n\n…（内容已截断，原文 ${content.length} 字）`
            : content;
        return `📖 【${name}】\n\n${truncated}`;
      } catch (e) {
        return `❌ 读取说明书失败：${(e as Error).message}`;
      }
    }

    // ── create：创建新说明书 ──────────────────────────────────────
    if (action === 'create') {
      if (!name || !title || !description) {
        return '❌ create 操作需要 name, title, description 参数';
      }
      const nameErr = validateName(name);
      if (nameErr) {
        return `❌ ${nameErr}`;
      }
      if (manualExists(name)) {
        return `❌ 说明书"${name}"已存在。使用 action="edit" 进行编辑。`;
      }

      // 异步后台生成
      const generator = getManualGenerator();
      generator.queueCreate({
        name: name.trim(),
        title: title.trim(),
        description: description.trim(),
        conversationId: context?.conversationId,
      });

      return (
        `✅ 说明书"${name}"创建请求已排队，正在后台生成中...\n` +
        `📝 标题：${title}\n` +
        `📋 描述：${description}\n\n` +
        `生成完成后将自动保存到 ${MANUAL_DIR}/${name}.md\n` +
        `你可以继续对话，生成过程不会阻塞当前会话。`
      );
    }

    // ── edit：编辑现有说明书 ──────────────────────────────────────
    if (action === 'edit') {
      if (!name || !title || !description) {
        return '❌ edit 操作需要 name, title, description 参数';
      }
      if (!manualExists(name)) {
        return `❌ 说明书"${name}"不存在。使用 action="create" 创建新说明书。`;
      }

      // 异步后台更新
      const generator = getManualGenerator();
      generator.queueEdit({
        name: name.trim(),
        title: title.trim(),
        description: description.trim(),
        conversationId: context?.conversationId,
      });

      return (
        `✅ 说明书"${name}"编辑请求已排队，正在后台更新中...\n` +
        `📝 新标题：${title}\n` +
        `📋 新描述：${description}\n\n` +
        `更新完成后将自动保存到 ${MANUAL_DIR}/${name}.md\n` +
        `你可以继续对话，生成过程不会阻塞当前会话。`
      );
    }

    return `❌ 未知操作：${action}`;
  },
};

export default manualManageTool;
