import { LAppDelegate } from './lappdelegate';
import { initChat } from './chat';
import { initSettings } from './settings';
import './style.css';

// ─── 等待 DOM 就绪后初始化 UI ──────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSettings();
  initChat();
});

// ─── 等待页面加载后初始化 Live2D ───────────────────────
window.addEventListener(
  'load',
  (): void => {
    if (!LAppDelegate.getInstance().initialize()) {
      console.error('[Live2D] 初始化失败');
      return;
    }
    LAppDelegate.getInstance().run();
  },
  { passive: true }
);

// ─── 页面卸载时释放 Live2D 资源 ───────────────────────
window.addEventListener(
  'beforeunload',
  (): void => {
    LAppDelegate.releaseInstance();
  },
  { passive: true }
);
