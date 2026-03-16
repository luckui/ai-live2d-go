/**
 * Live2D Desktop Pet - Touch Manager
 * 与 Demo 一致
 */

export class TouchManager {
  constructor() {
    this._startX = 0.0;
    this._startY = 0.0;
    this._lastX = 0.0;
    this._lastY = 0.0;
    this._lastX1 = 0.0;
    this._lastY1 = 0.0;
    this._lastX2 = 0.0;
    this._lastY2 = 0.0;
    this._lastTouchDistance = 0.0;
    this._deltaX = 0.0;
    this._deltaY = 0.0;
    this._scale = 1.0;
    this._touchSingle = false;
    this._flipAvailable = false;
  }

  public getCenterX(): number { return this._lastX; }
  public getCenterY(): number { return this._lastY; }
  public getDeltaX(): number { return this._deltaX; }
  public getDeltaY(): number { return this._deltaY; }
  public getStartX(): number { return this._startX; }
  public getStartY(): number { return this._startY; }
  public getScale(): number { return this._scale; }
  public getX(): number { return this._lastX; }
  public getY(): number { return this._lastY; }
  public getX1(): number { return this._lastX1; }
  public getY1(): number { return this._lastY1; }
  public getX2(): number { return this._lastX2; }
  public getY2(): number { return this._lastY2; }
  public isSingleTouch(): boolean { return this._touchSingle; }
  public isFlickAvailable(): boolean { return this._flipAvailable; }
  public disableFlick(): void { this._flipAvailable = false; }

  public touchesBegan(deviceX: number, deviceY: number): void {
    this._lastX = deviceX;
    this._lastY = deviceY;
    this._startX = deviceX;
    this._startY = deviceY;
    this._lastTouchDistance = -1.0;
    this._flipAvailable = true;
    this._touchSingle = true;
  }

  public touchesMoved(deviceX: number, deviceY: number): void {
    this._lastX = deviceX;
    this._lastY = deviceY;
    this._lastTouchDistance = -1.0;
    this._touchSingle = true;
  }

  public getFlickDistance(): number {
    return this.calculateDistance(this._startX, this._startY, this._lastX, this._lastY);
  }

  public calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));
  }

  public calculateMovingAmount(v1: number, v2: number): number {
    if (v1 > 0.0 !== v2 > 0.0) return 0.0;
    const sign = v1 > 0.0 ? 1.0 : -1.0;
    return sign * Math.min(Math.abs(v1), Math.abs(v2));
  }

  _startY: number;
  _startX: number;
  _lastX: number;
  _lastY: number;
  _lastX1: number;
  _lastY1: number;
  _lastX2: number;
  _lastY2: number;
  _lastTouchDistance: number;
  _deltaX: number;
  _deltaY: number;
  _scale: number;
  _touchSingle: boolean;
  _flipAvailable: boolean;
}
