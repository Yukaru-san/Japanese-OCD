import { Capacitor, CapacitorException, registerPlugin } from '@capacitor/core';
import type { ExceptionCode, PluginListenerHandle } from '@capacitor/core';

import type {
  EngineOptions,
  EngineState,
  JapaneseOcrPlugin,
  LiveRecognitionOptions,
  OcrEngineName,
  OcrResult,
} from './definitions';
import { LiveStabilizer } from './live-stabilizer';
import type { JapaneseOcrEngine, JapaneseOcrWeb } from './web';

/** Every engine method, forwarded to the active engine. */
const METHODS = [
  'isDeviceSupported',
  'isOcrReady',
  'prepareOcr',
  'checkPermissions',
  'requestPermissions',
  'startLiveRecognition',
  'stopLiveRecognition',
  'captureFrame',
  'resumeLiveRecognition',
  'getLiveState',
  'setTorch',
  'focusAt',
  'setZoom',
  'recognizeImage',
  'recognizeFromGallery',
  'clearImages',
  'recognizeHandwriting',
  'prepareHandwriting',
  'isHandwritingReady',
] as const;

type Forwarded = Pick<JapaneseOcrEngine, (typeof METHODS)[number]>;

/** How the engines are loaded. */
export interface EngineLoaders {
  /** Loads the web engine on first use; omitted = native engine only (the `capacitor-japanese-ocr/native` entry). */
  web?: () => Promise<JapaneseOcrWeb>;
}

const NO_WEB_ENGINE = 'This build has no web engine (it imports capacitor-japanese-ocr/native).';

/**
 * Creates the `JapaneseOcr` object: the native Android plugin or the web engine (PaddleOCR in the
 * WebView), switchable at runtime with `setEngine()`.
 */
export function createJapaneseOcr(loaders: EngineLoaders = {}): JapaneseOcrPlugin {
  const nativeAvailable = Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('JapaneseOcr');
  // No web implementation is registered: the web engine below is used directly instead.
  const native = nativeAvailable ? registerPlugin<JapaneseOcrEngine>('JapaneseOcr') : null;
  let web: Promise<JapaneseOcrWeb> | null = null;
  const loadWeb = () =>
    (web ??= loaders.web
      ? loaders.web()
      : Promise.reject(new CapacitorException(NO_WEB_ENGINE, 'UNAVAILABLE' as ExceptionCode)));

  let choice: EngineOptions['engine'] = 'auto';
  const activeName = (): OcrEngineName => (choice === 'web' || !native ? 'web' : 'native');
  // Wrapped, because resolving a Promise with the native plugin proxy would call its (missing) then().
  const active = async (): Promise<{ engine: JapaneseOcrEngine }> => ({
    engine: activeName() === 'native' ? native! : await loadWeb(),
  });

  const plugin = {} as Record<string, unknown>;
  for (const method of METHODS) {
    plugin[method] = async (...args: unknown[]) => {
      const { engine } = (await active()) as unknown as {
        engine: Record<string, (...a: unknown[]) => Promise<unknown>>;
      };
      return engine[method](...args);
    };
  }

  plugin.isDeviceSupported = async () => {
    const engine = activeName();
    // Never throws, also without any engine
    if (engine === 'web' && !loaders.web) {
      return { supported: false, liveCamera: false, handwriting: false, engine, reason: NO_WEB_ENGINE };
    }
    const result = await (await active()).engine.isDeviceSupported();
    return { ...result, engine };
  };

  // Live results are smoothed per listener; every start, resume and stop begins afresh.
  let stabilize = true;
  const stabilizers = new Set<LiveStabilizer>();
  const resetStabilizers = () => stabilizers.forEach((s) => s.reset());
  const forward = plugin as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const start = forward.startLiveRecognition;
  plugin.startLiveRecognition = async (options?: LiveRecognitionOptions) => {
    resetStabilizers();
    stabilize = options?.stabilize !== false;
    await start(options);
  };
  for (const method of ['resumeLiveRecognition', 'stopLiveRecognition'] as const) {
    const call = forward[method];
    plugin[method] = async () => {
      resetStabilizers();
      return call();
    };
  }

  // Listeners are registered with both engines, so they keep working after a switch.
  plugin.addListener = async (eventName: string, listener: (data: unknown) => void): Promise<PluginListenerHandle> => {
    let stabilizer: LiveStabilizer | null = null;
    let deliver = listener;
    if (eventName === 'textRecognized') {
      const s = (stabilizer = new LiveStabilizer());
      stabilizers.add(s);
      deliver = (data) =>
        listener(
          stabilize ? s.push(data as OcrResult, { width: window.innerWidth, height: window.innerHeight }) : data,
        );
    }
    const handles: PluginListenerHandle[] = [];
    if (native) handles.push(await native.addListener(eventName as 'textRecognized', deliver));
    if (loaders.web) handles.push(await (await loadWeb()).addListener(eventName, deliver));
    return {
      remove: async () => {
        if (stabilizer) stabilizers.delete(stabilizer);
        await Promise.all(handles.map((h) => h.remove()));
      },
    };
  };

  plugin.removeAllListeners = async () => {
    stabilizers.clear();
    if (native) await native.removeAllListeners();
    if (web) await (await web).removeAllListeners();
  };

  plugin.setEngine = async (options: EngineOptions) => {
    const engine = options?.engine;
    if (engine !== 'auto' && engine !== 'native' && engine !== 'web') {
      throw new CapacitorException("engine must be 'auto', 'native' or 'web'.", 'INVALID_ARGUMENT' as ExceptionCode);
    }
    if (engine === 'native' && !native) {
      throw new CapacitorException('There is no native engine on this platform.', 'UNAVAILABLE' as ExceptionCode);
    }
    if (engine === 'web' && !loaders.web) {
      throw new CapacitorException(NO_WEB_ENGINE, 'UNAVAILABLE' as ExceptionCode);
    }
    const before = activeName();
    choice = engine;
    if (activeName() !== before) {
      // Only one engine may own the camera.
      const previous = before === 'native' ? native : web ? await web : null;
      await previous?.stopLiveRecognition().catch(() => undefined);
    }
  };

  plugin.getEngine = async (): Promise<EngineState> => ({
    engine: choice,
    active: activeName(),
    nativeAvailable: !!native,
  });

  return plugin as unknown as JapaneseOcrPlugin & Forwarded;
}
