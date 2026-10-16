import { CapacitorException, WebPlugin } from '@capacitor/core';
import type { ExceptionCode } from '@capacitor/core';

import type {
  CaptureOptions,
  CaptureResult,
  DeviceSupportResult,
  GalleryOptions,
  GalleryResult,
  HandwritingResult,
  JapaneseOcrErrorCode,
  JapaneseOcrPlugin,
  LiveRecognitionOptions,
  LiveState,
  OcrReadyResult,
  OcrResult,
  PermissionStatus,
  Rect,
  RecognizeHandwritingOptions,
  RecognizeImageOptions,
} from './definitions';
import type { LiveCamera } from './web/live';
import type { PaddleEngine } from './web/paddle';
import type { ViewMapper } from './web/result';

/** The methods every engine implements; `setEngine`/`getEngine` belong to the switching wrapper. */
export type JapaneseOcrEngine = Omit<JapaneseOcrPlugin, 'setEngine' | 'getEngine'>;

/** Rejection with one of the plugin's error codes, the same shape the native plugin rejects with. */
function fail(code: JapaneseOcrErrorCode, message: string): CapacitorException {
  return new CapacitorException(message, code as ExceptionCode);
}

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : typeof e === 'string' && e ? e : fallback;
}

/** Errors thrown with a plugin code pass through, everything else becomes `code`. */
function coded(e: unknown, code: JapaneseOcrErrorCode, fallback: string): CapacitorException {
  if (e instanceof CapacitorException) return e;
  return fail(code, messageOf(e, fallback));
}

/** Live recognition processes frames at most this large (longer side) to keep up. */
const LIVE_MAX_SIDE = 960;
/** Still images are detected at most this large (longer side). */
const STILL_MAX_SIDE = 1600;

/**
 * Japanese OCR in the browser: PaddleOCR (PP-OCRv6) on ONNX Runtime Web, camera via
 * `getUserMedia`, photo picker via `<input type="file">`. Returns exactly the same result structure
 * as the Android engine.
 *
 * This class is the web counterpart of `JapaneseOcrPlugin.java`: it checks options and maps
 * failures to the plugin's error codes. The work is done by the modules in `web/`, which are
 * imported on first use so they stay out of the app's start-up bundle: `paddle.ts` (models),
 * `result.ts` + `reading-order.ts` (result format), `image.ts`, `live.ts`, `region-selector.ts`
 * and `handwriting.ts`.
 */
export class JapaneseOcrWeb extends WebPlugin implements JapaneseOcrEngine {
  private engine: Promise<PaddleEngine> | null = null;
  private ready = false;
  private failure: string | null = null;
  private live: LiveCamera | null = null;
  private pendingCapture: { reject: (e: unknown) => void } | null = null;

  // Support checks

  private static basicSupport(): string | null {
    if (typeof window === 'undefined' || typeof document === 'undefined') return 'Not running in a browser.';
    if (typeof WebAssembly !== 'object') return 'This browser does not support WebAssembly.';
    if (typeof DecompressionStream !== 'function') return 'This browser is too old (DecompressionStream is missing).';
    return null;
  }

  /** Loads the models once (in the background from the first support check). */
  private load(): Promise<PaddleEngine> {
    if (!this.engine) {
      const reason = JapaneseOcrWeb.basicSupport();
      this.engine = reason
        ? Promise.reject(fail('UNAVAILABLE', reason))
        : import('./web/paddle')
            .then((m) => m.loadPaddleEngine())
            .then(async (engine) => {
              // Warm-up, like the native engine, so the first real image isn't slower.
              await engine.recognize({ data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 });
              this.ready = true;
              return engine;
            });
      this.engine.catch((e) => {
        this.failure = `The Japanese text recognizer failed to load: ${messageOf(e, 'unknown error')}`;
      });
    }
    return this.engine;
  }

  private async ensureOcr(): Promise<PaddleEngine> {
    const reason = JapaneseOcrWeb.basicSupport();
    if (reason) throw fail('UNAVAILABLE', reason);
    try {
      return await this.load();
    } catch (e) {
      throw fail('NOT_READY', this.failure ?? messageOf(e, 'The Japanese text recognizer is not available.'));
    }
  }

  private static hasCameraApi(): boolean {
    return (
      typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext !== false
    );
  }

