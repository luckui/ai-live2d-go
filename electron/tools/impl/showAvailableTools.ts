import type { ToolDefinition } from '../types';
import { getAgentMode } from '../../agentMode';
import { toolRegistry } from '../index';

/**
 * 显示当前模式下可用的工具列表
 * 用于 AI 主动查询自己的能力边界
 */
const showAvailableTools: ToolDefinition<{}> = {
  schema: {
    type: 'function',
    function: {
      name: 'show_available_tools',
      description: '显示当前模式下可用的所有工具列表。用于查询自己的能力边界。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },

  async execute() {
    const mode = getAgentMode();
    const schemas = toolRegistry.getSchemasForToolset([mode]);
    const toolNames = schemas.map(s => s.function.name).sort();

    return JSON.stringify({
      mode,
      tools: toolNames,
      count: toolNames.length,
    }, null, 2);
  },
};

export default showAvailableTools;
