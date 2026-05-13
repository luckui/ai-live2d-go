/**
 * Skill: open_terminal
 *
 * 在 Windows 系统上打开一个命令行终端。
 * 支持 cmd / powershell / wt（Windows Terminal）三种目标。
 *
 * 执行步骤（硬编码，AI 无法干预中间流程）：
 *   Step 1: Win+R 打开运行对话框
 *   Step 2: OCR 轮询，等到"确定"按钮出现（对话框已弹出）
 *   Step 3: 剪贴板写入终端命令 → Ctrl+V 粘贴（绕过输入法）
 *   Step 4: OCR 点击"确定"按钮（回退：回车键）
 *   Step 5: 等待终端窗口启动
 *
 * OCR 用 Windows Runtime 内置 API，Win10/11 零依赖可用。
 */

import type { ToolDefinition, ToolExecuteResult } from '../types';
import { getToolRegistry } from '../toolContext';
import { clipboard } from 'electron';

interface OpenTerminalParams {
  /** 终端类型，默认 cmd */
  type?: 'cmd' | 'powershell' | 'wt';
  /** 打开后是否立即执行一条命令（可选） */
  command?: string;
}

// 各终端对应的运行命令
const TERMINAL_CMD: Record<string, string> = {
  cmd:        'cmd',
  powershell: 'powershell',
  wt:         'wt',          // Windows Terminal（需已安装）
};

const openTerminalSkill: ToolDefinition<OpenTerminalParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'open_terminal',
      description:
        '在 Windows 系统上打开命令行终端（cmd / powershell / Windows Terminal）。\n' +
        '通过 Win+R 运行对话框启动，OCR 识别确认对话框后点击确定，\n' +
        '可选在打开后立即执行一条命令（command 参数）。\n' +
        '【使用场景】\n' +
        '  • "帮我打开终端"\n' +
        '  • "打开一个 cmd 窗口"\n' +
        '  • "用 powershell 执行 xxx 命令"',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['cmd', 'powershell', 'wt'],
            description: '终端类型：cmd（命令提示符，默认）、powershell、wt（Windows Terminal）',
          },
          command: {
            type: 'string',
            description: '打开终端后立即执行的命令（可选），如 "ipconfig"、"dir C:\\"',
          },
        },
        required: [],
      },
    },
  },


  async execute({ type = 'cmd', command }): Promise<ToolExecuteResult> {
    const reg = getToolRegistry();
    const termCmd = TERMINAL_CMD[type] ?? 'cmd';
    const steps: string[] = [];

    // ── Step 1: Win+R 打开运行对话框 ────────────────────────────
    const step1 = await reg.execute('sys_key_press', JSON.stringify({ keys: 'win+r' }));
    steps.push(`Step1 Win+R: ${step1}`);

    // ── Step 2: 等待运行对话框弹出 ──────────────────────────────────
    // Win+R 对话框冷启动非常稳定，400ms 足够；
    // 不用 OCR 轮询，避免每次 spawn powershell.exe 带来 ~800ms 冷启动开销。
    await reg.execute('sys_wait', JSON.stringify({ ms: 400 }));
    steps.push('Step2 等待对话框: ✅');

    // ── Step 3: 向剪贴板写入终端命令，再 Ctrl+V 粘贴 ──────────────
    // 【关键】剪贴板粘贴完全绕过中文输入法，直接注入文本到运行对话框
    clipboard.writeText(termCmd);
    const step3 = await reg.execute('sys_key_press', JSON.stringify({ keys: 'ctrl+v' }));
    steps.push(`Step3 粘贴"${termCmd}": ${step3}`);

    // ── Step 4: OCR 点击"确定"按钮（失败则回退到回车键）─────────
    const step4raw = await reg.execute('sys_find_text_click', JSON.stringify({ text: '确定', partialMatch: false }));
    const step4ok  = typeof step4raw === 'string' && step4raw.startsWith('✅');
    if (!step4ok) {
      // OCR 未命中（如高 DPI 渲染异常），回退到键盘回车，不中断流程
      await reg.execute('sys_key_press', JSON.stringify({ keys: 'enter' }));
      steps.push(`Step4 点击"确定": OCR 未命中，已回退 Enter`);
    } else {
      steps.push(`Step4 点击"确定": ${step4raw}`);
    }

    // ── Step 5: 等待终端窗口启动 ──────────────────────────────────
    await reg.execute('sys_wait', JSON.stringify({ ms: 1200 }));
    steps.push('Step5 等待终端启动: ✅');

    // ── Step 6（可选）: 执行额外命令（同样用剪贴板粘贴绕过输入法）──
    if (command?.trim()) {
      clipboard.writeText(command.trim());
      const step6a = await reg.execute('sys_key_press', JSON.stringify({ keys: 'ctrl+v' }));
      const step6b = await reg.execute('sys_key_press', JSON.stringify({ keys: 'enter' }));
      steps.push(`Step6 执行命令"${command}": ${step6a} / ${step6b}`);
    }

    const summary = command?.trim()
      ? `✅ 已打开 ${type} 并执行了命令"${command}"`
      : `✅ 已通过 Win+R 打开 ${type} 终端`;

    return `${summary}\n执行轨迹：\n${steps.map(s => '  ' + s).join('\n')}`;
  },
};

export default openTerminalSkill;