  private static async hasCamera(): Promise<boolean> {
    if (!JapaneseOcrWeb.hasCameraApi()) return false;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some((d) => d.kind === 'videoinput');
    } catch {
      return true;
    }
  }

  async isDeviceSupported(): Promise<DeviceSupportResult> {
    let reason = JapaneseOcrWeb.basicSupport();
    if (!reason) {
      void this.load().catch(() => undefined);
      if (this.failure) reason = this.failure;
    }
    const supported = reason == null;
    const camera = supported && (await JapaneseOcrWeb.hasCamera());
    if (supported && !camera) {
      reason = 'No camera is available to this page, so only recognizeImage() is available.';
    }
    const result: DeviceSupportResult = { supported, liveCamera: camera, handwriting: supported };
    if (reason != null) result.reason = reason;
    return result;
  }

  async isOcrReady(): Promise<OcrReadyResult> {
    if (!JapaneseOcrWeb.basicSupport()) void this.load().catch(() => undefined);
    return { ready: this.ready };
  }

  // Permissions

  async checkPermissions(): Promise<PermissionStatus> {
    if (!JapaneseOcrWeb.hasCameraApi()) throw fail('UNAVAILABLE', 'This browser gives the page no camera access.');
    try {
      const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
      return { camera: status.state };
    } catch {
      return { camera: 'prompt' };
    }
  }

  async requestPermissions(): Promise<PermissionStatus> {
    if (!JapaneseOcrWeb.hasCameraApi()) throw fail('UNAVAILABLE', 'This browser gives the page no camera access.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach((t) => t.stop());
      return { camera: 'granted' };
    } catch (e) {
      if ((e as DOMException)?.name === 'NotAllowedError') return { camera: 'denied' };
      throw fail('CAMERA_ERROR', messageOf(e, 'The camera could not be opened.'));
    }
  }

  // Live recognition

  async startLiveRecognition(options: LiveRecognitionOptions = {}): Promise<void> {
    const engine = await this.ensureOcr();
    if (!(await JapaneseOcrWeb.hasCamera())) throw fail('UNAVAILABLE', 'The device has no camera.');
    if (this.live) throw fail('ALREADY_RUNNING', 'Live recognition is already running.');

    const { LiveCamera } = await import('./web/live');
    if (this.live) throw fail('ALREADY_RUNNING', 'Live recognition is already running.');
    const interval = typeof options.intervalMs === 'number' ? options.intervalMs : 500;
    const live: LiveCamera = new LiveCamera(options.lensFacing === 'front', interval, (frame, view): Promise<void> =>
      this.onFrame(engine, live, frame, view),
    );
    this.live = live;
    try {
      await live.start();
    } catch (e) {
      live.stop();
      if (this.live === live) this.live = null;
      const name = (e as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError')
        throw fail('PERMISSION_DENIED', 'Camera permission was denied.');
      throw fail('CAMERA_ERROR', `The camera could not be opened: ${messageOf(e, name ?? 'unknown error')}`);
    }
  }

  /** Recognizes one live frame and fires `textRecognized`, unless the camera stopped or froze meanwhile. */
  private async onFrame(
    engine: PaddleEngine,
    live: LiveCamera,
    frame: HTMLCanvasElement,
    view: ViewMapper,
  ): Promise<void> {
    let result: OcrResult;
    try {
      result = await this.recognizeCanvas(engine, frame, null, view, LIVE_MAX_SIDE);
    } catch (e) {
      if (this.live === live && !live.frozen) this.liveError('RECOGNITION_FAILED', messageOf(e, 'Recognition failed'));
      return;
    }
    if (this.live !== live || live.frozen) return;
    this.notifyListeners('textRecognized', result);
  }

  private liveError(code: JapaneseOcrErrorCode, message: string): void {
    this.notifyListeners('liveRecognitionError', { code, message });
  }

  async stopLiveRecognition(): Promise<void> {
    this.stopLive();
  }

  private stopLive(): void {
    if (this.live) {
      this.live.stop();
      this.live = null;
    }
    if (this.pendingCapture) {
      this.pendingCapture.reject(fail('NOT_RUNNING', 'Live recognition was stopped.'));
      this.pendingCapture = null;
    }
  }

  async captureFrame(options: CaptureOptions = {}): Promise<CaptureResult> {
    const live = this.live;
    if (!live?.running) throw fail('NOT_RUNNING', 'Live recognition is not running.');
    if (this.pendingCapture || live.capturing) throw fail('ALREADY_RUNNING', 'A capture is already in progress.');
    const engine = await this.ensureOcr();

    return new Promise<CaptureResult>((resolve, reject) => {
      const pending = { reject };
      this.pendingCapture = pending;
      live.capturing = true;
      const finish = (result: CaptureResult | null, error?: unknown) => {
        live.capturing = false;
        if (this.pendingCapture !== pending) return; // already rejected by stopLiveRecognition()
        this.pendingCapture = null;
        if (result) resolve(result);
        else reject(error);
      };
      (async () => {
        let frame: HTMLCanvasElement;
        try {
          if (live.frozen) live.resume();
          frame = live.freeze();
        } catch (e) {
          finish(null, fail('CAMERA_ERROR', messageOf(e, 'The picture could not be taken.')));
          return;
        }
        let imagePath: string | undefined;
        if (options.saveImage) {
          try {
            const { canvasToBlob } = await import('./web/image');
            imagePath = URL.createObjectURL(await canvasToBlob(frame));
          } catch (e) {
            finish(null, fail('CAMERA_ERROR', `Could not save the image: ${messageOf(e, 'unknown error')}`));
            return;
          }
        }
        try {
          const result: CaptureResult = await this.recognize(engine, frame, null, live.viewMapper(), STILL_MAX_SIDE);
          if (imagePath) result.imagePath = imagePath;
          finish(result);
        } catch (e) {
          finish(null, coded(e, 'RECOGNITION_FAILED', 'Recognition failed'));
        }
      })();
    });
  }

  async resumeLiveRecognition(): Promise<void> {
    if (!this.live?.running) throw fail('NOT_RUNNING', 'Live recognition is not running.');
    this.live.resume();
  }

  async getLiveState(): Promise<LiveState> {
    return { running: !!this.live?.running, frozen: !!this.live?.frozen };
  }

  async setTorch(options: { enabled: boolean }): Promise<void> {
    if (typeof options?.enabled !== 'boolean') throw fail('INVALID_ARGUMENT', 'enabled is required.');
    if (!this.live?.running) throw fail('NOT_RUNNING', 'Live recognition is not running.');
    if (!this.live.hasFlash()) throw fail('UNAVAILABLE', 'This camera has no flash.');
    try {
      await this.live.setTorch(options.enabled);
    } catch (e) {
      throw fail('CAMERA_ERROR', messageOf(e, 'The flash could not be switched.'));
    }
  }

  // Still images

  async recognizeImage(options: RecognizeImageOptions): Promise<OcrResult> {
    await this.ensureOcr();
    const regions = regionsOf(options?.regions);
    const image = await import('./web/image');
    let blob: Blob;
    if (options?.path) {
      try {
        blob = await image.blobFromPath(options.path);
      } catch (e) {
        throw fail('RECOGNITION_FAILED', `Could not load the image: ${messageOf(e, 'unknown error')}`);
      }
    } else if (options?.base64) {
      try {
        blob = image.blobFromBase64(options.base64);
      } catch (e) {
        throw fail('INVALID_ARGUMENT', `base64 is not valid: ${messageOf(e, 'unknown error')}`);
      }
    } else {
      throw fail('INVALID_ARGUMENT', 'Either path or base64 is required.');
    }
    return this.recognizeStill(blob, regions, !!options.selectRegion, options.path ?? null);
  }

  async recognizeFromGallery(options: GalleryOptions = {}): Promise<GalleryResult> {
    // Open the picker first: browsers only allow it shortly after the user's tap.
    const reason = JapaneseOcrWeb.basicSupport();
    if (reason) throw fail('UNAVAILABLE', reason);
    const regions = regionsOf(options.regions);
    const file = await pickImage();
    if (!file) throw fail('CANCELLED', 'No image was selected.');
    await this.ensureOcr();
    const path = URL.createObjectURL(file);
    return (await this.recognizeStill(file, regions, !!options.selectRegion, path)) as GalleryResult;
  }

  private async recognizeStill(
    blob: Blob,
    regions: Rect[] | null,
    select: boolean,
    imagePath: string | null,
  ): Promise<OcrResult & { imagePath?: string }> {
    const engine = await this.ensureOcr();
    const image = await import('./web/image');
    let canvas: HTMLCanvasElement;
    try {
      canvas = await image.decode(blob);
    } catch (e) {
      throw fail('RECOGNITION_FAILED', `Could not load the image: ${messageOf(e, 'not a decodable image')}`);
    }
    let rotation = 0;
    let path = imagePath;
    if (select) {
      const { selectRegions } = await import('./web/region-selector');
      const selection = await selectRegions(canvas);
      if (!selection) throw fail('CANCELLED', 'The selection was cancelled.');
      canvas = selection.image;
      rotation = selection.rotation;
      regions = selection.regions.length ? selection.regions : null;
      if (rotation !== 0) {
        try {
          path = URL.createObjectURL(await image.canvasToBlob(canvas));
        } catch {
          // Keep the original; the coordinates then refer to the rotated image.
        }
      }
    }
    const result: OcrResult & { imagePath?: string } = await this.recognize(
      engine,
      canvas,
      regions,
      null,
      STILL_MAX_SIDE,
    );
    if (path != null) result.imagePath = path;
    if (regions != null)
      result.regions = regions.map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
    if (rotation !== 0) result.rotation = rotation;
    return result;
  }

  /** Recognizes a still image. Failures carry an error code. */
  private async recognize(
    engine: PaddleEngine,
    canvas: HTMLCanvasElement,
    regions: Rect[] | null,
    view: ViewMapper | null,
    maxSide: number,
  ): Promise<OcrResult> {
    try {
      return await this.recognizeCanvas(engine, canvas, regions, view, maxSide);
    } catch (e) {
      throw fail('RECOGNITION_FAILED', messageOf(e, 'Recognition failed'));
    }
  }

  /** Finds and reads the text on the canvas and builds the result in reading order. */
  private async recognizeCanvas(
    engine: PaddleEngine,
    canvas: HTMLCanvasElement,
    regions: Rect[] | null,
    view: ViewMapper | null,
    maxSide: number,
  ): Promise<OcrResult> {
    const resultModule = await import('./web/result');
    const { pixelsOf } = await import('./web/image');
    const lines = await engine.recognize(pixelsOf(canvas), { maxSide });
    return resultModule.toResult(resultModule.arrangeLines(lines, regions), canvas.width, canvas.height, view);
  }

  // Handwriting

  async isHandwritingReady(): Promise<{ ready: boolean }> {
    return { ready: this.ready };
  }

  async prepareHandwriting(): Promise<void> {
    await this.handwritingEngine();
  }

  async recognizeHandwriting(options: RecognizeHandwritingOptions): Promise<HandwritingResult> {
    const strokes = options?.strokes;
    const valid =
      Array.isArray(strokes) &&
      strokes.every(
        (s) =>
          Array.isArray(s?.points) &&
          s.points.every((p) => typeof p?.x === 'number' && typeof p?.y === 'number' && !isNaN(p.x) && !isNaN(p.y)),
      );
    if (!valid) throw fail('INVALID_ARGUMENT', 'strokes must be an array of { points: { x, y, t? }[] }.');
    const limit = Math.max(1, Math.min(5, Math.round(options.maxResults ?? 5)));
    if (!strokes.some((s) => s.points.length)) return { text: '', candidates: [] };
    const engine = await this.handwritingEngine();
    try {
      const { recognizeHandwriting } = await import('./web/handwriting');
      return await recognizeHandwriting(
        engine,
        strokes,
        options.height && options.height > 0 ? options.height : null,
        limit,
      );
    } catch (e) {
      throw fail('RECOGNITION_FAILED', messageOf(e, 'Recognition failed'));
    }
  }

  /** The recognizer is bundled, so "downloading" the handwriting model means loading it. */
  private async handwritingEngine(): Promise<PaddleEngine> {
    const reason = JapaneseOcrWeb.basicSupport();
    if (reason) throw fail('UNAVAILABLE', reason);
    try {
      return await this.load();
    } catch (e) {
      throw fail('HANDWRITING_NOT_READY', this.failure ?? messageOf(e, 'The recognizer could not be loaded.'));
    }
  }
}

