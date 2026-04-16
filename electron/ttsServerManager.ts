/**
 * TTS Server 进程管理器（主进程）
 *
 * 管理本地 tts-server（edge-tts）的安装、启动、停止、状态检查。
 *
 * 路径策略：
 *   - 开发：项目根目录下 tts-server/
 *   - 打包：process.resourcesPath/tts-server/（extraResources 复制）
 *
 * venv 始终创建在 tts-server/.venv/，PID 记录在 tts-server/.server.pid
 */

import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { execFile, exec, ChildProcess, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';

// ── 外部依赖注入（避免 bundled require 失效）────────────────────────
let _ttsServiceReset: (() => void) | null = null;
let _setSetting: ((key: string, value: string) => void) | null = null;

/** 由 main.ts 在启动时调用，注入 ttsService 和 db 依赖 */
export function initDeps(deps: {
  resetTTS: () => void;
  setSetting: (key: string, value: string) => void;
}): void {
  _ttsServiceReset = deps.resetTTS;
  _setSetting = deps.setSetting;
}

// ── 路径 ────────────────────────────────────────────────────────────

function getTtsServerDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tts-server')
    : join(app.getAppPath(), 'tts-server');
}

function getVenvDir(): string {
  return join(getTtsServerDir(), '.venv');
}

function getPythonExe(): string {
  const venv = getVenvDir();
  return process.platform === 'win32'
    ? join(venv, 'Scripts', 'python.exe')
    : join(venv, 'bin', 'python');
}

function getPidFile(): string {
  return join(getTtsServerDir(), '.server.pid');
}

// ── 辅助 ────────────────────────────────────────────────────────────

function runCmd(cmd: string, cwd?: string, timeoutMs = 120_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const args  = process.platform === 'win32' ? ['/c', `chcp 65001 >nul && ${cmd}`] : ['-c', cmd];
    const child = execFile(shell, args, {
      cwd: cwd ?? getTtsServerDir(),
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err as any).code ?? 1 : 0,
        stdout: String(stdout),
        stderr: String(stderr),
      });
    });
  });
}

// ── 服务进程 ────────────────────────────────────────────────────────

let serverProcess: ChildProcess | null = null;

// ── 公开 API ────────────────────────────────────────────────────────

export interface TtsServerStatus {
  installed: boolean;     // venv + deps 已安装
  running: boolean;       // 进程存活
  healthy: boolean;       // HTTP /health 可达
  pid: number | null;
  port: number;
  serverDir: string;
}

const SERVER_PORT = 9880;
const LOCAL_URL = `http://127.0.0.1:${SERVER_PORT}`;

/**
 * 获取服务当前状态
 */
export async function getStatus(): Promise<TtsServerStatus> {
  const serverDir = getTtsServerDir();
  const installed = existsSync(getPythonExe());
  const pid = readPid();
  const running = pid !== null && isProcessAlive(pid);
  let healthy = false;

  if (running) {
    try {
      const resp = await fetch(`${LOCAL_URL}/health`, { signal: AbortSignal.timeout(3000) });
      healthy = resp.ok;
    } catch { /* 不可达 */ }
  }

  return { installed, running, healthy, pid, port: SERVER_PORT, serverDir };
}

/**
 * 安装：创建 venv + pip install
 */
export async function install(onProgress?: (msg: string) => void): Promise<{ ok: boolean; detail: string }> {
  const serverDir = getTtsServerDir();
  if (!existsSync(join(serverDir, 'server.py'))) {
    return { ok: false, detail: `tts-server 目录不存在或缺少 server.py: ${serverDir}` };
  }

  const log = (m: string) => { onProgress?.(m); };

  // 1. 检查系统 Python
  log('检查系统 Python…');
  const pyCheck = await runCmd('python --version');
  if (pyCheck.code !== 0 || !pyCheck.stdout.toLowerCase().includes('python')) {
    const py3Check = await runCmd('python3 --version');
    if (py3Check.code !== 0) {
      return { ok: false, detail: '未找到系统 Python，请先安装 Python 3.10+' };
    }
  }
  const pyCmd = pyCheck.code === 0 && pyCheck.stdout.toLowerCase().includes('python') ? 'python' : 'python3';
  log(`使用 ${pyCmd}: ${(pyCheck.code === 0 ? pyCheck.stdout : (await runCmd('python3 --version')).stdout).trim()}`);

  // 2. 创建 venv
  const venvDir = getVenvDir();
  if (!existsSync(venvDir)) {
    log('创建虚拟环境…');
    const venvResult = await runCmd(`${pyCmd} -m venv .venv`, serverDir, 60_000);
    if (venvResult.code !== 0) {
      return { ok: false, detail: `创建 venv 失败:\n${venvResult.stderr}` };
    }
  } else {
    log('虚拟环境已存在，跳过创建');
  }

  // 3. pip install
  log('安装依赖（pip install -r requirements.txt）…');
  const pipExe = process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'pip.exe')
    : join(venvDir, 'bin', 'pip');
  const pipResult = await runCmd(
    `"${pipExe}" install -r requirements.txt --disable-pip-version-check`,
    serverDir,
    300_000, // 5 分钟
  );

  if (pipResult.code !== 0) {
    return { ok: false, detail: `pip install 失败:\n${pipResult.stderr.slice(0, 1000)}` };
  }

  log('安装完成');
  return { ok: true, detail: pipResult.stdout.slice(-500) };
}

/**
 * 启动 TTS Server 子进程
 */
