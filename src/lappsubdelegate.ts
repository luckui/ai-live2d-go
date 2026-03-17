/**
 * Live2D Desktop Pet - Sub-delegate（Canvas 管理）
 * 修改：clearColor 设为透明 (0,0,0,0) 实现透明背景
 */

import * as LAppDefine from './lappdefine';
import { LAppGlManager } from './lappglmanager';
import { LAppLive2DManager } from './lapplive2dmanager';
import { LAppPal } from './lapppal';
import { LAppTextureManager } from './lapptexturemanager';
import { LAppView } from './lappview';

export class LAppSubdelegate {
  public constructor() {
    this._canvas = null;
    this._glManager = new LAppGlManager();
    this._textureManager = new LAppTextureManager();
    this._live2dManager = new LAppLive2DManager();
    this._view = new LAppView();
    this._frameBuffer = null;
    this._captured = false;
    this._needResize = false;
  }

  public release(): void {
    if (this._resizeObserver) {
      this._resizeObserver.unobserve(this._canvas);
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    this._live2dManager.release();
    this._live2dManager = null;

    this._view.release();
    this._view = null;

    this._textureManager.release();
    this._textureManager = null;

    this._glManager.release();
    this._glManager = null;
  }

  public initialize(canvas: HTMLCanvasElement): boolean {
    if (!this._glManager.initialize(canvas)) {
      return false;
    }

    this._canvas = canvas;

    if (LAppDefine.CanvasSize === 'auto') {
      this.resizeCanvas();
    } else {
      canvas.width = LAppDefine.CanvasSize.width;
      canvas.height = LAppDefine.CanvasSize.height;
    }

    this._textureManager.setGlManager(this._glManager);

    const gl = this._glManager.getGl();

    if (!this._frameBuffer) {
      this._frameBuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    }

    // 透明混合
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this._view.initialize(this);
    this._view.initializeSprite();
    this._live2dManager.initialize(this);

    this._resizeObserver = new ResizeObserver(
      (entries: ResizeObserverEntry[], _observer: ResizeObserver) =>
        this.resizeObserverCallback.call(this, entries, _observer)
    );
    this._resizeObserver.observe(this._canvas);

    return true;
  }

  public onResize(): void {
    this.resizeCanvas();
    this._view.initialize(this);
    this._view.initializeSprite();
  }

  private resizeObserverCallback(
    _entries: ResizeObserverEntry[],
    _observer: ResizeObserver
  ): void {
    if (LAppDefine.CanvasSize === 'auto') {
      this._needResize = true;
    }
  }

  public update(): void {
    if (this._glManager.getGl().isContextLost()) {
      return;
    }

    if (this._needResize) {
      this.onResize();
      this._needResize = false;
    }

    const gl = this._glManager.getGl();

    // ★ 关键：透明背景 alpha=0
    gl.clearColor(0.0, 0.0, 0.0, 0.0);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.clearDepth(1.0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this._view.render();
  }

  public createShader(): WebGLProgram {
    const gl = this._glManager.getGl();

    const vertexShaderId = gl.createShader(gl.VERTEX_SHADER);
    if (vertexShaderId == null) {
      LAppPal.printMessage('failed to create vertexShader');
      return null;
    }

    const vertexShader: string =
      'precision mediump float;' +
      'attribute vec3 position;' +
      'attribute vec2 uv;' +
      'varying vec2 vuv;' +
      'void main(void){' +
      '   gl_Position = vec4(position, 1.0);' +
      '   vuv = uv;' +
      '}';
    gl.shaderSource(vertexShaderId, vertexShader);
    gl.compileShader(vertexShaderId);

    const fragmentShaderId = gl.createShader(gl.FRAGMENT_SHADER);
    if (fragmentShaderId == null) {
      LAppPal.printMessage('failed to create fragmentShader');
      return null;
    }

    const fragmentShader: string =
      'precision mediump float;' +
      'varying vec2 vuv;' +
      'uniform sampler2D texture;' +
      'void main(void){' +
      '   gl_FragColor = texture2D(texture, vuv);' +
      '}';
    gl.shaderSource(fragmentShaderId, fragmentShader);
    gl.compileShader(fragmentShaderId);

    const programId = gl.createProgram();
    gl.attachShader(programId, vertexShaderId);
    gl.attachShader(programId, fragmentShaderId);
    gl.deleteShader(vertexShaderId);
    gl.deleteShader(fragmentShaderId);
    gl.linkProgram(programId);
    gl.useProgram(programId);

    return programId;
  }

  public getTextureManager(): LAppTextureManager { return this._textureManager; }
  public getFrameBuffer(): WebGLFramebuffer { return this._frameBuffer; }
  public getCanvas(): HTMLCanvasElement { return this._canvas; }
  public getGlManager(): LAppGlManager { return this._glManager; }
  public getLive2DManager(): LAppLive2DManager { return this._live2dManager; }

  private resizeCanvas(): void {
    this._canvas.width = this._canvas.clientWidth * window.devicePixelRatio;
    this._canvas.height = this._canvas.clientHeight * window.devicePixelRatio;
    const gl = this._glManager.getGl();
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  public onPointBegan(pageX: number, pageY: number): void {
    if (!this._view) {
      LAppPal.printMessage('view notfound');
      return;
    }
    this._captured = true;
    const localX: number = pageX - this._canvas.offsetLeft;
    const localY: number = pageY - this._canvas.offsetTop;
    this._view.onTouchesBegan(localX, localY);
  }

  public onPointMoved(pageX: number, pageY: number): void {
    if (!this._captured) return;
    const localX: number = pageX - this._canvas.offsetLeft;
    const localY: number = pageY - this._canvas.offsetTop;
    this._view.onTouchesMoved(localX, localY);
  }

  public onPointEnded(pageX: number, pageY: number): void {
    this._captured = false;
    if (!this._view) {
      LAppPal.printMessage('view notfound');
      return;
    }
    const localX: number = pageX - this._canvas.offsetLeft;
    const localY: number = pageY - this._canvas.offsetTop;
    this._view.onTouchesEnded(localX, localY);
  }

  public onTouchCancel(pageX: number, pageY: number): void {
    this._captured = false;
    if (!this._view) return;
    const localX: number = pageX - this._canvas.offsetLeft;
    const localY: number = pageY - this._canvas.offsetTop;
    this._view.onTouchesEnded(localX, localY);
  }

  public isContextLost(): boolean {
    return this._glManager.getGl().isContextLost();
  }

  /**
   * 目光追踪：将 canvas 内 CSS 坐标转为视图坐标，驱动头部朝向与眼球方向
   * @param cssX 相对于 canvas 左上角的 CSS 像素 X
   * @param cssY 相对于 canvas 左上角的 CSS 像素 Y
   */
  public setFaceTarget(cssX: number, cssY: number): void {
    if (!this._view) return;
    const dpr = window.devicePixelRatio || 1;
    const viewX = this._view.transformViewX(cssX * dpr);
    const viewY = this._view.transformViewY(cssY * dpr);
    // 夹紧到 [-1, 1]，防止参数溢出（光标极远时模型只看向边缘而不超量）
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    this._live2dManager.onDrag(clamp(viewX), clamp(viewY));
  }

  private _canvas: HTMLCanvasElement;
  private _view: LAppView;
  private _textureManager: LAppTextureManager;
  private _frameBuffer: WebGLFramebuffer;
  private _glManager: LAppGlManager;
  private _live2dManager: LAppLive2DManager;
  private _resizeObserver: ResizeObserver;
  private _captured: boolean;
  private _needResize: boolean;
}
