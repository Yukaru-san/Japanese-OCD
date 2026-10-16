// The live camera: start/stop, the overlay at the bottom (text and buttons) and the
// glossary markers drawn over the words in the camera picture.
import { JapaneseOcr } from 'capacitor-japanese-ocr';

import { WordOverlay, findWords } from './overlay';
import { showResult } from './result';
import { $, log, run } from './ui';

const overlay = new WordOverlay($('word-layer'), $('word-popup'));
let torchOn = false;

/**
 * Shows or hides the live view. The class `live` on <body> hides the panels and makes the page
 * transparent, so the camera preview behind the WebView is visible.
 */
export function setLive(live: boolean): void {
  document.body.classList.toggle('live', live);
  $('live-overlay').hidden = !live;
  $('capture').hidden = false;
  $('resume').hidden = true;
  $('live-text').textContent = '';
  $('live-words').textContent = '';
  overlay.clear();
  torchOn = false;
}

async function startLive(): Promise<void> {
  try {
    await JapaneseOcr.startLiveRecognition({ intervalMs: 400 });
    setLive(true);
    log('startLiveRecognition ok');
  } catch (error) {
    log('startLiveRecognition', error);
  }
}

function showLiveWords(matches: ReturnType<typeof findWords>): void {
  const words = [...new Set(matches.map((m) => m.word))];
  $('live-words').textContent = words.length ? `Antippen für Erklärung: ${words.join('、')}` : '';
}

/** Freezes the picture, shows its text in the overlay and in the result section. */
async function capture(): Promise<void> {
  const result = await run('captureFrame', () => JapaneseOcr.captureFrame({ saveImage: true }));
  if (!result) return;
  showResult(result);
  $('live-text').textContent = result.text || '(kein Text erkannt)';
  showLiveWords(overlay.render(result));
  $('capture').hidden = true;
  $('resume').hidden = false;
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

async function toggleTorch(): Promise<void> {
  const ok = await run(`setTorch(${!torchOn})`, () => JapaneseOcr.setTorch({ enabled: !torchOn }).then(() => true));
  if (ok) torchOn = !torchOn;
}

/** Registers the plugin's live events. Listeners stay for the whole app run, across start and stop. */
export async function initLiveListeners(): Promise<void> {
  await JapaneseOcr.addListener('textRecognized', (result) => {
    $('live-text').textContent = result.text;
    showLiveWords(overlay.render(result));
  });
  await JapaneseOcr.addListener('liveRecognitionError', (error) => log('live', error));
}

export function initLive(): void {
  $('start').onclick = () => void startLive();
  $('capture').onclick = () => void capture();
  $('resume').onclick = () => void resume();
  $('stop').onclick = () => void stopLive();
  $('torch').onclick = () => void toggleTorch();
}
