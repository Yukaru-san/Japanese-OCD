import { CapacitorException, ExceptionCode, WebPlugin } from '@capacitor/core';

import type {
  CaptureResult,
  DeviceSupportResult,
  JapaneseOcrPlugin,
  LiveState,
  OcrReadyResult,
  OcrResult,
  PermissionStatus,
} from './definitions';

const REASON = 'Japanese OCR is only supported on Android.';

/**
 * Used on web and iOS: the support checks answer `false`, everything else throws `UNAVAILABLE`.
 */
export class JapaneseOcrWeb extends WebPlugin implements JapaneseOcrPlugin {
  async isDeviceSupported(): Promise<DeviceSupportResult> {
    return { supported: false, liveCamera: false, translation: false, reason: REASON };
  }

  async isOcrReady(): Promise<OcrReadyResult> {
    return { ready: false };
  }

  async isTranslationReady(): Promise<{ ready: boolean }> {
    return { ready: false };
  }

  async checkPermissions(): Promise<PermissionStatus> {
    throw this.unsupported();
  }

  async requestPermissions(): Promise<PermissionStatus> {
    throw this.unsupported();
  }

  async startLiveRecognition(): Promise<void> {
    throw this.unsupported();
  }

  async stopLiveRecognition(): Promise<void> {
    throw this.unsupported();
  }

  async captureFrame(): Promise<CaptureResult> {
    throw this.unsupported();
  }

  async resumeLiveRecognition(): Promise<void> {
    throw this.unsupported();
  }

  async getLiveState(): Promise<LiveState> {
    throw this.unsupported();
  }

  async setTorch(): Promise<void> {
    throw this.unsupported();
  }

  async setTranslation(): Promise<void> {
    throw this.unsupported();
  }

  async recognizeImage(): Promise<OcrResult> {
    throw this.unsupported();
  }

  async prepareTranslation(): Promise<void> {
    throw this.unsupported();
  }

  async translateText(): Promise<{ text: string; targetLanguage: string }> {
    throw this.unsupported();
  }

  private unsupported(): CapacitorException {
    return new CapacitorException(REASON, ExceptionCode.Unavailable);
  }
}
