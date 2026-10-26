import type { PermissionState, PluginListenerHandle } from '@capacitor/core';

import type { HandwritingResult, PrepareHandwritingOptions, RecognizeHandwritingOptions } from './handwriting';

export * from './handwriting';

/**
 * Error codes used when a call is rejected.
 *
 * Read it from the `code` property of the thrown error.
 */
export type JapaneseOcrErrorCode =
  /** The platform or device does not support this feature (web, iOS, no camera, ...). */
  | 'UNAVAILABLE'
  /** The Japanese text recognizer failed to load on this device. Not recoverable by retrying. */
  | 'NOT_READY'
  /** The camera permission was denied. */
  | 'PERMISSION_DENIED'
  /** The camera could not be opened or a capture failed. */
  | 'CAMERA_ERROR'
  /** `startLiveRecognition()` is already running, or a `captureFrame()` is still in progress. */
  | 'ALREADY_RUNNING'
  /** The call needs a running live recognition (e.g. `captureFrame()`). */
  | 'NOT_RUNNING'
  /** An option was missing or invalid. */
  | 'INVALID_ARGUMENT'
  /** The image could not be loaded or ML Kit failed to recognize it. */
  | 'RECOGNITION_FAILED'
  /** The user closed the photo picker without choosing an image. */
  | 'CANCELLED'
  /** The handwriting model is not on the device and could not be downloaded (e.g. offline). */
  | 'HANDWRITING_NOT_READY';

/**
 * Shape of every error the plugin rejects with. Narrow a caught value with `isJapaneseOcrError()`.
 */
export interface JapaneseOcrError {
  code: JapaneseOcrErrorCode;
  message: string;
}

/**
 * The OCR engine that runs: `native` is ML Kit on Android, `web` is PaddleOCR running in the
 * WebView/browser (WebAssembly) with browser APIs only.
 */
export type OcrEngineName = 'native' | 'web';

export interface EngineOptions {
  /**
   * `auto` uses the native engine where it exists (Android) and the web engine everywhere else.
   * `web` makes the plugin behave like on a plain website, also inside the Android app.
   */
  engine: 'auto' | OcrEngineName;
}

export interface EngineState {
  /** The choice made with `setEngine()`. */
  engine: 'auto' | OcrEngineName;
  /** The engine that answers calls now. */
  active: OcrEngineName;
  /** `true` when the native engine exists on this platform (Android). */
  nativeAvailable: boolean;
}

export interface DeviceSupportResult {
  /** `true` when Japanese text recognition is available on this device. */
  supported: boolean;
  /** `true` when live camera recognition is available (device has a camera). */
  liveCamera: boolean;
  /** `true` when handwriting recognition (`recognizeHandwriting()`) is available. */
  handwriting: boolean;
  /** Why the device is not (fully) supported. */
  reason?: string;
  /** The engine that answered. */
  engine?: OcrEngineName;
}

export interface OcrReadyResult {
  /** `true` once the Japanese recognizer is loaded and has processed a warm-up image. */
  ready: boolean;
  /** Why the recognizer cannot load. Absent while it is still loading or once it is ready. */
  reason?: string;
}

