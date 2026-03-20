/**
 * OCR 屏幕文字定位工具（WinRT 实现）
 *
 * 工具列表：
 *   1. sys_find_text       - 截图  OCR  返回文字坐标（不点击）
 *   2. sys_find_text_click - 截图  OCR  找到文字  系统鼠标点击
 *
 * 实现方案：
 *   - 截图：Electron desktopCapturer  临时 PNG 文件
 *   - OCR：PowerShell 调用 Windows Runtime OCR API（Win10/11 内置）
 *         无需安装任何依赖，无需联网，打包零开销
 *   - 语言：自动使用用户配置文件语言（中文用户  zh-Hans-CN）
 *           + 英文引擎补充双语识别
 *   - 行合并：WinRT 以单字分词，脚本将同一 Line 的词拼合后再匹配，
 *             查"文件"/"确定"等多字词可精准命中
 *   - 坐标换算：截图物理像素  逻辑像素（自动处理 DPI 缩放）
 *   - 点击：nut-js mouse（操作系统级）
 *
 * 【DPI 坐标换算】
 *   PowerShell 脚本返回物理像素坐标，nut-js 使用逻辑像素。
 *   scaleX = display.logicalWidth / imageWidth（截图物理宽）
 *   logicalX = physicalCx * scaleX
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { desktopCapturer, screen as electronScreen } from 'electron';
import { mouse, Button, straightTo, Point } from '@nut-tree-fork/nut-js';
import type { ToolDefinition } from '../types';

import { app } from 'electron';

const execFileAsync = promisify(execFile);

/**
 * ocr_winrt.ps1 路径
 *
 * 打包后：electron-builder 把 public/ 复制到 resources/public/
 *   → path.join(process.resourcesPath, 'public', 'scripts', 'ocr_winrt.ps1')
 *
 * 开发时（electron-vite dev）：__dirname = out/main/，往上两级到项目根
 *   → path.join(__dirname, '..', '..', 'public', 'scripts', 'ocr_winrt.ps1')
 */
const PS_SCRIPT = app.isPackaged
  ? path.join(process.resourcesPath, 'public', 'scripts', 'ocr_winrt.ps1')
  : path.join(__dirname, '..', '..', 'public', 'scripts', 'ocr_winrt.ps1');

// 临时截图路径（每次覆盖写，不累积）
const TMP_IMG = path.join(os.tmpdir(), 'live2d_pet_ocr.png');

//  OCR 结果类型 

interface OcrLine {
  text: string;
  /** 物理像素左上角 */
  x: number; y: number;
  w: number; h: number;
  /** 物理像素中心 */
  cx: number; cy: number;
}

interface OcrError {
  error: string;
}

//  截图 

interface ScreenInfo {
  imageWidth: number;
  imageHeight: number;
  logicalWidth: number;
  logicalHeight: number;
}

async function captureToFile(): Promise<ScreenInfo> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 3840, height: 2160 },
  });
  if (!sources.length) throw new Error('未找到屏幕源，请检查系统截图权限');

  const src = sources.find(s => s.name === 'Entire Screen' || s.name === 'Screen 1') ?? sources[0];
  const img = src.thumbnail;
  const { width: iw, height: ih } = img.getSize();

  fs.writeFileSync(TMP_IMG, img.toPNG());

  const display = electronScreen.getPrimaryDisplay();
  return {
    imageWidth:   iw,
    imageHeight:  ih,
    logicalWidth:  display.size.width,
    logicalHeight: display.size.height,
  };
}

//  调用 PowerShell OCR 脚本 

async function runOcr(query: string, partialMatch: boolean): Promise<{
  lines: OcrLine[];
  screen: ScreenInfo;
}> {
  const screen = await captureToFile();

  const args = [
    '-NonInteractive', '-NoProfile', '-File', PS_SCRIPT,
    '-ImagePath', TMP_IMG,
  ];
  if (query) {
    args.push('-Query', query);
    if (partialMatch) args.push('-PartialMatch');
  }

  let stdout: string;
  try {
    const r = await execFileAsync('powershell.exe', args, {
      timeout: 30_000,
      encoding: 'utf8',
    });
    stdout = r.stdout.trim();
  } catch (e: any) {
    const stderr = (e.stderr as string | undefined)?.trim() ?? '';
    throw new Error(`PowerShell 执行失败: ${e.message}\n${stderr}`.slice(0, 400));
  }

  if (stdout.startsWith('{"error"')) {
    const err = JSON.parse(stdout) as OcrError;
    throw new Error(err.error);
  }

  const parsed = JSON.parse(stdout || '[]');
  const lines: OcrLine[] = Array.isArray(parsed) ? parsed : [parsed as OcrLine];
  return { lines, screen };
}

//  坐标换算 

function toLogical(physX: number, physY: number, screen: ScreenInfo): { lx: number; ly: number } {
  const sx = screen.logicalWidth  / screen.imageWidth;
  const sy = screen.logicalHeight / screen.imageHeight;
  return { lx: Math.round(physX * sx), ly: Math.round(physY * sy) };
}

