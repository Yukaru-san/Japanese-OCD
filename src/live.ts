// The live camera: start/stop, the overlay at the bottom (text and buttons), zoom, tap to focus
// and the glossary markers drawn over the words in the camera picture.
import { JapaneseOcr, toRubyHtml } from 'capacitor-japanese-ocr';
import type { OcrResult } from 'capacitor-japanese-ocr';

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
  $('zoom-row').hidden = true;
  overlay.clear();
  torchOn = false;
}

async function startLive(): Promise<void> {
  try {
    // Results arrive smoothed over frames (stabilize is on by default), so they do not jump.
    await JapaneseOcr.startLiveRecognition();
    setLive(true);
    log('startLiveRecognition ok');
    await initZoom();
  } catch (error) {
    log('startLiveRecognition', error);
  }
}

/** Shows the zoom slider when the camera can zoom. */
async function initZoom(): Promise<void> {
  const state = await JapaneseOcr.getLiveState();
  const slider = $<HTMLInputElement>('zoom');
  if (!state.maxZoom || state.maxZoom <= 1) return;
  slider.min = String(state.minZoom ?? 1);
  slider.max = String(Math.min(state.maxZoom, 8));
  slider.value = String(state.zoom ?? 1);
  $('zoom-value').textContent = `${Number(slider.value).toFixed(1)}×`;
  $('zoom-row').hidden = false;
}

function onZoom(): void {
  const ratio = Number($<HTMLInputElement>('zoom').value);
  $('zoom-value').textContent = `${ratio.toFixed(1)}×`;
  JapaneseOcr.setZoom({ ratio }).catch((error) => log('setZoom', error));
}

/** A tap on the camera picture (not on a marker or a button) focuses there. */
function onTapPicture(event: MouseEvent): void {
  if (!document.body.classList.contains('live')) return;
  const target = event.target as HTMLElement;
  if (target.closest('#live-overlay, #word-popup, .word-marker')) return;
  if (overlay.popupOpen) return overlay.closePopup();
  JapaneseOcr.focusAt({ x: event.clientX, y: event.clientY }).catch((error) => log('focusAt', error));
  const ring = $('focus-ring');
  Object.assign(ring.style, { left: `${event.clientX}px`, top: `${event.clientY}px` });
  ring.hidden = false;
  ring.classList.remove('pulse');
  void ring.offsetWidth; // restart the animation
  ring.classList.add('pulse');
}

/** Shows a result in the overlay: the text with furigana as ruby, the glossary words and markers. */
function showLive(result: OcrResult): void {
  $('live-text').innerHTML = toRubyHtml(result) || '(kein Text erkannt)';
  showLiveWords(overlay.render(result));
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
  showLive(result);
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
    // While an explanation is open the markers stay still, so the word stays where it was tapped.
    if (overlay.popupOpen) return;
    $('live-text').innerHTML = toRubyHtml(result);
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
  $('zoom').oninput = onZoom;
  document.addEventListener('click', onTapPicture);
}
