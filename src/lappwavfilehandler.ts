/**
 * Live2D Desktop Pet - WAV 文件处理（精简存根）
 * 保留接口兼容性，不实现实际音频播放
 */

export class LAppWavFileHandler {
  constructor() {
    this._lastRms = 0.0;
  }

  public update(_deltaTimeSeconds: number): boolean {
    return false;
  }

  public start(_filePath: string): void {
    // 占位：后续可接入音频
  }

  public getRms(): number {
    return this._lastRms;
  }

  private _lastRms: number;
}
