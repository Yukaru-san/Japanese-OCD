import type { PermissionState, PluginListenerHandle } from '@capacitor/core';

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
  /** The translation model for the target language is not downloaded. Call `prepareTranslation()`. */
  | 'TRANSLATION_NOT_READY'
  /** Translating the recognized text failed. */
  | 'TRANSLATION_FAILED'
  /** The user closed the photo picker without choosing an image. */
  | 'CANCELLED';

/**
 * Shape of every error the plugin rejects with. Narrow a caught value with `isJapaneseOcrError()`.
 */
export interface JapaneseOcrError {
  code: JapaneseOcrErrorCode;
  message: string;
}

export interface DeviceSupportResult {
  /** `true` when Japanese text recognition is available on this device. */
  supported: boolean;
  /** `true` when live camera recognition is available (device has a camera). */
  liveCamera: boolean;
  /** `true` when on-device translation is available. */
  translation: boolean;
  /** Why the device is not (fully) supported. */
  reason?: string;
}

export interface OcrReadyResult {
  /** `true` once the Japanese recognizer is loaded and has processed a warm-up image. */
  ready: boolean;
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

export interface OcrBlock extends OcrGeometry {
  text: string;
  /** Translation of this block. Only set when translation is enabled. */
  translatedText?: string;
  recognizedLanguage: string;
  lines: OcrLine[];
}

export interface OcrResult {
  /** All recognized text, blocks separated by a line break. */
  text: string;
  /** Translation of all blocks, separated by a line break. Only set when translation is enabled. */
  translatedText?: string;
  /** Target language of `translatedText`. */
  targetLanguage?: string;
  blocks: OcrBlock[];
  /** Width of the (upright) image the coordinates refer to. */
  imageWidth: number;
  /** Height of the (upright) image the coordinates refer to. */
  imageHeight: number;
}

export interface CaptureResult extends OcrResult {
  /**
   * `file://` path of the captured JPEG, when `saveImage` was set.
   * Use `Capacitor.convertFileSrc()` to show it in an `<img>`.
   */
  imagePath?: string;
}

export interface TranslationOptions {
  /** Turns translation of the recognized Japanese text on or off. */
  enabled: boolean;
  /**
   * BCP-47 code of the target language, e.g. `en` or `de`.
   *
   * @default 'en'
   */
  targetLanguage?: string;
}

export interface LiveRecognitionOptions {
  /**
   * Which camera to use.
   *
   * @default 'back'
   */
  lensFacing?: 'back' | 'front';
  /**
   * Minimum time between two recognized frames in milliseconds.
   *
   * @default 500
   */
  intervalMs?: number;
  /**
   * Translate the recognized text of every frame.
   * The model must be downloaded with `prepareTranslation()` first.
   */
  translation?: TranslationOptions;
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
  /** Translate the recognized text. */
  translation?: TranslationOptions;
}

export interface GalleryOptions {
  /** Translate the recognized text. */
  translation?: TranslationOptions;
}

export interface GalleryResult extends OcrResult {
  /**
   * `content://` URI of the chosen image. Use `Capacitor.convertFileSrc()` to show it in an `<img>`.
   */
  imagePath: string;
}

export interface PrepareTranslationOptions {
  /**
   * BCP-47 code of the target language.
   *
   * @default 'en'
   */
  targetLanguage?: string;
  /**
   * Only download the model over Wi-Fi.
   *
   * @default false
   */
  requireWifi?: boolean;
}

export interface TranslateTextOptions {
  text: string;
  /**
   * BCP-47 code of the target language.
   *
   * @default 'en'
   */
  targetLanguage?: string;
}

export interface LiveState {
  running: boolean;
  /** `true` while the preview shows a frame frozen by `captureFrame()`. */
  frozen: boolean;
  translation: TranslationOptions;
}

/** Payload of the `liveRecognitionError` event. Same shape as a thrown `JapaneseOcrError`. */
export type LiveRecognitionErrorEvent = JapaneseOcrError;

export interface TranslationReadyOptions {
  /**
   * BCP-47 code of the target language.
   *
   * @default 'en'
   */
  targetLanguage?: string;
}

export interface JapaneseOcrPlugin {
  /**
   * Checks whether Japanese OCR is supported. Never throws.
   */
  isDeviceSupported(): Promise<DeviceSupportResult>;

  /**
   * Checks whether the Japanese recognizer is loaded. Never throws.
   */
  isOcrReady(): Promise<OcrReadyResult>;

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
   * Turns translation of live results on or off, or changes the target language.
   */
  setTranslation(options: TranslationOptions): Promise<void>;

  /**
   * Recognizes Japanese text in an existing image.
   */
  recognizeImage(options: RecognizeImageOptions): Promise<OcrResult>;

  /**
   * Lets the user pick an image from the gallery (system photo picker, no permission needed) and
   * recognizes its Japanese text. Rejects with `CANCELLED` when the picker is closed.
   */
  recognizeFromGallery(options?: GalleryOptions): Promise<GalleryResult>;

  /**
   * Downloads the Japanese → target language model, if not on the device yet.
   */
  prepareTranslation(options?: PrepareTranslationOptions): Promise<void>;

  /**
   * Checks whether the Japanese → target language model is downloaded. Never throws.
   */
  isTranslationReady(options?: TranslationReadyOptions): Promise<{ ready: boolean }>;

  /**
   * Translates Japanese text on the device.
   */
  translateText(options: TranslateTextOptions): Promise<{ text: string; targetLanguage: string }>;

  /**
   * Fired for every analyzed live frame, also with an empty result (`text: ''`, no blocks) when no
   * text is visible. Paused while the preview is frozen by `captureFrame()`.
   */
  addListener(eventName: 'textRecognized', listenerFunc: (result: OcrResult) => void): Promise<PluginListenerHandle>;

  /**
   * Fired when recognizing or translating a live frame fails.
   */
  addListener(
    eventName: 'liveRecognitionError',
    listenerFunc: (error: LiveRecognitionErrorEvent) => void,
  ): Promise<PluginListenerHandle>;

  removeAllListeners(): Promise<void>;
}
