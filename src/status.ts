// The "Engine" and "Status" sections: engine choice (kept in localStorage across app starts)
// and what the plugin reports about the device, its models and the camera permission.
import { JapaneseOcr } from 'capacitor-japanese-ocr';
import type { EngineOptions } from 'capacitor-japanese-ocr';

import { setLive } from './live';
import { $, log, run } from './ui';

const ENGINE_KEY = 'ocr-engine';

function storedEngine(): EngineOptions['engine'] {
  try {
    const value = localStorage.getItem(ENGINE_KEY);
    return value === 'native' || value === 'web' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

async function showEngine(): Promise<void> {
  const state = await JapaneseOcr.getEngine();
  $<HTMLSelectElement>('engine').value = state.engine;
  const nativeOption = $('engine').querySelector<HTMLOptionElement>('option[value="native"]');
  if (nativeOption) nativeOption.disabled = !state.nativeAvailable;
  $('engine-state').textContent =
    `Aktiv: ${state.active === 'web' ? 'Web (PaddleOCR im WebView, nur Browser-Funktionen)' : 'Nativ (ML Kit)'}` +
    (state.nativeAvailable ? '' : ' · keine native Engine auf dieser Plattform');
}

async function changeEngine(engine: EngineOptions['engine']): Promise<void> {
  const ok = await run(`setEngine(${engine})`, () => JapaneseOcr.setEngine({ engine }).then(() => true));
  if (ok) {
    try {
      localStorage.setItem(ENGINE_KEY, engine);
    } catch {
      // Not stored; the choice still applies until the app restarts.
    }
    // Switching stops a running camera, so leave the live view.
    setLive(false);
  }
  await showEngine();
  await refreshStatus();
}

/** Applies the stored engine choice. Runs first, so every later call goes to the chosen engine. */
export async function initEngine(): Promise<void> {
  await JapaneseOcr.setEngine({ engine: storedEngine() }).catch((error) => log('setEngine', error));
  await showEngine();
  $<HTMLSelectElement>('engine').onchange = (event) =>
    void changeEngine((event.target as HTMLSelectElement).value as EngineOptions['engine']);
}

export async function refreshStatus(): Promise<void> {
  const support = await JapaneseOcr.isDeviceSupported();
  $('supported').textContent = support.supported
    ? `ja (Kamera: ${support.liveCamera ? 'ja' : 'nein'}, ` +
      `Handschrift: ${support.handwriting ? 'ja' : 'nein'})`
    : `nein: ${support.reason ?? ''}`;
  if (support.engine) $('supported').textContent += ` · Engine: ${support.engine}`;

  const { ready, reason } = await JapaneseOcr.isOcrReady();
  $('ready').textContent = ready ? 'ja' : reason ? `nein: ${reason}` : 'nein (lädt noch)';

  const handwritingReady = await JapaneseOcr.isHandwritingReady();
  $('handwriting-ready').textContent = handwritingReady.ready ? 'geladen' : 'nicht geladen (lädt beim ersten Schreiben)';

  try {
    const permission = await JapaneseOcr.checkPermissions();
    $('permission').textContent = permission.camera;
  } catch (error) {
    $('permission').textContent = (error as Error).message;
  }
}

/** Buttons of the "Status" section. */
export function initStatus(): void {
  $('refresh').onclick = () => void refreshStatus();
  $('request-permission').onclick = async () => {
    await run('requestPermissions', () => JapaneseOcr.requestPermissions());
    await refreshStatus();
  };
}

/**
 * Polls isOcrReady() after start-up until the recognizer is loaded or failed and shows how long it
 * took, so a slow first load is visible instead of a "nein" that never updates.
 */
export async function watchReady(): Promise<void> {
  const started = performance.now();
  const seconds = () => ((performance.now() - started) / 1000).toFixed(1);
  for (;;) {
    const { ready, reason } = await JapaneseOcr.isOcrReady();
    if (ready || reason) {
      $('ready').textContent = ready ? `ja (nach ${seconds()} s)` : `nein: ${reason}`;
      log(ready ? `OCR bereit nach ${seconds()} s` : `OCR lädt nicht: ${reason}`);
      return;
    }
    $('ready').textContent = `lädt … (${seconds()} s)`;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
