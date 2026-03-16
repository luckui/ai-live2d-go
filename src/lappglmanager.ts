/**
 * Live2D Desktop Pet - GL 管理器
 * 修改：WebGL2 context 启用 alpha 通道，实现透明背景
 */

export class LAppGlManager {
  public constructor() {
    this._gl = null;
  }

  public initialize(canvas: HTMLCanvasElement): boolean {
    // 启用 alpha 通道以支持透明背景
    this._gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
    }) as WebGL2RenderingContext;

    if (!this._gl) {
      console.error('[LAppGlManager] 无法初始化 WebGL2');
      return false;
    }
    return true;
  }

  public release(): void {}

  public getGl(): WebGLRenderingContext | WebGL2RenderingContext {
    return this._gl;
  }

  private _gl: WebGL2RenderingContext = null;
}
