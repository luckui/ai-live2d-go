/**
 * Live2D Desktop Pet - Live2D Manager
 * 修改：固定加载 Hiyori（index 0），移除多模型切换逻辑
 */

import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { ACubismMotion } from '@framework/motion/acubismmotion';
import { csmVector } from '@framework/type/csmvector';

import * as LAppDefine from './lappdefine';
import { LAppModel } from './lappmodel';
import { LAppPal } from './lapppal';
import { LAppSubdelegate } from './lappsubdelegate';

export class LAppLive2DManager {
  private releaseAllModel(): void {
    this._models.clear();
  }

  public onDrag(x: number, y: number): void {
    const model: LAppModel = this._models.at(0);
    if (model) {
      model.setDragging(x, y);
    }
  }

  public onTap(x: number, y: number): void {
    if (LAppDefine.DebugLogEnable) {
      LAppPal.printMessage(`[APP]tap point: {x: ${x.toFixed(2)} y: ${y.toFixed(2)}}`);
    }
    const model: LAppModel = this._models.at(0);
    if (!model) return;

    if (model.hitTest(LAppDefine.HitAreaNameHead, x, y)) {
      if (LAppDefine.DebugLogEnable) {
        LAppPal.printMessage(`[APP]hit area: [${LAppDefine.HitAreaNameHead}]`);
      }
      model.setRandomExpression();
    } else if (model.hitTest(LAppDefine.HitAreaNameBody, x, y)) {
      if (LAppDefine.DebugLogEnable) {
        LAppPal.printMessage(`[APP]hit area: [${LAppDefine.HitAreaNameBody}]`);
      }
      model.startRandomMotion(
        LAppDefine.MotionGroupTapBody,
        LAppDefine.PriorityNormal,
        this.finishedMotion,
        this.beganMotion
      );
    }
  }

  public onUpdate(): void {
    const { width, height } = this._subdelegate.getCanvas();
    const projection: CubismMatrix44 = new CubismMatrix44();
    const model: LAppModel = this._models.at(0);

    if (model && model.getModel()) {
      if (model.getModel().getCanvasWidth() > 1.0 && width < height) {
        model.getModelMatrix().setWidth(2.0);
        projection.scale(1.0, width / height);
      } else {
        projection.scale(height / width, 1.0);
      }
      if (this._viewMatrix != null) {
        projection.multiplyByMatrix(this._viewMatrix);
      }
    }

    if (model) {
      model.update();
      model.draw(projection);
    }
  }

  public setViewMatrix(m: CubismMatrix44): void {
    for (let i = 0; i < 16; i++) {
      this._viewMatrix.getArray()[i] = m.getArray()[i];
    }
  }

  public addModel(sceneIndex: number = 0): void {
    this._sceneIndex = sceneIndex;
    this.changeScene(this._sceneIndex);
  }

  private changeScene(index: number): void {
    this._sceneIndex = index;
    const modelName: string = LAppDefine.ModelDir[index];
    const modelPath: string = LAppDefine.ResourcesPath + modelName + '/';
    const modelJsonName: string = modelName + '.model3.json';

    this.releaseAllModel();
    const instance = new LAppModel();
    instance.setSubdelegate(this._subdelegate);
    instance.loadAssets(modelPath, modelJsonName);
    this._models.pushBack(instance);
  }

  public constructor() {
    this._subdelegate = null;
    this._viewMatrix = new CubismMatrix44();
    this._models = new csmVector<LAppModel>();
    this._sceneIndex = 0;
  }

  public release(): void {}

  public initialize(subdelegate: LAppSubdelegate): void {
    this._subdelegate = subdelegate;
    this.changeScene(this._sceneIndex);
  }

  private _subdelegate: LAppSubdelegate;
  _viewMatrix: CubismMatrix44;
  _models: csmVector<LAppModel>;
  private _sceneIndex: number;

  beganMotion = (_self: ACubismMotion): void => {};
  finishedMotion = (_self: ACubismMotion): void => {};
}