export async function startServer(): Promise<{ ok: boolean; detail: string }> {
  // 如果已在运行
  const status = await getStatus();
  if (status.running && status.healthy) {
    return { ok: true, detail: `TTS Server 已在运行 (PID ${status.pid})` };
  }

  const pythonExe = getPythonExe();
  if (!existsSync(pythonExe)) {
    return { ok: false, detail: '未安装，请先执行 install' };
  }

  const serverDir = getTtsServerDir();

  // 终止旧进程（如果有残留）
  await stopServer();

  return new Promise((resolve) => {
    const child = spawn(pythonExe, ['server.py'], {
      cwd: serverDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    serverProcess = child;
    let started = false;
    let output = '';

    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      output += text;
      // uvicorn 启动成功会打印 "Uvicorn running on"
      if (!started && (text.includes('Uvicorn running') || text.includes('Application startup complete'))) {
        started = true;
        writePid(child.pid!);
        resolve({ ok: true, detail: `TTS Server 已启动 (PID ${child.pid})` });
      }
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', (err) => {
      if (!started) {
        resolve({ ok: false, detail: `启动失败: ${err.message}` });
      }
    });

    child.on('exit', (code) => {
      serverProcess = null;
      cleanPid();
      if (!started) {
        resolve({ ok: false, detail: `进程退出 (code=${code})\n${output.slice(-500)}` });
      }
    });

    // 超时 15 秒
    setTimeout(() => {
      if (!started) {
        resolve({ ok: false, detail: `启动超时（15s）\n${output.slice(-500)}` });
      }
    }, 15_000);
  });
}

/**
 * 停止 TTS Server
 */
export async function stopServer(): Promise<{ ok: boolean; detail: string }> {
  // 优先终止管理的子进程
  if (serverProcess && !serverProcess.killed) {
    try {
      serverProcess.kill('SIGTERM');
      serverProcess = null;
    } catch { /* ignore */ }
  }

  // 也尝试通过 PID 文件终止
  const pid = readPid();
  if (pid !== null && isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch { /* ignore */ }
  }
  cleanPid();

  // 等待端口释放
  await new Promise(r => setTimeout(r, 500));
  return { ok: true, detail: '已停止' };
}

/**
 * 安装 + 启动 + 自动配置 .env（一键安装）
 */
export async function installAndStart(onProgress?: (msg: string) => void): Promise<{ ok: boolean; detail: string }> {
  // 1. 安装
  const installResult = await install(onProgress);
  if (!installResult.ok) return installResult;

  // 2. 启动
  onProgress?.('启动 TTS Server…');
  const startResult = await startServer();
  if (!startResult.ok) return startResult;

  // 3. 自动更新 .env 指向本地服务
  onProgress?.('配置环境变量…');
  configureEnvForLocal();

  onProgress?.('全部完成');
  return { ok: true, detail: `${startResult.detail}\nTTS 已配置为本地服务 (${LOCAL_URL})` };
}

/**
 * 将内存配置指向本地 tts-server 并通知 UI 刷新（持久化到 SQLite）
 */
export function configureEnvForLocal(): void {
  process.env['TTS_ENABLED']  = 'true';
  process.env['TTS_URL']      = LOCAL_URL;
  process.env['TTS_SPEAKER']  = process.env['TTS_SPEAKER'] || 'xiaoxiao';
  process.env['TTS_LANGUAGE'] = process.env['TTS_LANGUAGE'] || 'Auto';
  process.env['TTS_API_KEY']  = '';

  _ttsServiceReset?.();

  // 持久化到 SQLite
  _setSetting?.('tts_config', JSON.stringify({
    enabled: true,
    url: LOCAL_URL,
    apiKey: '',
    speaker: process.env['TTS_SPEAKER'],
    language: process.env['TTS_LANGUAGE'],
  }));

  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('tts:config-changed');
  }
}

export function getLocalUrl(): string {
  return LOCAL_URL;
}

/**
 * 禁用 TTS（仅内存 + 通知 UI，不写 .env）
 */
export function disableTTS(): void {
  process.env['TTS_ENABLED'] = 'false';
  if (_ttsServiceReset) {
    _ttsServiceReset();
    console.info('[TTS] disableTTS: reset() called, TTS_ENABLED=false');
  } else {
    console.warn('[TTS] disableTTS: _ttsServiceReset is null! initDeps() was not called.');
  }

  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('tts:config-changed');
  }
}

/**
 * 启用 TTS（仅内存 + 通知 UI）
 */
export function enableTTS(): void {
  process.env['TTS_ENABLED'] = 'true';
  if (_ttsServiceReset) {
    _ttsServiceReset();
    console.info('[TTS] enableTTS: reset() called, TTS_ENABLED=true, TTS_URL=' + (process.env['TTS_URL'] || '(empty)'));
  } else {
    console.warn('[TTS] enableTTS: _ttsServiceReset is null! initDeps() was not called.');
  }

  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('tts:config-changed');
  }
}

// ── PID 管理 ────────────────────────────────────────────────────────

function readPid(): number | null {
  try {
    const raw = readFileSync(getPidFile(), 'utf-8').trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch { return null; }
}

function writePid(pid: number): void {
  try { writeFileSync(getPidFile(), String(pid), 'utf-8'); } catch { /* ignore */ }
}

function cleanPid(): void {
  try { unlinkSync(getPidFile()); } catch { /* ignore */ }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

// ── 进程退出时清理 ──────────────────────────────────────────────────

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    try { serverProcess.kill('SIGTERM'); } catch { /* ignore */ }
  }
});