//  1. sys_find_text 

interface FindTextParams {
  text: string;
  partialMatch?: boolean;
}

const sysFindText: ToolDefinition<FindTextParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'sys_find_text',
      description:
        '截取屏幕并用 OCR 查找指定文字，返回文字在屏幕上的逻辑坐标（不执行点击）。\n' +
        '使用 Windows 内置 OCR，支持中文、英文，无需安装额外依赖。\n' +
        '【典型用途】\n' +
        '   确认某个按钮/文字是否出现在屏幕上\n' +
        '   获取文字坐标后再决定操作方式\n' +
        '   与 sys_mouse_click 配合实现"找到就点击"逻辑',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '要查找的文字，如"确定"、"打开"、"OK"',
          },
          partialMatch: {
            type: 'boolean',
            description: '是否允许行内包含即匹配（如行文字"文件(F)"也能匹配查询"文件"），默认 true',
          },
        },
        required: ['text'],
      },
    },
  },

  async execute({ text, partialMatch = true }) {
    let result: Awaited<ReturnType<typeof runOcr>>;
    try {
      result = await runOcr(text, partialMatch);
    } catch (e) {
      return ` OCR 失败：${(e as Error).message}`;
    }

    const { lines, screen } = result;
    if (lines.length === 0) {
      return (
        ` 屏幕上未找到文字"${text}"（partialMatch=${partialMatch}）\n` +
        ` 如果确认文字存在，可尝试： 设 partialMatch=true； 截图确认屏幕状态`
      );
    }

    const rows = lines.map((ln, i) => {
      const { lx, ly } = toLogical(ln.cx, ln.cy, screen);
      return `  [${i + 1}] "${ln.text}" | 逻辑坐标 (${lx}, ${ly})`;
    });
    return ` 找到 ${lines.length} 处"${text}"：\n${rows.join('\n')}`;
  },
};

//  2. sys_find_text_click 

interface FindTextClickParams {
  text: string;
  partialMatch?: boolean;
  index?: number;
  button?: 'left' | 'right' | 'double';
}

const sysFindTextClick: ToolDefinition<FindTextClickParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'sys_find_text_click',
      description:
        '截取屏幕并用 OCR 查找指定文字，找到后自动点击其中心（系统级鼠标点击）。\n' +
        '使用 Windows 内置 OCR，支持中文、英文，自动处理 DPI 缩放。\n' +
        '【适合 Skill 内部使用的稳定等待模式】\n' +
        '  不是"等 500ms 猜对话框有没有出现"，\n' +
        '  而是"看到对话框上的文字才点击"，找不到就报错，让 AI 重试或换策略。\n' +
        '【典型用途】\n' +
        '   点击运行对话框的"打开"按钮\n' +
        '   点击 UAC 弹窗的"是"\n' +
        '   点击任意系统/应用窗口上的按钮文字',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '要查找并点击的文字，如"确定"、"打开"、"是"、"OK"',
          },
          partialMatch: {
            type: 'boolean',
            description: '是否允许行内包含即匹配，默认 true',
          },
          index: {
            type: 'number',
            description: '找到多个匹配时点击第几个（从 1 开始），默认 1',
          },
          button: {
            type: 'string',
            enum: ['left', 'right', 'double'],
            description: '鼠标按键：left=左键单击（默认）、right=右键、double=双击',
          },
        },
        required: ['text'],
      },
    },
  },

  async execute({ text, partialMatch = true, index = 1, button = 'left' }) {
    let result: Awaited<ReturnType<typeof runOcr>>;
    try {
      result = await runOcr(text, partialMatch);
    } catch (e) {
      return ` OCR 失败：${(e as Error).message}`;
    }

    const { lines, screen } = result;
    if (lines.length === 0) {
      return (
        ` 屏幕上未找到文字"${text}"，无法点击。\n` +
        ` 如果确认文字存在： 设 partialMatch=true； 先截图确认屏幕状态`
      );
    }

    const safeIdx = Math.max(1, Math.min(index, lines.length));
    const target = lines[safeIdx - 1];
    const { lx, ly } = toLogical(target.cx, target.cy, screen);

    try {
      await mouse.move(straightTo(new Point(lx, ly)));
      await new Promise(r => setTimeout(r, 80));
      if (button === 'double')      await mouse.doubleClick(Button.LEFT);
      else if (button === 'right')  await mouse.click(Button.RIGHT);
      else                          await mouse.click(Button.LEFT);
    } catch (e) {
      return ` 鼠标点击失败：${(e as Error).message}`;
    }

    await new Promise(r => setTimeout(r, 120));

    const extra = lines.length > 1 ? `（共 ${lines.length} 处，点击第 ${safeIdx} 处）` : '';
    return (
      ` 已找到并点击文字"${target.text}"${extra}\n` +
      `   逻辑坐标: (${lx}, ${ly})`
    );
  },
};

//  导出 

export const ocrTools: ToolDefinition<never>[] = [
  sysFindText      as ToolDefinition<never>,
  sysFindTextClick as ToolDefinition<never>,
];