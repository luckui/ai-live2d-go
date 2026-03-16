/**
 * Live2D Desktop Pet - Delegate（主控制器）
 * 修改：使用现有 canvas 元素而非动态创建
 */

import { csmVector } from '@framework/type/csmvector';
import { CubismFramework, Option } from '@framework/live2dcubismframework';
import * as LAppDefine from './lappdefine';
import { LAppPal } from './lapppal';
import { LAppSubdelegate } from './lappsubdelegate';
import { CubismLogError } from '@framework/utils/cubismdebug';

export let s_instance: LAppDelegate = null;

export class LAppDelegate {
  public static getInstance(): LAppDelegate {
    if (s_instance == null) {
      s_instance = new LAppDelegate();
    }
    return s_instance;
  }

  public static releaseInstance(): void {
    if (s_instance != null) {
      s_instance.release();
    }
    s_instance = null;
  }

  private onPointerBegan(e: PointerEvent): void {
    for (
      let ite = this._subdelegates.begin();
      ite.notEqual(this._subdelegates.end());
      ite.preIncrement()
    ) {
      ite.ptr().onPointBegan(e.pageX, e.pageY);
    }
  }

  private onPointerMoved(e: PointerEvent): void {
    for (
      let ite = this._subdelegates.begin();
      ite.notEqual(this._subdelegates.end());
      ite.preIncrement()
    ) {
      ite.ptr().onPointMoved(e.pageX, e.pageY);
    }
  }

  private onPointerEnded(e: PointerEvent): void {
    for (
      let ite = this._subdelegates.begin();
      ite.notEqual(this._subdelegates.end());
      ite.preIncrement()
    ) {
      ite.ptr().onPointEnded(e.pageX, e.pageY);
    }
  }

  private onPointerCancel(e: PointerEvent): void {
    for (
      let ite = this._subdelegates.begin();
      ite.notEqual(this._subdelegates.end());
      ite.preIncrement()
    ) {
      ite.ptr().onTouchCancel(e.pageX, e.pageY);
    }
  }

  public run(): void {
    const loop = (): void => {
      if (s_instance == null) return;
      LAppPal.updateTime();
      for (let i = 0; i < this._subdelegates.getSize(); i++) {
        this._subdelegates.at(i).update();
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  private release(): void {
    this.releaseEventListener();
    this.releaseSubdelegates();
    CubismFramework.dispose();
    this._cubismOption = null;
  }

  private releaseEventListener(): void {
    document.removeEventListener('pointerdown', this.pointBeganEventListener);
    this.pointBeganEventListener = null;
    document.removeEventListener('pointermove', this.pointMovedEventListener);
    this.pointMovedEventListener = null;
    document.removeEventListener('pointerup', this.pointEndedEventListener);
    this.pointEndedEventListener = null;
    document.removeEventListener('pointercancel', this.pointCancelEventListener);
    this.pointCancelEventListener = null;
  }

  private releaseSubdelegates(): void {
    for (
      let ite = this._subdelegates.begin();
      ite.notEqual(this._subdelegates.end());
      ite.preIncrement()
    ) {
      ite.ptr().release();
    }
    this._subdelegates.clear();
    this._subdelegates = null;
  }

  public initialize(): boolean {
    this.initializeCubism();
    this.initializeSubdelegates();
    this.initializeEventListener();
    return true;
  }

  private initializeEventListener(): void {
    this.pointBeganEventListener = this.onPointerBegan.bind(this);
    this.pointMovedEventListener = this.onPointerMoved.bind(this);
    this.pointEndedEventListener = this.onPointerEnded.bind(this);
    this.pointCancelEventListener = this.onPointerCancel.bind(this);

    document.addEventListener('pointerdown', this.pointBeganEventListener, { passive: true });
    document.addEventListener('pointermove', this.pointMovedEventListener, { passive: true });
    document.addEventListener('pointerup', this.pointEndedEventListener, { passive: true });
    document.addEventListener('pointercancel', this.pointCancelEventListener, { passive: true });
  }

  private initializeCubism(): void {
    LAppPal.updateTime();
    this._cubismOption.logFunction = LAppPal.printMessage;
    this._cubismOption.loggingLevel = LAppDefine.CubismLoggingLevel;
    CubismFramework.startUp(this._cubismOption);
    CubismFramework.initialize();
  }

  /**
   * 使用 HTML 中已存在的 canvas 元素 #live2d-canvas
   */
  private initializeSubdelegates(): void {
    const canvas = document.getElementById('live2d-canvas') as HTMLCanvasElement;
    if (!canvas) {
      CubismLogError('Canvas element #live2d-canvas not found');
      return;
    }

    this._canvases.pushBack(canvas);

    const subdelegate = new LAppSubdelegate();
    subdelegate.initialize(canvas);
    this._subdelegates.pushBack(subdelegate);

    if (this._subdelegates.at(0).isContextLost()) {
      CubismLogError('WebGL context was lost after initialization');
    }
  }

  private constructor() {
    this._cubismOption = new Option();
    this._subdelegates = new csmVector<LAppSubdelegate>();
    this._canvases = new csmVector<HTMLCanvasElement>();
  }

  private _cubismOption: Option;
  private _canvases: csmVector<HTMLCanvasElement>;
  private _subdelegates: csmVector<LAppSubdelegate>;
  private pointBeganEventListener: (this: Document, ev: PointerEvent) => void;
  private pointMovedEventListener: (this: Document, ev: PointerEvent) => void;
  private pointEndedEventListener: (this: Document, ev: PointerEvent) => void;
  private pointCancelEventListener: (this: Document, ev: PointerEvent) => void;
}
