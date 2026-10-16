import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import { JapaneseOcr, toRubyHtml } from 'capacitor-japanese-ocr';
import type { OcrResult, TranslationOptions } from 'capacitor-japanese-ocr';

import { InkPad } from './handwriting';
import { WordOverlay, findWords } from './overlay';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const translateBox = $<HTMLInputElement>('translate');
const languageSelect = $<HTMLSelectElement>('language');
const resultText = $<HTMLTextAreaElement>('result');
const resultTranslation = $<HTMLTextAreaElement>('result-translation');
const capturedImage = $<HTMLImageElement>('captured-image');
const logEl = $('log');
const overlay = new WordOverlay($('word-layer'), $('word-popup'));

let torchOn = false;

function log(message: string, error?: unknown): void {
  const time = new Date().toLocaleTimeString();
  let line = `${time} ${message}`;
  if (error) {
    const e = error as { code?: string; message?: string };
    line += ` → ${e.code ?? 'ERROR'}: ${e.message ?? String(error)}`;
  }
  logEl.textContent = `${line}\n${logEl.textContent ?? ''}`;
}

function selectRegion(): boolean {
  return $<HTMLInputElement>('select-region').checked;
}

function translation(): TranslationOptions {
  return { enabled: translateBox.checked, targetLanguage: languageSelect.value };
}

/** Runs a plugin call, logs its outcome and never throws. */
async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const value = await fn();
    log(`${label} ok`);
    return value;
  } catch (error) {
    log(label, error);
    return undefined;
  }
}

function showResult(result: OcrResult & { imagePath?: string }): void {
  resultText.value = result.text;
  resultTranslation.value = result.translatedText ?? '';
  $('json').textContent = JSON.stringify(result, null, 2);
  // Text with its furigana as <ruby>; toRubyHtml escapes the text.
  $('result-ruby').innerHTML = result.furigana?.length ? toRubyHtml(result) : '';
  const words = findWords(result).map((m) => `${m.word} = ${m.entry.meaning}`);
  const readings = (result.furigana ?? []).map((f) => (f.base ? `${f.base} = ${f.text}` : f.text));
  $('result-furigana').textContent = readings.length ? `Furigana: ${[...new Set(readings)].join(', ')}` : '';
  $('result-words').textContent = words.length ? `Glossar: ${[...new Set(words)].join(', ')}` : '';
  if (result.imagePath) {
    capturedImage.src = Capacitor.convertFileSrc(result.imagePath);
    capturedImage.hidden = false;
  } else {
    capturedImage.hidden = true;
  }
}

async function refreshStatus(): Promise<void> {
  const support = await JapaneseOcr.isDeviceSupported();
  $('supported').textContent = support.supported
    ? `ja (Kamera: ${support.liveCamera ? 'ja' : 'nein'}, Übersetzung: ${support.translation ? 'ja' : 'nein'}, ` +
      `Handschrift: ${support.handwriting ? 'ja' : 'nein'})`
    : `nein: ${support.reason ?? ''}`;

  const { ready } = await JapaneseOcr.isOcrReady();
  $('ready').textContent = ready ? 'ja' : 'nein';

  const handwritingReady = await JapaneseOcr.isHandwritingReady();
  $('handwriting-ready').textContent = handwritingReady.ready ? 'geladen' : 'nicht geladen (lädt beim ersten Schreiben)';

  const translationReady = await JapaneseOcr.isTranslationReady({ targetLanguage: languageSelect.value });
  $('translation-ready').textContent = `${languageSelect.value}: ${translationReady.ready ? 'geladen' : 'nicht geladen'}`;

  try {
    const permission = await JapaneseOcr.checkPermissions();
    $('permission').textContent = permission.camera;
  } catch (error) {
    $('permission').textContent = (error as Error).message;
  }
}

function setLive(live: boolean): void {
  document.body.classList.toggle('live', live);
  $('live-overlay').hidden = !live;
  $('capture').hidden = false;
  $('resume').hidden = true;
  $('live-text').textContent = '';
  $('live-translation').textContent = '';
  $('live-words').textContent = '';
  overlay.clear();
  $('live-translate').textContent = translateBox.checked ? 'Übersetzung aus' : 'Übersetzung an';
  torchOn = false;
}

async function startLive(): Promise<void> {
  try {
    await JapaneseOcr.startLiveRecognition({ intervalMs: 400, translation: translation() });
    setLive(true);
    log('startLiveRecognition ok');
  } catch (error) {
    log('startLiveRecognition', error);
  }
}

async function capture(): Promise<void> {
  const result = await run('captureFrame', () => JapaneseOcr.captureFrame({ saveImage: true }));
  if (!result) return;
  showResult(result);
  $('live-text').textContent = result.text || '(kein Text erkannt)';
  $('live-translation').textContent = result.translatedText ?? '';
  showLiveWords(overlay.render(result));
  $('capture').hidden = true;
  $('resume').hidden = false;
}

function showLiveWords(matches: ReturnType<typeof findWords>): void {
  const words = [...new Set(matches.map((m) => m.word))];
  $('live-words').textContent = words.length ? `Antippen für Erklärung: ${words.join('、')}` : '';
}

async function resume(): Promise<void> {
  await run('resumeLiveRecognition', () => JapaneseOcr.resumeLiveRecognition());
  $('capture').hidden = false;
  $('resume').hidden = true;
}

async function stopLive(): Promise<void> {
  await run('stopLiveRecognition', () => JapaneseOcr.stopLiveRecognition());
  setLive(false);
}

