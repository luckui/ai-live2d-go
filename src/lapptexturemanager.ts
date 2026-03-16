/**
 * Live2D Desktop Pet - 纹理管理器
 * 与 Demo 一致
 */

import { csmVector, iterator } from '@framework/type/csmvector';
import { LAppGlManager } from './lappglmanager';

export class LAppTextureManager {
  public constructor() {
    this._textures = new csmVector<TextureInfo>();
  }

  public release(): void {
    for (
      let ite: iterator<TextureInfo> = this._textures.begin();
      ite.notEqual(this._textures.end());
      ite.preIncrement()
    ) {
      this._glManager.getGl().deleteTexture(ite.ptr().id);
    }
    this._textures = null;
  }

  public createTextureFromPngFile(
    fileName: string,
    usePremultiply: boolean,
    callback: (textureInfo: TextureInfo) => void
  ): void {
    // 搜索已缓存的纹理
    for (
      let ite: iterator<TextureInfo> = this._textures.begin();
      ite.notEqual(this._textures.end());
      ite.preIncrement()
    ) {
      if (ite.ptr().fileName === fileName && ite.ptr().usePremultply === usePremultiply) {
        ite.ptr().img = new Image();
        ite.ptr().img.addEventListener('load', (): void => callback(ite.ptr()), { passive: true });
        ite.ptr().img.src = fileName;
        return;
      }
    }

    const img = new Image();
    img.addEventListener(
      'load',
      (): void => {
        const gl = this._glManager.getGl();
        const tex: WebGLTexture = gl.createTexture();

        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        if (usePremultiply) {
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        }

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.bindTexture(gl.TEXTURE_2D, null);

        const textureInfo: TextureInfo = new TextureInfo();
        textureInfo.fileName = fileName;
        textureInfo.width = img.width;
        textureInfo.height = img.height;
        textureInfo.id = tex;
        textureInfo.img = img;
        textureInfo.usePremultply = usePremultiply;

        if (this._textures != null) {
          this._textures.pushBack(textureInfo);
        }

        callback(textureInfo);
      },
      { passive: true }
    );
    img.src = fileName;
  }

  public releaseTextures(): void {
    for (let i = 0; i < this._textures.getSize(); i++) {
      this._glManager.getGl().deleteTexture(this._textures.at(i).id);
      this._textures.set(i, null);
    }
    this._textures.clear();
  }

  public releaseTextureByTexture(texture: WebGLTexture): void {
    for (let i = 0; i < this._textures.getSize(); i++) {
      if (this._textures.at(i).id !== texture) continue;
      this._glManager.getGl().deleteTexture(this._textures.at(i).id);
      this._textures.set(i, null);
      this._textures.remove(i);
      break;
    }
  }

  public releaseTextureByFilePath(fileName: string): void {
    for (let i = 0; i < this._textures.getSize(); i++) {
      if (this._textures.at(i).fileName === fileName) {
        this._glManager.getGl().deleteTexture(this._textures.at(i).id);
        this._textures.set(i, null);
        this._textures.remove(i);
        break;
      }
    }
  }

  public setGlManager(glManager: LAppGlManager): void {
    this._glManager = glManager;
  }

  _textures: csmVector<TextureInfo>;
  private _glManager: LAppGlManager;
}

export class TextureInfo {
  img: HTMLImageElement;
  id: WebGLTexture = null;
  width = 0;
  height = 0;
  usePremultply: boolean;
  fileName: string;
}