/** Reads `regions`: null when absent or empty. Throws INVALID_ARGUMENT for malformed boxes. */
function regionsOf(regions: Rect[] | undefined): Rect[] | null {
  if (regions == null) return null;
  if (!Array.isArray(regions)) {
    throw fail('INVALID_ARGUMENT', 'regions must be a list of {left, top, right, bottom} in image pixels.');
  }
  const result = regions.map((r) => {
    const values = [r?.left, r?.top, r?.right, r?.bottom];
    if (values.some((v) => typeof v !== 'number' || !isFinite(v))) {
      throw fail('INVALID_ARGUMENT', 'regions must be a list of {left, top, right, bottom} in image pixels.');
    }
    const box = {
      left: Math.floor(r.left),
      top: Math.floor(r.top),
      right: Math.ceil(r.right),
      bottom: Math.ceil(r.bottom),
    };
    if (box.right <= box.left || box.bottom <= box.top) {
      throw fail(
        'INVALID_ARGUMENT',
        'regions must be a list of {left, top, right, bottom} in image pixels: right/bottom must be greater than left/top',
      );
    }
    return box;
  });
  return result.length ? result : null;
}

/** Opens the browser's file picker for one image. Resolves with null when the user cancels. */
function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    let settled = false;
    const done = (file: File | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(file);
    };
    // Older browsers have no `cancel` event: when the page gets the focus back without a
    // file, the picker was closed.
    const onFocus = () => setTimeout(() => !input.files?.length && done(null), 1500);
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    if (!('oncancel' in input)) window.addEventListener('focus', onFocus);
    document.body.appendChild(input);
    input.click();
  });
}
