import type { ToolDefinition } from '../types';

interface DatetimeParams {
  timezone?: string;
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/**
 * 获取当前日期时间工具
 *
 * 当用户询问"现在几点"、"今天是几号"、"今天星期几"等问题时触发。
 */
const datetimeTool: ToolDefinition<DatetimeParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'get_current_datetime',
      description:
        '获取当前日期、时间和星期几。当用户询问时间、日期、今天几号、星期几等信息时调用。',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: '时区标识，例如 "Asia/Shanghai"，默认使用系统本地时区',
          },
        },
        required: [],
      },
    },
  },

  execute(_params) {
    const now = new Date();
    const locale = 'zh-CN';
    const dateStr = now.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const timeStr = now.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const dayStr = WEEKDAYS[now.getDay()];
    return `当前日期时间：${dateStr} ${dayStr} ${timeStr}`;
  },
};

export default datetimeTool;