export interface PermissionStatus {
  camera: PermissionState;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Geometry of a recognized item.
 *
 * `boundingBox` and `cornerPoints` are pixels of the recognized image.
 * `viewBoundingBox` and `viewCornerPoints` are CSS pixels relative to the WebView, so the page can
 * place elements exactly over the word it sees in the camera preview. They are only set for
 * results of `startLiveRecognition()` and `captureFrame()`.
 */
export interface OcrGeometry {
  boundingBox?: Rect;
  cornerPoints?: Point[];
  viewBoundingBox?: Rect;
  viewCornerPoints?: Point[];
}

// `viewBoundingBox` can also be missing on live results for the first frames, before the preview
// has been laid out on screen.

/** A single character. */
export interface OcrSymbol extends OcrGeometry {
  text: string;
  /** Between 0 and 1. */
  confidence: number;
}

export interface OcrElement extends OcrGeometry {
  text: string;
  /** Between 0 and 1. */
  confidence: number;
  symbols: OcrSymbol[];
}

export interface OcrLine extends OcrGeometry {
  text: string;
  /** Between 0 and 1. */
  confidence: number;
  recognizedLanguage: string;
  elements: OcrElement[];
}

/**
 * Furigana: small kana printed over (or, in vertical text, beside) kanji to show their reading.
 * They are recognized separately and are not part of `text`.
 */
export interface OcrFurigana extends OcrGeometry {
  /** The reading, e.g. `にほん`. */
  text: string;
  /** The characters it belongs to, e.g. `日本`, when they could be located. */
  base?: string;
  /** Index of the block in `blocks` that contains `base`. */
  block?: number;
  /** Start of `base` in that block's `text` (UTF-16 index, like `String.slice`). */
  start?: number;
  /** End of `base` in that block's `text`, exclusive. */
  end?: number;
}

/**
 * A piece of a block's text. Pieces with furigana carry their `reading`; joined, the pieces give
 * the block's `text`. Render them as `<ruby>text<rt>reading</rt></ruby>`.
 */
export interface OcrSegment {
  text: string;
  /** The furigana printed over `text`, e.g. `にほん` for `日本`. */
  reading?: string;
}

/** A paragraph: consecutive lines of the same text size, in reading order. */
export interface OcrBlock extends OcrGeometry {
  text: string;
  recognizedLanguage: string;
  lines: OcrLine[];
  /** `text` split into pieces with and without furigana. */
  segments: OcrSegment[];
  /** Index in `regions` of the region this block was selected from. Only set when regions were used. */
  region?: number;
  /**
   * Only on stabilized live results: stays the same while the camera follows the same paragraph
   * from frame to frame. Use it as a key to move your own markers instead of recreating them.
   */
  trackId?: number;
}

export interface OcrResult {
  /**
   * All recognized text in reading order, without furigana. Paragraphs are separated by a line
   * break; the lines within a paragraph are joined (Latin words with a space).
   */
  text: string;
  /** Paragraphs in reading order. */
  blocks: OcrBlock[];
  /** Furigana found in the image, in reading order. */
  furigana: OcrFurigana[];
  /** `true` when the text is written vertically (columns right to left). */
  vertical: boolean;
  /** Width of the (upright) image the coordinates refer to. */
  imageWidth: number;
  /** Height of the (upright) image the coordinates refer to. */
  imageHeight: number;
  /**
   * The regions text was taken from, in image pixels, in the order the user drew them (or you
   * passed them). Not set when the whole image was recognized.
   */
  regions?: Rect[];
  /** Clockwise rotation in degrees the user applied in the selection screen, when not 0. */
  rotation?: number;
}

export interface CaptureResult extends OcrResult {
  /**
   * `file://` path of the captured JPEG, when `saveImage` was set.
   * Use `Capacitor.convertFileSrc()` to show it in an `<img>`.
   */
  imagePath?: string;
}

export interface LiveRecognitionOptions {
  /**
   * Which camera to use.
   *
   * @default 'back'
   */
  lensFacing?: 'back' | 'front';
  /**
   * Minimum time between two recognized frames in milliseconds. Frames are never recognized
   * faster than the recognizer can handle them, so a small value just means "as often as
   * possible".
   *
   * @default 300
   */
  intervalMs?: number;
  /**
   * Smooth the results over several frames before `textRecognized` fires: a paragraph only
   * appears once it was seen in two frames, a new reading of it (e.g. with or without furigana)
   * only replaces the old one once it was seen twice in a row, a paragraph missing for a frame or
   * two stays, and small position changes are ignored. Each block gets a `trackId`. Text that is
   * outside the visible preview is dropped. Set to `false` for the raw result of every frame.
   *
   * @default true
   */
  stabilize?: boolean;
}

export interface FocusOptions {
  /** CSS pixels relative to the WebView, e.g. `event.clientX`. */
  x: number;
  /** CSS pixels relative to the WebView, e.g. `event.clientY`. */
  y: number;
}

export interface ZoomOptions {
  /** Zoom factor between `minZoom` and `maxZoom` of `getLiveState()`; 1 is no zoom. */
  ratio: number;
}

export interface CaptureOptions {
  /**
   * Store the captured photo as a JPEG in the app cache and return its path.
   *
   * @default false
   */
  saveImage?: boolean;
}

export interface RecognizeImageOptions {
  /** `file://`, `content://` or absolute path of the image. */
  path?: string;
  /** Base64 image data, with or without `data:` prefix. */
  base64?: string;
  /**
   * Show the image full-screen first, so the user can rotate it and draw frames around the text
   * they want. Only text inside the frames is returned, together with its furigana, even when
   * the furigana lies just outside a frame. Without a frame the whole image is recognized.
   * Rejects with `CANCELLED` when the user cancels.
   *
   * @default false
   */
  selectRegion?: boolean;
  /**
   * Only return text inside these boxes (pixels of the upright image), region by region. Images
   * over 4096 px on a side may be scaled down first; the boxes are in the size the result
   * reports as `imageWidth` × `imageHeight`.
   * Use this with your own selection UI; ignored when `selectRegion` is set.
   */
  regions?: Rect[];
}

export type GalleryOptions = Omit<RecognizeImageOptions, 'path' | 'base64'>;

export interface GalleryResult extends OcrResult {
  /**
   * `content://` URI of the chosen image, or `file://` path of the rotated copy when the user
   * rotated it in the selection screen. Use `Capacitor.convertFileSrc()` to show it in an `<img>`.
   */
  imagePath: string;
}

export interface LiveState {
  running: boolean;
  /** `true` while the preview shows a frame frozen by `captureFrame()`. */
  frozen: boolean;
  /** Current zoom factor; only set while running. */
  zoom?: number;
  /** Smallest zoom factor the camera supports; only set while running. */
  minZoom?: number;
  /** Largest zoom factor the camera supports; 1 when it cannot zoom. Only set while running. */
  maxZoom?: number;
}

/** Payload of the `liveRecognitionError` event. Same shape as a thrown `JapaneseOcrError`. */
export type LiveRecognitionErrorEvent = JapaneseOcrError;

export interface JapaneseOcrPlugin {
  /**
   * Checks whether Japanese OCR is supported. Never throws.
   */
  isDeviceSupported(): Promise<DeviceSupportResult>;

