/**
 * Skill: manage_hearing
 *
 * 管理听觉系统（语音转文字 / STT）。
 * 支持操作：status / setup / listen / stop / read
 *
 * 该工具让 AI Agent 能响应用户的语音识别安装/管理请求，
 * 自动完成 Python 虚拟环境创建、faster-whisper 安装、STT 服务启停。
 */

import { BrowserWindow } from 'electron';
import type { ToolDefinition, ToolExecuteResult } from '../types';
import * as sttMgr from '../../sttServerManager';
import { hearingManager } from '../../hearingManager';
import type { STTModelSize } from '../../sttServerManager';
import type { AudioSource, HearingMode } from '../../hearingManager';

/* ── 终端气泡推送 helper ────────────────────────────── */
function sendTerminalBlock(ev: {
  blockId: string;
  line?: string;
  status?: 'running' | 'done' | 'error';
  title?: string;
}) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send('hearing:terminal-block', ev);
  }
}

interface ManageHearingParams {
  /** 要执行的操作 */
  action: 'status' | 'setup' | 'listen' | 'stop' | 'read';
  /** 音频源，listen 时指定 */
  source?: AudioSource;
  /** 听觉模式，listen 时指定 */
  mode?: HearingMode;
  /** Whisper 模型大小，setup 时指定 */
  model?: STTModelSize;
  /** 识别语言，setup 时指定 */
  language?: string;
  /** stop 时：是否同时停止 STT 后台进程（默认 false，仅停音频捕获） */
  stop_server?: boolean;
  /** read 时：只获取此时间戳（毫秒）之后的转录条目 */
  since?: number;
  /** read 时：只获取最近 N 条转录 */
  recent?: number;
  /** read 时：读取后是否清空缓存（默认 false） */
  clear?: boolean;
}

