/**
 * Live2D Desktop Pet - View（简化版）
 * 修改：移除背景图和齿轮图，只渲染 Live2D 模型
 */

import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { CubismViewMatrix } from '@framework/math/cubismviewmatrix';
import * as LAppDefine from './lappdefine';
import { LAppPal } from './lapppal';
import { TouchManager } from './touchmanager';
import { LAppSubdelegate } from './lappsubdelegate';

export class LAppView {
  public constructor() {
    this._programId = null;
    this._touchManager = new TouchManager();
    this._deviceToScreen = new CubismMatrix44();
    this._viewMatrix = new CubismViewMatrix();
  }

  public initialize(subdelegate: LAppSubdelegate): void {
    this._subdelegate = subdelegate;
    const { width, height } = subdelegate.getCanvas();

    const ratio: number = width / height;
    const left: number = -ratio;
    const right: number = ratio;
    const bottom: number = LAppDefine.ViewLogicalLeft;
    const top: number = LAppDefine.ViewLogicalRight;

    this._viewMatrix.setScreenRect(left, right, bottom, top);
    this._viewMatrix.scale(LAppDefine.ViewScale, LAppDefine.ViewScale);

    this._deviceToScreen.loadIdentity();
    if (width > height) {
      const screenW: number = Math.abs(right - left);
      this._deviceToScreen.scaleRelative(screenW / width, -screenW / width);
    } else {
      const screenH: number = Math.abs(top - bottom);
      this._deviceToScreen.scaleRelative(screenH / height, -screenH / height);
    }
    this._deviceToScreen.translateRelative(-width * 0.5, -height * 0.5);

    this._viewMatrix.setMaxScale(LAppDefine.ViewMaxScale);
    this._viewMatrix.setMinScale(LAppDefine.ViewMinScale);
    this._viewMatrix.setMaxScreenRect(
      LAppDefine.ViewLogicalMaxLeft,
      LAppDefine.ViewLogicalMaxRight,
      LAppDefine.ViewLogicalMaxBottom,
      LAppDefine.ViewLogicalMaxTop
    );
  }

  public release(): void {
    this._viewMatrix = null;
    this._touchManager = null;
    this._deviceToScreen = null;

    if (this._programId) {
      this._subdelegate.getGlManager().getGl().deleteProgram(this._programId);
      this._programId = null;
    }
  }

  public render(): void {
    const gl = this._subdelegate.getGlManager().getGl();
    if (this._programId) {
      gl.useProgram(this._programId);
    }
    gl.flush();

    const manager = this._subdelegate.getLive2DManager();
    if (manager != null) {
      manager.setViewMatrix(this._viewMatrix);
      manager.onUpdate();
    }
  }

  /**
   * 初始化 Sprite（桌面宠物版不加载背景/齿轮，仅创建 Shader）
   */
  public initializeSprite(): void {
    if (this._programId == null) {
      this._programId = this._subdelegate.createShader();
    }
  }

  public onTouchesBegan(pointX: number, pointY: number): void {
    this._touchManager.touchesBegan(
      pointX * window.devicePixelRatio,
      pointY * window.devicePixelRatio
    );
  }

  public onTouchesMoved(pointX: number, pointY: number): void {
    const posX = pointX * window.devicePixelRatio;
    const posY = pointY * window.devicePixelRatio;

    const manager = this._subdelegate.getLive2DManager();
    const viewX: number = this.transformViewX(this._touchManager.getX());
    const viewY: number = this.transformViewY(this._touchManager.getY());

    this._touchManager.touchesMoved(posX, posY);
    manager.onDrag(viewX, viewY);
  }

  public onTouchesEnded(pointX: number, pointY: number): void {
    const posX = pointX * window.devicePixelRatio;
    const posY = pointY * window.devicePixelRatio;

    const manager = this._subdelegate.getLive2DManager();
    manager.onDrag(0.0, 0.0);

    const x: number = this.transformViewX(posX);
    const y: number = this.transformViewY(posY);

    if (LAppDefine.DebugTouchLogEnable) {
      LAppPal.printMessage(`[APP]touchesEnded x: ${x} y: ${y}`);
    }

    // 桌面端：鼠标拖动 = 移动窗口（由 setupWindowDrag 处理），不会走到 Moved
    // 因此 pointerup 到达这里必然是点击，直接 onTap
    manager.onTap(x, y);
  }

  public transformViewX(deviceX: number): number {
    const screenX: number = this._deviceToScreen.transformX(deviceX);
    return this._viewMatrix.invertTransformX(screenX);
  }

  public transformViewY(deviceY: number): number {
    const screenY: number = this._deviceToScreen.transformY(deviceY);
    return this._viewMatrix.invertTransformY(screenY);
  }

  _touchManager: TouchManager;
  _deviceToScreen: CubismMatrix44;
  _viewMatrix: CubismViewMatrix;
  _programId: WebGLProgram;
  private _subdelegate: LAppSubdelegate;
}
