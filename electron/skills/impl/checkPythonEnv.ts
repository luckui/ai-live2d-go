/**
 * Skill: check_python_env
 *
 * 检查用户系统的 Python 开发环境，包括：
 *   1. 系统级 Python（python / python3 的路径与版本）
 *   2. pip 版本
 *   3. Conda（若已安装：版本 + 全部 env list）
 *
 * 跨平台策略：
 *   - where（Windows）/ which（macOS/Linux）定位可执行文件
 *   - python 和 python3 都尝试，取先得到的
 *
 * 执行完后直接将所有原始输出拼成一段文字返回给 AI，
 * AI 根据内容整理后用自然语言告诉用户。
 */

import type { ToolDefinition, ToolExecuteResult } from '../../tools/types';
import { getSkillRegistry } from '../skillContext';

const checkPythonEnvSkill: ToolDefinition<Record<never, never>> = {
  schema: {
    type: 'function',
    function: {
      name: 'check_python_env',
      description:
        '检查当前系统的 Python 开发环境。\n' +
        '自动探测：系统 Python / Python3 路径与版本、pip 版本、\n' +
        'Conda 是否安装（若有则列出全部环境 env list）。\n' +
        '跨平台支持 Windows / macOS / Linux。\n' +
        '执行后将原始结果汇总，由 AI 整理后回答用户。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },

  isSkill: true,

  async execute(): Promise<ToolExecuteResult> {
    const registry = getSkillRegistry();
    const run = (cmd: string) =>
      registry.execute('run_command', JSON.stringify({ command: cmd, timeoutMs: 10000 })) as Promise<string>;

    const isWin = process.platform === 'win32';
    const sections: string[] = [];

    // ── 1. 系统 Python 路径 ───────────────────────────────────────
    const whereCmd = isWin ? 'where python' : 'which python python3 2>/dev/null || true';
    const whereResult = await run(whereCmd);
    sections.push(`=== Python 可执行文件位置 ===\n$ ${whereCmd}\n${whereResult}`);

    // ── 2. python --version ───────────────────────────────────────
    const pyVersion = await run('python --version 2>&1');
    sections.push(`=== python --version ===\n${pyVersion}`);

    // ── 3. python3 --version（Linux/macOS 可能只有 python3）───────
    if (!isWin) {
      const py3Version = await run('python3 --version 2>&1');
      sections.push(`=== python3 --version ===\n${py3Version}`);
    }

    // ── 4. pip / pip3 版本 ────────────────────────────────────────
    const pipCmd = isWin ? 'pip --version 2>&1' : 'pip --version 2>&1 || pip3 --version 2>&1 || true';
    const pipVersion = await run(pipCmd);
    sections.push(`=== pip --version ===\n${pipVersion}`);

    // ── 5. Conda 版本 ─────────────────────────────────────────────
    const condaVersion = await run('conda --version 2>&1');
    sections.push(`=== conda --version ===\n${condaVersion}`);

    // ── 6. Conda env list（仅当 conda 存在时有意义）──────────────
    const condaEnvList = await run('conda env list 2>&1');
    sections.push(`=== conda env list ===\n${condaEnvList}`);

    // ── 7. pyenv（若有）─────────────────────────────────────────
    const pyenvVersion = await run(
      isWin ? 'pyenv version 2>&1' : 'pyenv version 2>&1 || true'
    );
    if (pyenvVersion && !pyenvVersion.includes('不是内部或外部命令') && !pyenvVersion.includes('not found')) {
      sections.push(`=== pyenv version ===\n${pyenvVersion}`);
    }

    const summary = sections.join('\n\n');

    return (
      `以下是系统 Python 环境的原始探测结果，请整理后用自然语言告诉用户：\n\n` +
      `\`\`\`\n${summary}\n\`\`\``
    );
  },
};

export default checkPythonEnvSkill;