const manageHearingTool: ToolDefinition<ManageHearingParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'manage_hearing',
      description:
        '管理听觉系统（语音转文字 / STT / 语音识别）。\n' +
        '当用户说"帮我听"、"开始听"、"安装语音识别"、"听一下视频"等时使用此工具。\n\n' +
        '操作说明：\n' +
        '  - status：查看听觉系统完整状态\n' +
        '  - setup：安装并启动 STT 服务（幂等：已安装则跳过安装，已运行则跳过启动）\n' +
        '  - listen：开始听（若服务已装但未运行则自动启动，无需手动 setup）\n' +
        '  - stop：停止听（默认仅停音频捕获，STT 进程保持运行以便下次快速启动）\n' +
        '  - read：读取转录缓存（支持 since/recent 过滤，clear=true 时读后清空）\n\n' +
        '听觉模式（listen 时用 mode 指定）：\n' +
        '  - dictation：语音输入 — 用户说完后自动识别为消息发送给你\n' +
        '  - passive：陪伴监听 — 只缓存转录，你需要用 read 读取（默认）\n' +
        '  - summary：总结模式 — 缓存转录，停止听时自动发送全文请你总结\n\n' +
        '可用模型（越大越准，但越慢越占空间）：\n' +
        '  - tiny：最快，最不准（~75MB）\n' +
        '  - base：推荐入门（~150MB）\n' +
        '  - small：较好平衡（~500MB）\n' +
        '  - medium：高精度（~1.5GB）\n' +
        '  - large-v3：最准（~3GB，建议 GPU）\n\n' +
        '音频源（listen 时用 source 指定）：\n' +
        '  - mic：麦克风（默认）\n' +
        '  - system：系统音频（听视频/播放内容）\n' +
        '  - both：麦克风 + 系统音频\n\n' +
        '【简单规则】\n' +
        '  用户说 安装/初始化语音识别   → setup\n' +
        '  用户说 开始听/帮我听         → listen（根据意图选 mode）\n' +
        '  用户说 听一下视频            → listen + source=system\n' +
        '  用户说 别听了/停止听         → stop\n' +
        '  用户说 关掉语音识别/节省内存 → stop + stop_server=true\n' +
        '  用户说 你听到了什么          → read\n' +
        '  用户问语音识别状态           → status',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'setup', 'listen', 'stop', 'read'],
            description: '要执行的操作',
          },
          source: {
            type: 'string',
            enum: ['mic', 'system', 'both'],
            description: '音频源。listen 时指定，默认 mic',
          },
          mode: {
            type: 'string',
            enum: ['dictation', 'passive', 'summary'],
            description: '听觉模式。listen 时指定。dictation=语音输入, passive=陪伴监听, summary=总结模式。默认 passive',
          },
          model: {
            type: 'string',
            enum: ['tiny', 'base', 'small', 'medium', 'large-v3'],
            description: 'Whisper 模型大小。setup 时指定，默认 base',
          },
          language: {
            type: 'string',
            description: '识别语言代码，如 zh（中文）、en（英文）、ja（日文）。setup 时指定，默认 zh',
          },
          stop_server: {
            type: 'boolean',
            description: 'stop 时是否同时停止 STT 后台进程。默认 false（仅停止音频捕获，保留服务以便下次快速启动）',
          },
          since: {
            type: 'number',
            description: 'read 时：只获取此时间戳（毫秒）之后的转录条目',
          },
          recent: {
            type: 'number',
            description: 'read 时：只获取最近 N 条转录',
          },
          clear: {
            type: 'boolean',
            description: 'read 时：读取后是否清空缓存，默认 false',
          },
        },
        required: ['action'],
      },
    },
  },


  async execute(params: ManageHearingParams): Promise<ToolExecuteResult> {
    const modeLabels: Record<string, string> = {
      dictation: '语音输入', passive: '陪伴监听', summary: '总结模式',
    };

    switch (params.action) {
      case 'status': {
        const sttStatus = await sttMgr.getStatus();
        const hearingStatus = await hearingManager.getStatus();
        const cfg = sttMgr.getConfig();
        const lines = [
          '=== 听觉系统状态 ===',
          `听觉系统: ${hearingStatus.active ? '🟢 运行中' : '⚪ 未启动'}`,
          `听觉模式: ${modeLabels[hearingStatus.mode] ?? hearingStatus.mode}`,
          `音频源:   ${hearingStatus.source ?? '(未设置)'}`,
          `转写计数: ${hearingStatus.transcriptionCount}`,
          '',
          '=== STT 服务 ===',
          `已安装:   ${sttStatus.installed ? '✅ 是' : '❌ 否'}`,
          `运行中:   ${sttStatus.running ? '✅ 是 (PID ' + sttStatus.pid + ')' : '❌ 否'}`,
          `健康检查: ${sttStatus.healthy ? '✅ 正常' : '❌ 不可达'}`,
          `模型:     ${cfg.model}`,
          `语言:     ${cfg.language}`,
          `设备:     ${cfg.device}`,
          `端口:     ${sttStatus.port}`,
        ];
        return lines.join('\n');
      }

      case 'setup': {
        const config: Partial<sttMgr.STTServerConfig> = {};
        if (params.model) config.model = params.model;
        if (params.language) config.language = params.language;
        if (Object.keys(config).length > 0) {
          sttMgr.updateConfig(config);
        }

        const sttStatus = await sttMgr.getStatus();

        // 已安装且已在健康运行，直接返回
        if (sttStatus.installed && sttStatus.running && sttStatus.healthy) {
          return '✅ STT 服务已就绪（已安装且运行中）';
        }

        // 需要安装
        if (!sttStatus.installed) {
          const blockId = `stt-setup-${Date.now()}`;
          sendTerminalBlock({ blockId, title: '安装并启动 STT (faster-whisper)', status: 'running' });
          const result = await sttMgr.installAndStart((msg) => {
            sendTerminalBlock({ blockId, line: msg });
          }, config);
          sendTerminalBlock({ blockId, status: result.ok ? 'done' : 'error' });
          if (!result.ok) return `❌ STT 安装失败\n${result.detail}`;
          return `✅ 听觉系统（STT）安装并启动成功！\n\n${result.detail}`;
        }

        // 已安装但未运行，直接启动
        const startResult = await sttMgr.startServer(Object.keys(config).length > 0 ? config : undefined);
        return startResult.ok
          ? `✅ STT 服务已启动\n${startResult.detail}`
          : `❌ STT 服务启动失败\n${startResult.detail}`;
      }

      case 'listen': {
        const source = params.source ?? 'mic';
        const mode = params.mode ?? 'passive';

        const sttStatus = await sttMgr.getStatus();

        if (!sttStatus.installed) {
          return '❌ STT 服务尚未安装，请先执行 setup 初始化听觉系统。';
        }

        // 已安装但进程未运行（如重启后），自动拉起
        if (!sttStatus.running || !sttStatus.healthy) {
          const startResult = await sttMgr.startServer();
          if (!startResult.ok) {
            return `❌ 自动启动 STT 服务失败：${startResult.detail}\n请尝试先执行 setup。`;
          }
        }

        const result = await hearingManager.start(source, mode);
        if (!result.ok) return `❌ ${result.detail}`;

        return [
          `✅ 听觉系统已激活`,
          `模式: ${modeLabels[mode] ?? mode}`,
          `音频源: ${source}`,
          `STT 地址: ${result.wsUrl}`,
          '',
          mode === 'dictation'
            ? '语音输入模式：用户说的话会自动识别后发送给你。'
            : mode === 'passive'
            ? '陪伴监听模式：转录会缓存，你可以用 read 查看用户说了什么。'
            : '总结模式：转录会持续缓存，停止听后你会收到全部文本用于总结。',
        ].join('\n');
      }

      case 'stop': {
        const lines: string[] = [];

        if (hearingManager.isActive()) {
          const result = await hearingManager.stop();
          lines.push(result.ok ? '✅ 已停止听' : `❌ 停止音频捕获失败：${result.detail}`);
        } else {
          lines.push('ℹ️ 听觉系统本就未在运行');
        }

        if (params.stop_server) {
          const result = await sttMgr.stopServer();
          lines.push(result.ok ? '✅ STT 服务已停止' : `❌ STT 服务停止失败：${result.detail}`);
        }

        return lines.join('\n');
      }

      case 'read': {
        if (!hearingManager.isActive()) {
          return '❌ 听觉系统未运行，没有转录缓存。';
        }
        const transcript = hearingManager.getTranscript({
          since: params.since,
          recent: params.recent,
        });
        if (transcript.count === 0) {
          return '（转录缓存为空，还没有听到任何内容）';
        }
        const lines = [
          `=== 转录缓存（${transcript.count} 条，模式: ${modeLabels[transcript.mode] ?? transcript.mode}） ===`,
          '',
          transcript.text,
        ];
        if (params.clear) {
          hearingManager.clearTranscript();
          lines.push('', '（缓存已清空）');
        }
        return lines.join('\n');
      }

      default:
        return `❌ 未知操作: ${(params as any).action}`;
    }
  },
};

export default manageHearingTool;
