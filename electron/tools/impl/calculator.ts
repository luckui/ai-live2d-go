import type { ToolDefinition } from '../types';

interface CalculatorParams {
  expression: string;
}

/**
 * 安全的数学表达式求值
 *
 * 白名单字符校验：只允许数字、四则运算符、括号、空格和小数点，
 * 防止代码注入，同时不引入额外依赖。
 */
function safeEval(expression: string): number {
  // 只允许: 数字 0-9、运算符 + - * / % **、括号 () []、空格、小数点
  if (!/^[\d\s+\-*/()[\].%^eE]+$/.test(expression)) {
    throw new Error('表达式含非法字符，仅支持数字与基本运算符');
  }
  // eslint-disable-next-line no-new-func
  const result = new Function(`"use strict"; return (${expression})`)() as unknown;
  if (typeof result !== 'number') throw new Error('计算结果不是数字');
  if (!isFinite(result)) throw new Error(`计算结果为 ${result}`);
  return result;
}

/**
 * 数学计算工具
 *
 * 当用户需要精确数值计算（加减乘除、百分比、幂运算等）时调用。
 */
const calculatorTool: ToolDefinition<CalculatorParams> = {
  schema: {
    type: 'function',
    function: {
      name: 'calculate',
      description:
        '对数学表达式进行精确计算，支持加减乘除、括号、幂运算（**）、取余（%）。当用户需要计算具体数值时调用。',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description:
              '合法的数学表达式，例如 "2 + 3 * 4"、"(100 - 20) / 4"、"2 ** 10"',
          },
        },
        required: ['expression'],
      },
    },
  },

  execute({ expression }) {
    const result = safeEval(expression.trim());
    // 避免浮点尾巴：限制 10 位有效小数，再去掉末尾零
    const formatted = Number.isInteger(result)
      ? result.toString()
      : parseFloat(result.toFixed(10)).toString();
    return `${expression} = ${formatted}`;
  },
};

export default calculatorTool;