  /**
   * Checks whether the Japanese recognizer is loaded. Never throws.
   */
  isOcrReady(): Promise<OcrReadyResult>;

  /**
   * Loads the recognizer now and resolves once it can be used. Only needed when the app turned off loading at
   * start (Android: `plugins.JapaneseOcr.warmUpOnLoad: false` in the Capacitor config), e.g. to ask the user first;
   * every other call loads it as well. Rejects with `UNAVAILABLE` or `NOT_READY` like the calls that need it.
   */
  prepareOcr(): Promise<void>;

  checkPermissions(): Promise<PermissionStatus>;

  requestPermissions(): Promise<PermissionStatus>;

  /**
   * Opens the camera and starts recognizing Japanese text.
   *
   * The preview is placed behind the WebView, so the page must have a
   * transparent background where the camera should be visible.
   * Results are delivered through the `textRecognized` event.
   * Asks for the camera permission if needed.
   */
  startLiveRecognition(options?: LiveRecognitionOptions): Promise<void>;

  /**
   * Stops live recognition and closes the camera.
   */
  stopLiveRecognition(): Promise<void>;

  /**
   * Takes a full-resolution photo, freezes the preview on it and returns the recognized text.
   * Live events pause until `resumeLiveRecognition()` is called.
   */
  captureFrame(options?: CaptureOptions): Promise<CaptureResult>;

  /**
   * Unfreezes the preview after `captureFrame()` and resumes live recognition.
   */
  resumeLiveRecognition(): Promise<void>;

  getLiveState(): Promise<LiveState>;

  /**
   * Switches the flashlight while live recognition runs.
   */
  setTorch(options: { enabled: boolean }): Promise<void>;

  /**
   * Focuses the camera on a point of the preview, e.g. where the user tapped. The camera goes
   * back to continuous autofocus after a few seconds.
   */
  focusAt(options: FocusOptions): Promise<void>;

  /**
   * Zooms the camera while live recognition runs. Zooming in makes small text such as furigana
   * larger in the picture, so it is recognized more reliably. The value is clamped to the range of
   * `getLiveState()`. Rejects with `UNAVAILABLE` when the camera cannot zoom.
   */
  setZoom(options: ZoomOptions): Promise<void>;

  /**
   * Recognizes Japanese text in an existing image.
   */
  recognizeImage(options: RecognizeImageOptions): Promise<OcrResult>;

  /**
   * Lets the user pick an image from the gallery (system photo picker, no permission needed) and
   * recognizes its Japanese text. With `selectRegion: true` the user can then rotate the image
   * and frame the text they want. Rejects with `CANCELLED` when the picker or the selection
   * screen is closed.
   */
  recognizeFromGallery(options?: GalleryOptions): Promise<GalleryResult>;

  /**
   * Deletes the images the plugin saved so far (`captureFrame({ saveImage: true })`, rotated gallery images),
   * e.g. when the user leaves the scan screen. Paths returned before no longer work afterwards. Web engine: revokes
   * the `blob:` URLs it created.
   */
  clearImages(): Promise<void>;

  /**
   * Recognizes handwritten Japanese from strokes and returns up to 5 candidates with probabilities.
   * Works for single characters, words and whole sentences; a sentence may span several rows written
   * one below the other. Write horizontally. The first call downloads the model (about 20 MB) if
   * `prepareHandwriting()` has not done so; after that it works offline.
   */
  recognizeHandwriting(options: RecognizeHandwritingOptions): Promise<HandwritingResult>;

  /**
   * Downloads the Japanese handwriting model, if not on the device yet.
   */
  prepareHandwriting(options?: PrepareHandwritingOptions): Promise<void>;

  /**
   * Checks whether the handwriting model is downloaded. Never throws.
   */
  isHandwritingReady(): Promise<{ ready: boolean }>;

  /**
   * Fired for every analyzed live frame, also with an empty result (`text: ''`, no blocks) when no
   * text is visible. Paused while the preview is frozen by `captureFrame()`. The result is
   * smoothed over frames unless live recognition was started with `stabilize: false`.
   */
  addListener(eventName: 'textRecognized', listenerFunc: (result: OcrResult) => void): Promise<PluginListenerHandle>;

  /**
   * Fired when recognizing a live frame fails.
   */
  addListener(
    eventName: 'liveRecognitionError',
    listenerFunc: (error: LiveRecognitionErrorEvent) => void,
  ): Promise<PluginListenerHandle>;

  removeAllListeners(): Promise<void>;

  /**
   * Chooses the OCR engine. Switching stops a running live recognition of the previous engine.
   * Listeners stay registered. Rejects with `UNAVAILABLE` for `native` where there is no native
   * engine. The choice is not stored; set it again after an app start.
   */
  setEngine(options: EngineOptions): Promise<void>;

  /** The chosen and the active engine. Never throws. */
  getEngine(): Promise<EngineState>;
}
