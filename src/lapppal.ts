/**
 * Live2D Desktop Pet - PAL（平台抽象层）
 * 与 Demo 一致
 */

export class LAppPal {
  public static loadFileAsBytes(
    filePath: string,
    callback: (arrayBuffer: ArrayBuffer, size: number) => void
  ): void {
    fetch(filePath)
      .then(response => response.arrayBuffer())
      .then(arrayBuffer => callback(arrayBuffer, arrayBuffer.byteLength));
  }

  public static getDeltaTime(): number {
    return this.deltaTime;
  }

  public static updateTime(): void {
    this.currentFrame = Date.now();
    this.deltaTime = (this.currentFrame - this.lastFrame) / 1000;
    this.lastFrame = this.currentFrame;
  }

  public static printMessage(message: string): void {
    console.log(message);
  }

  static lastUpdate = Date.now();
  static currentFrame = 0.0;
  static lastFrame = 0.0;
  static deltaTime = 0.0;
}
