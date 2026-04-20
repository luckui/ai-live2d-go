/**
 * Skill: manage_hearing
 *
 * 管理听觉系统（语音转文字 / STT）。
 * 支持操作：status / install / start / stop / install_and_start
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
  action: 'status' | 'install' | 'start' | 'stop' | 'install_and_start'
    | 'start_listening' | 'stop_listening' | 'get_transcript' | 'clear_transcript';
  /** 音频源，start_listening 时指定 */
  source?: AudioSource;
  /** 听觉模式 */
  mode?: HearingMode;
  /** Whisper 模型大小 */
  model?: STTModelSize;
  /** 识别语言 */
  language?: string;
  /** get_transcript: 只获取此时间戳之后的条目 */
  since?: number;
  /** get_transcript: 只获取最近 N 条 */
  recent?: number;
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
        '  - status：查看听觉系统状态（STT 服务 + 听觉运行状态）\n' +
        '  - install：仅安装 STT 环境（创建 venv + 安装 faster-whisper）\n' +
        '  - start：仅启动 STT WebSocket 服务\n' +
        '  - stop：停止 STT 服务\n' +
        '  - install_and_start：首次安装并启动 STT 服务\n' +
        '  - start_listening：开始听（启动音频捕获 + 连接 STT）\n' +
        '  - stop_listening：停止听（停止音频捕获）\n' +
        '  - get_transcript：获取转录缓存内容（陪伴监听模式下读取用户说了什么）\n' +
        '  - clear_transcript：清空转录缓存\n\n' +
        '听觉模式（start_listening 时用 mode 指定）：\n' +
        '  - dictation：语音输入 — 用户说完后自动识别为消息发送给你\n' +
        '  - passive：陪伴监听 — 只缓存转录，你需要用 get_transcript 读取\n' +
        '  - summary：总结模式 — 缓存转录，停止听时自动发送全文请你总结\n\n' +
        '可用模型（越大越准，但越慢越占空间）：\n' +
        '  - tiny：最快，最不准（~75MB）\n' +
        '  - base：推荐入门（~150MB）\n' +
        '  - small：较好平衡（~500MB）\n' +
        '  - medium：高精度（~1.5GB）\n' +
        '  - large-v3：最准（~3GB，建议 GPU）\n\n' +
        '音频源：\n' +
        '  - mic：麦克风（默认）\n' +
        '  - system：系统音频（听视频/播放内容）\n' +
        '  - both：麦克风 + 系统音频\n\n' +
        '【简单规则】\n' +
        '  用户说 安装听觉/语音识别 → install_and_start\n' +
        '  用户说 开始听/帮我听 → start_listening（根据意图选 mode）\n' +
        '  用户说 别听了/停止听 → stop_listening\n' +
        '  用户说 听一下视频 → start_listening + source=system\n' +
        '  用户说 你听到了什么 → get_transcript\n' +
        '  用户问语音识别状态 → status',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'install', 'start', 'stop', 'install_and_start',
                   'start_listening', 'stop_listening', 'get_transcript', 'clear_transcript'],
            description: '要执行的操作',
          },
          source: {
            type: 'string',
            enum: ['mic', 'system', 'both'],
            description: '音频源。start_listening 时指定，默认 mic',
          },
          mode: {
            type: 'string',
            enum: ['dictation', 'passive', 'summary'],
            description: '听觉模式。start_listening 时指定。dictation=语音输入, passive=陪伴监听, summary=总结模式。默认 passive',
          },
          model: {
            type: 'string',
            enum: ['tiny', 'base', 'small', 'medium', 'large-v3'],
            description: 'Whisper 模型大小。install_and_start 或 start 时指定，默认 base',
          },
          language: {
            type: 'string',
            description: '识别语言代码，如 zh（中文）、en（英文）、ja（日文）。默认 zh',
          },
          since: {
            type: 'number',
            description: 'get_transcript 时使用：只获取此时间戳（毫秒）之后的转录条目',
          },
          recent: {
            type: 'number',
            description: 'get_transcript 时使用：只获取最近 N 条转录',
          },
        },
        required: ['action'],
      },
    },
  },

  isSkill: true,

  async execute(params: ManageHearingParams): Promise<ToolExecuteResult> {
    switch (params.action) {
      case 'status': {
        const sttStatus = await sttMgr.getStatus();
        const hearingStatus = await hearingManager.getStatus();
        const cfg = sttMgr.getConfig();
        const modeLabels: Record<string, string> = {
          dictation: '语音输入', passive: '陪伴监听', summary: '总结模式',
        };
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

      case 'install': {
        if (params.model) {
          sttMgr.updateConfig({ model: params.model });
        }
        if (params.language) {
          sttMgr.updateConfig({ language: params.language });
        }
        const blockId = `stt-install-${Date.now()}`;
        sendTerminalBlock({ blockId, title: '安装 STT 环境 (faster-whisper)', status: 'running' });
        const logs: string[] = [];
        const result = await sttMgr.install((msg) => {
          logs.push(msg);
          sendTerminalBlock({ blockId, line: msg });
        });
        sendTerminalBlock({ blockId, status: result.ok ? 'done' : 'error' });
        return result.ok
          ? `✅ STT 环境安装成功\n${result.detail}`
          : `❌ STT 环境安装失败\n${result.detail}`;
      }

      case 'start': {
        const config: Partial<sttMgr.STTServerConfig> = {};
        if (params.model) config.model = params.model;
        if (params.language) config.language = params.language;
        const result = await sttMgr.startServer(Object.keys(config).length > 0 ? config : undefined);
        return result.ok ? `✅ ${result.detail}` : `❌ ${result.detail}`;
      }

      case 'stop': {
        // 先停止听觉，再停止 STT 服务
        if (hearingManager.isActive()) {
          await hearingManager.stop();
        }
        const result = await sttMgr.stopServer();
        return result.ok ? `✅ STT 服务已停止` : `❌ ${result.detail}`;
      }

      case 'install_and_start': {
        const config: Partial<sttMgr.STTServerConfig> = {};
        if (params.model) config.model = params.model;
        if (params.language) config.language = params.language;

        const blockId = `stt-install-${Date.now()}`;
        sendTerminalBlock({ blockId, title: '安装并启动 STT (faster-whisper)', status: 'running' });

        const logs: string[] = [];
        const result = await sttMgr.installAndStart((msg) => {
          logs.push(msg);
          sendTerminalBlock({ blockId, line: msg });
        }, config);

        sendTerminalBlock({ blockId, status: result.ok ? 'done' : 'error' });

        if (result.ok) {
          return [
            '✅ 听觉系统（STT）安装并启动成功！',
            '',
            result.detail,
            '',
            '现在可以使用 start_listening 开始听了。',
          ].join('\n');
        } else {
          return `❌ STT 安装失败\n${result.detail}`;
        }
      }

      case 'start_listening': {
        const source = params.source ?? 'mic';
        const mode = params.mode ?? 'passive';
        const modeLabels: Record<string, string> = {
          dictation: '语音输入', passive: '陪伴监听', summary: '总结模式',
        };
        const result = await hearingManager.start(source, mode);
        if (result.ok) {
          return [
            `✅ 听觉系统已激活`,
            `模式: ${modeLabels[mode] ?? mode}`,
            `音频源: ${source}`,
            `STT 地址: ${result.wsUrl}`,
            '',
            mode === 'dictation'
              ? '语音输入模式：用户说的话会自动识别后发送给你。'
              : mode === 'passive'
              ? '陪伴监听模式：转录会缓存，你可以用 get_transcript 查看用户说了什么。'
              : '总结模式：转录会持续缓存，停止听后你会收到全部文本用于总结。',
          ].join('\n');
        } else {
          return `❌ ${result.detail}`;
        }
      }

      case 'stop_listening': {
        const result = await hearingManager.stop();
        return result.ok ? `✅ 已停止听` : `❌ ${result.detail}`;
      }

      case 'get_transcript': {
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
          `=== 转录缓存（${transcript.count} 条，模式: ${transcript.mode}） ===`,
          '',
          transcript.text,
        ];
        return lines.join('\n');
      }

      case 'clear_transcript': {
        hearingManager.clearTranscript();
        return '✅ 转录缓存已清空';
      }

      default:
        return `❌ 未知操作: ${(params as any).action}`;
    }
  },
};

export default manageHearingTool;
