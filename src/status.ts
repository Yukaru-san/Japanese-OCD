// The "Engine" and "Status" sections: engine choice (kept in localStorage across app starts)
// and what the plugin reports about the device, its models and the camera permission.
import { JapaneseOcr } from 'capacitor-japanese-ocr';
import type { EngineOptions, OcrReadyResult } from 'capacitor-japanese-ocr';

import { setLive } from './live';
import { $, log, run } from './ui';

const ENGINE_KEY = 'ocr-engine';

const MODEL_TEXT: Record<NonNullable<OcrReadyResult['model']>, string> = {
  checking: 'wird geprüft …',
  missing: 'nicht auf dem Gerät',
  downloading: 'wird von Google Play Services geladen',
  installed: 'installiert',
  unavailable: 'nicht verfügbar (keine Google Play Services)',
};

/** Pending automatic refresh while the model is still being checked or downloaded. */
let modelTimer: ReturnType<typeof setTimeout> | undefined;

function modelText(state: OcrReadyResult): string {
  if (!state.model) return 'gebündelt (Web-Engine)';
  let text = MODEL_TEXT[state.model];
  if (state.model === 'downloading' && state.progress != null) text += ` (${Math.round(state.progress * 100)} %)`;
  if (state.message) text += ` · ${state.message}`;
  return text;
}

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

  const ocrState = await JapaneseOcr.isOcrReady();
  $('ready').textContent = ocrState.ready ? 'ja' : 'nein';
  $('ocr-model').textContent = modelText(ocrState);
  // Follow the download (and the warm-up after it) without pressing "Aktualisieren".
  clearTimeout(modelTimer);
  if (ocrState.model === 'checking' || ocrState.model === 'downloading' || (ocrState.model === 'installed' && !ocrState.ready)) {
    modelTimer = setTimeout(() => void refreshStatus(), 1000);
  }

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
  $('prepare-ocr').onclick = async () => {
    const pending = run('prepareOcr', () => JapaneseOcr.prepareOcr());
    await refreshStatus();
    await pending;
    await refreshStatus();
  };
}
