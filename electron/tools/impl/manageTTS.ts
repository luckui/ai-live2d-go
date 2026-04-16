/**
 * Skill: manage_tts
 *
 * 管理本地 TTS 语音合成服务（基于 edge-tts）。
 * 支持操作：status / install / start / stop / install_and_start
 *
 * 该工具让 AI Agent 能响应用户的语音系统安装/管理请求，
 * 自动完成 Python 虚拟环境创建、依赖安装、服务启停。
 */

import type { ToolDefinition, ToolExecuteResult } from '../types';
import * as mgr from '../../ttsServerManager';

interface ManageTTSParams {
  /** 要执行的操作 */
  action: 'status' | 'install' | 'start' | 'stop' | 'install_and_start' | 'enable' | 'disable';
}

const manageTTSTool: ToolDefinition<ManageTTSParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'manage_tts',
      description:
        '管理 TTS 语音合成功能。\n' +
        '当用户说"开启语音"、"关闭语音"、"安装语音"等时使用此工具。\n\n' +
        '操作说明：\n' +
        '  - enable：开启语音（会自动启动本地服务，如未安装会提示）\n' +
        '  - disable：关闭语音（同时停止本地服务）\n' +
        '  - install_and_start：首次安装并启动（用户第一次要求语音功能时用）\n' +
        '  - status：查看当前状态\n\n' +
        '【简单规则】\n' +
        '  用户说 开启/启用/打开 语音 → enable\n' +
        '  用户说 关闭/禁用/停止 语音 → disable\n' +
        '  用户说 安装语音 → install_and_start\n' +
        '  用户问语音状态 → status',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'install', 'start', 'stop', 'install_and_start', 'enable', 'disable'],
            description: '要执行的操作。常用：enable=开启语音, disable=关闭语音, install_and_start=首次安装',
          },
        },
        required: ['action'],
      },
    },
  },

  isSkill: true,

  async execute(params: ManageTTSParams): Promise<ToolExecuteResult> {
    switch (params.action) {
      case 'status': {
        const s = await mgr.getStatus();
        const lines = [
          `=== TTS 本地服务状态 ===`,
          `安装目录: ${s.serverDir}`,
          `已安装:   ${s.installed ? '✅ 是' : '❌ 否'}`,
          `运行中:   ${s.running ? '✅ 是 (PID ' + s.pid + ')' : '❌ 否'}`,
          `健康检查: ${s.healthy ? '✅ 正常' : '❌ 不可达'}`,
          `端口:     ${s.port}`,
          `本地地址: ${mgr.getLocalUrl()}`,
          '',
          `当前 TTS 配置:`,
          `  TTS_ENABLED  = ${process.env['TTS_ENABLED'] ?? '(未设置)'}`,
          `  TTS_URL      = ${process.env['TTS_URL'] ?? '(未设置)'}`,
          `  TTS_SPEAKER  = ${process.env['TTS_SPEAKER'] ?? '(未设置)'}`,
        ];
        return lines.join('\n');
      }

      case 'install': {
        const logs: string[] = [];
        const result = await mgr.install((msg) => logs.push(msg));
        return result.ok
          ? `✅ 安装成功\n${logs.join('\n')}\n${result.detail}`
          : `❌ 安装失败\n${logs.join('\n')}\n${result.detail}`;
      }

      case 'start': {
        const result = await mgr.startServer();
        return result.ok
          ? `✅ ${result.detail}`
          : `❌ ${result.detail}`;
      }

      case 'stop': {
        const result = await mgr.stopServer();
        // 停止本地服务时同时禁用 TTS
        mgr.disableTTS();
        return result.ok
          ? `✅ ${result.detail}\nTTS 语音已禁用。`
          : `❌ ${result.detail}`;
      }

      case 'enable': {
        // enable = 确保服务在跑 + 打开开关
        const status = await mgr.getStatus();
        if (!status.installed) {
          return '❌ 本地 TTS 服务尚未安装，请先使用 install_and_start 安装。';
        }
        if (!status.running) {
          const startResult = await mgr.startServer();
          if (!startResult.ok) {
            return `❌ 启动本地服务失败: ${startResult.detail}`;
          }
        }
        // 服务已在运行，配置环境并启用
        mgr.configureEnvForLocal();
        return `✅ TTS 语音已开启\n服务地址: ${mgr.getLocalUrl()}`;
      }

      case 'disable': {
        // disable = 关开关 + 停服务
        mgr.disableTTS();
        const st = await mgr.getStatus();
        if (st.running) {
          await mgr.stopServer();
        }
        return '✅ TTS 语音已关闭，服务已停止。';
      }

      case 'install_and_start': {
        const logs: string[] = [];
        const result = await mgr.installAndStart((msg) => logs.push(msg));
        if (result.ok) {
          return [
            `✅ TTS 语音系统安装并启动成功！`,
            '',
            `进度日志:`,
            ...logs.map(l => `  ${l}`),
            '',
            result.detail,
            '',
            `用户现在可以:`,
            `  - 直接与我对话，回复将自动播放语音`,
            `  - 在设置页的「语音合成」标签页调整音色和参数`,
            `  - 默认音色: xiaoxiao（晓晓，中文女声）`,
          ].join('\n');
        } else {
          return `❌ TTS 安装失败\n${logs.join('\n')}\n${result.detail}`;
        }
      }

      default:
        return `❌ 未知操作: ${(params as any).action}`;
    }
  },
};

export default manageTTSTool;