async function toggleLiveTranslation(): Promise<void> {
  const enable = !translateBox.checked;
  const ok = await run(`setTranslation(${enable})`, () =>
    JapaneseOcr.setTranslation({ enabled: enable, targetLanguage: languageSelect.value }).then(() => true),
  );
  if (!ok) return;
  translateBox.checked = enable;
  $('live-translate').textContent = enable ? 'Übersetzung aus' : 'Übersetzung an';
  if (!enable) $('live-translation').textContent = '';
}

async function recognizeFile(file: File): Promise<void> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  try {
    const result = await JapaneseOcr.recognizeImage({ base64, translation: translation(), selectRegion: selectRegion() });
    showResult(result);
    log('recognizeImage ok');
  } catch (error) {
    const code = (error as { code?: string }).code;
    log(code === 'CANCELLED' ? 'Auswahl abgebrochen' : 'recognizeImage', code === 'CANCELLED' ? undefined : error);
  }
}

async function recognizeGallery(): Promise<void> {
  try {
    const result = await JapaneseOcr.recognizeFromGallery({ translation: translation(), selectRegion: selectRegion() });
    showResult(result);
    log('recognizeFromGallery ok');
  } catch (error) {
    const code = (error as { code?: string }).code;
    log(code === 'CANCELLED' ? 'Galerie: keine Auswahl oder abgebrochen' : 'recognizeFromGallery', code === 'CANCELLED' ? undefined : error);
  }
}

let inkPad: InkPad;
let inkRequest = 0;

/** Recognizes the drawing and lists up to 5 candidates; tapping one appends it to the text field. */
async function recognizeInk(): Promise<void> {
  const request = ++inkRequest;
  const list = $('ink-candidates');
  const status = $('ink-status');
  if (!inkPad.strokes.length) {
    list.textContent = '';
    status.textContent = '';
    return;
  }
  status.textContent = 'erkenne …';
  const started = performance.now();
  try {
    const result = await JapaneseOcr.recognizeHandwriting({
      strokes: inkPad.strokes,
      width: inkPad.width,
      height: inkPad.height,
      preContext: $<HTMLTextAreaElement>('ink-text').value,
    });
    if (request !== inkRequest) return; // a newer stroke is being recognized
    status.textContent = `${Math.round(performance.now() - started)} ms`;
    list.textContent = '';
    for (const candidate of result.candidates) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      const text = document.createElement('span');
      text.textContent = candidate.text;
      const probability = document.createElement('span');
      probability.className = 'probability';
      probability.textContent = `${(candidate.probability * 100).toFixed(1)} %`;
      button.append(text, probability);
      button.onclick = () => {
        $<HTMLTextAreaElement>('ink-text').value += candidate.text;
        inkPad.clear();
      };
      item.append(button);
      list.append(item);
    }
    $('json').textContent = JSON.stringify(result, null, 2);
    $('handwriting-ready').textContent = 'geladen';
  } catch (error) {
    if (request !== inkRequest) return;
    status.textContent = '';
    log('recognizeHandwriting', error);
  }
}

async function copy(text: string, label: string): Promise<void> {
  if (!text) {
    log(`${label}: nichts zu kopieren`);
    return;
  }
  await run(label, () => Clipboard.write({ string: text }));
}

async function init(): Promise<void> {
  await JapaneseOcr.addListener('textRecognized', (result) => {
    $('live-text').textContent = result.text;
    $('live-translation').textContent = result.translatedText ?? '';
    showLiveWords(overlay.render(result));
  });
  await JapaneseOcr.addListener('liveRecognitionError', (error) => log('live', error));

  $('refresh').onclick = () => void refreshStatus();
  $('request-permission').onclick = async () => {
    await run('requestPermissions', () => JapaneseOcr.requestPermissions());
    await refreshStatus();
  };
  languageSelect.onchange = () => void refreshStatus();
  $('prepare-translation').onclick = async () => {
    log(`Lade Modell ja → ${languageSelect.value} …`);
    await run('prepareTranslation', () => JapaneseOcr.prepareTranslation({ targetLanguage: languageSelect.value }));
    await refreshStatus();
  };
  inkPad = new InkPad($<HTMLCanvasElement>('ink'), () => void recognizeInk());
  $('ink-undo').onclick = () => inkPad.undo();
  $('ink-clear').onclick = () => inkPad.clear();
  $('start').onclick = () => void startLive();
  $('capture').onclick = () => void capture();
  $('resume').onclick = () => void resume();
  $('stop').onclick = () => void stopLive();
  $('torch').onclick = async () => {
    const ok = await run(`setTorch(${!torchOn})`, () => JapaneseOcr.setTorch({ enabled: !torchOn }).then(() => true));
    if (ok) torchOn = !torchOn;
  };
  $('live-translate').onclick = () => void toggleLiveTranslation();
  $('gallery').onclick = () => void recognizeGallery();
  $<HTMLInputElement>('file').onchange = (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void recognizeFile(file);
  };
  $('copy').onclick = () => void copy(resultText.value, 'Text kopiert');
  $('copy-translation').onclick = () => void copy(resultTranslation.value, 'Übersetzung kopiert');
  $('translate-result').onclick = async () => {
    const result = await run('translateText', () =>
      JapaneseOcr.translateText({ text: resultText.value, targetLanguage: languageSelect.value }),
    );
    if (result) resultTranslation.value = result.text;
  };

  await refreshStatus();
  // The recognizer warms up in the background; show when it becomes ready.
  setTimeout(() => void refreshStatus(), 1500);
}

void init();
