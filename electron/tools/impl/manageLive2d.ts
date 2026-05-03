/**
 * Skill: manage_live2d
 *
 * 让 AI Agent 控制 Live2D 模型的表情、动作和参数。
 * 支持：情绪设置、动作播放、参数直控、当前状态查询。
 *
 * 情绪 → 参数映射（Hiyori 无 exp3 文件，使用直接参数注入）：
 *   happy / sad / angry / surprised / thinking / shy / embarrassed / neutral
 */

import type { ToolDefinition, ToolExecuteResult } from '../types';
import { sendLive2DCommand } from '../../live2dBridge';

// ── 情绪 → 动作组映射（Hiyori_pro 可用动作）───────────────────────
const EMOTION_MOTION: Record<string, { group: string; no?: number }> = {
  happy:       { group: 'Tap',       no: 0 },
  surprised:   { group: 'Flick',     no: 0 },
  sad:         { group: 'FlickDown', no: 0 },
  angry:       { group: 'FlickUp',   no: 0 },
  shy:         { group: 'Tap@Body',  no: 0 },
  embarrassed: { group: 'Tap@Body',  no: 0 },
  thinking:    { group: 'Idle'                },
  neutral:     { group: 'Idle'                },
};

interface ManageLive2DParams {
  action: 'set_emotion' | 'play_motion' | 'set_param' | 'query';
  /** set_emotion：情绪名 */
  emotion?: string;
  /** set_emotion：持续时间 ms（0=永久） */
  duration_ms?: number;
  /** set_emotion：是否同时触发对应动作（默认 true） */
  play_motion?: boolean;
  /** play_motion：动作组名 */
  motion_group?: string;
  /** play_motion：组内序号（省略=随机） */
  motion_no?: number;
  /** play_motion：优先级 0-3 */
  priority?: number;
  /** set_param：参数 ID */
  parameter_id?: string;
  /** set_param：参数值 */
  value?: number;
  /** set_param：过渡时间 ms */
  transition_ms?: number;
}

const manageLive2dTool: ToolDefinition<ManageLive2DParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'manage_live2d',
      description:
        '控制桌面 Live2D 宠物的表情和动作。\n' +
        '当你想要表达情感、回应用户情绪、表现角色个性时使用此工具。\n\n' +
        '可用情绪（emotion）：\n' +
        '  neutral（平静）/ happy（开心）/ sad（难过）/ angry（生气）\n' +
        '  surprised（惊讶）/ thinking（思考）/ shy（害羞）/ embarrassed（尴尬）\n\n' +
        '可用动作组（motion_group，Hiyori_pro 模型）：\n' +
        '  Idle / Tap / TapBody / Flick / FlickUp / FlickDown / Flick@Body',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['set_emotion', 'play_motion', 'set_param', 'query'],
            description: '操作类型：set_emotion=设置情绪, play_motion=播放动作, set_param=直接设参数, query=查询状态',
          },
          emotion: {
            type: 'string',
            enum: ['neutral', 'happy', 'sad', 'angry', 'surprised', 'thinking', 'shy', 'embarrassed'],
            description: '（set_emotion 必填）目标情绪',
          },
          duration_ms: {
            type: 'number',
            description: '（set_emotion）情绪持续时间（ms），0 或省略 = 永久',
          },
          play_motion: {
            type: 'boolean',
            description: '（set_emotion）是否同时触发对应动作，默认 true',
          },
          motion_group: {
            type: 'string',
            description: '（play_motion 必填）动作组名，如 "Tap"、"Flick"',
          },
          motion_no: {
            type: 'number',
            description: '（play_motion）组内序号，省略则随机',
          },
          priority: {
            type: 'number',
            description: '（play_motion）优先级：0=无/1=idle/2=normal/3=force，默认 2',
          },
          parameter_id: {
            type: 'string',
            description: '（set_param 必填）Live2D 参数 ID，如 "ParamMouthForm"',
          },
          value: {
            type: 'number',
            description: '（set_param 必填）目标参数值',
          },
          transition_ms: {
            type: 'number',
            description: '（set_param）过渡时间 ms，0=立即，默认 200',
          },
        },
        required: ['action'],
      },
    },
  },

  async execute(params): Promise<ToolExecuteResult> {
    const { action } = params;

    switch (action) {
      case 'query': {
        const ok = sendLive2DCommand({ type: 'query' });
        return ok ? '已发送查询命令到 Live2D' : 'Live2D 渲染层未就绪';
      }

      case 'set_emotion': {
        const emotion = (params.emotion ?? 'neutral') as string;
        const validEmotions = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'thinking', 'shy', 'embarrassed'];
        if (!validEmotions.includes(emotion)) {
          return `错误：未知情绪 "${emotion}"，可用值：${validEmotions.join(' / ')}`;
        }

        // 类型安全写法
        const emotionCmd = {
          type: 'emotion' as const,
          emotion: emotion as 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'thinking' | 'shy' | 'embarrassed',
          durationMs: params.duration_ms ?? 0,
          playMotion: params.play_motion ?? true,
        };
        const ok = sendLive2DCommand(emotionCmd);
        if (!ok) return 'Live2D 渲染层未就绪，命令未送达';

        // 如果需要触发对应动作
        if (emotionCmd.playMotion) {
          const motionInfo = EMOTION_MOTION[emotion];
          if (motionInfo) {
            sendLive2DCommand({
              type: 'motion',
              group: motionInfo.group,
              no: motionInfo.no,
              priority: 2,
            });
          }
        }

        return `已设置情绪：${emotion}`;
      }

      case 'play_motion': {
        if (!params.motion_group) {
          return '错误：play_motion 需要 motion_group 参数';
        }
        const ok = sendLive2DCommand({
          type: 'motion',
          group: params.motion_group,
          no: params.motion_no,
          priority: params.priority ?? 2,
        });
        if (!ok) return 'Live2D 渲染层未就绪，命令未送达';
        return `已触发动作：${params.motion_group}[${params.motion_no ?? '随机'}]`;
      }

      case 'set_param': {
        if (!params.parameter_id) {
          return '错误：set_param 需要 parameter_id 参数';
        }
        if (params.value === undefined) {
          return '错误：set_param 需要 value 参数';
        }
        const ok = sendLive2DCommand({
          type: 'param',
          parameterId: params.parameter_id,
          value: params.value,
          transitionMs: params.transition_ms ?? 200,
        });
        if (!ok) return 'Live2D 渲染层未就绪，命令未送达';
        return `已设置参数 ${params.parameter_id} = ${params.value}`;
      }

      default:
        return `错误：未知操作：${action}`;
    }
  },
};

export default manageLive2dTool;
