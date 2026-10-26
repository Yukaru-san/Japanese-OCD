/** Settings of the web engine, read when it loads (first use). */
export interface WebEngineOptions {
  /**
   * Creates a Web Worker from the `capacitor-japanese-ocr/web-worker` entry; the models then run
   * there and the page stays responsive while they work. How the worker is created depends on the
   * bundler, e.g. with Vite:
   *
   * ```ts
   * import OcrWorker from 'capacitor-japanese-ocr/web-worker?worker';
   * configureWebEngine({ worker: () => new OcrWorker() });
   * ```
   *
   * Without it (or if the worker fails to start) the models run on the page itself.
   */
  worker?: () => Worker;
  /** `false` keeps the models on the CPU even where WebGPU is available. @default true */
  gpu?: boolean;
}

export const webEngineOptions: WebEngineOptions = {};

/** Sets up the web engine. Call it before the engine's first use; later calls have no effect on a loaded engine. */
export function configureWebEngine(options: WebEngineOptions): void {
  Object.assign(webEngineOptions, options);
}
