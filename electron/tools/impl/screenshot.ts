/**
 * 截图工具
 *
 * 使用 Electron 内置 desktopCapturer + nativeImage，零额外依赖，
 * 跨平台支持 Windows / macOS / Linux。
 *
 * 注意：
 * - 返回 ToolImageResult，aiService 会自动将图像注入多模态 user 消息
 * - 需要视觉模型才能理解截图内容（如 doubao-seed-1-8-xxx、doubao-1.5-vision-pro 等）
 * - macOS 下首次调用可能弹出屏幕录制权限请求
 */

import { desktopCapturer, nativeImage } from 'electron';
import type { ToolDefinition, ToolImageResult } from '../types';

/** 截图最大宽度（px），超出时等比缩小以减小发送数据量 */
const MAX_WIDTH = 1280;

async function captureScreen(): Promise<Buffer> {
  // 获取所有屏幕源，thumbnailSize 设大以保证画质
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 3840, height: 2160 },
  });

  if (sources.length === 0) {
    throw new Error('未找到可用的屏幕源，请检查系统权限');
  }

  // 取主屏幕（第一个 entire_screen 源）
  const primarySource =
    sources.find((s) => s.name === 'Entire Screen' || s.name === 'Screen 1') ?? sources[0];

  let img = primarySource.thumbnail;
  const size = img.getSize();

  // 等比缩小：超过 MAX_WIDTH 才压缩
  if (size.width > MAX_WIDTH) {
    img = nativeImage.createFromBuffer(
      img.resize({ width: MAX_WIDTH }).toPNG()
    );
  }

  return img.toPNG();
}

const screenshotTool: ToolDefinition<Record<string, never>> = {
  schema: {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description:
        '截取用户当前屏幕，用于分析用户正在做什么、查看屏幕内容。' +
        '当用户询问"我在干嘛"、"我现在在做什么"、"帮我看看屏幕"、' +
        '"我屏幕上有什么"、"帮我分析一下我的屏幕"等问题时调用。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },

  async execute(_params): Promise<ToolImageResult> {
    const pngBuffer = await captureScreen();
    return {
      text: '屏幕截图已获取，正在分析图像内容…',
      imageBase64: pngBuffer.toString('base64'),
      mimeType: 'image/png',
    };
  },
};

export default screenshotTool;
