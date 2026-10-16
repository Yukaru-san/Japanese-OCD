// The "Handschrift" section: the drawing area (InkPad) sends its strokes to recognizeHandwriting()
// after each stroke and lists the candidates; tapping one appends it to the text field.
import { JapaneseOcr } from 'capacitor-japanese-ocr';

import { InkPad } from './ink-pad';
import { $, log } from './ui';

let inkPad: InkPad;
/** Counts requests, so the answer to an older drawing doesn't replace a newer one. */
let inkRequest = 0;

async function recognizeInk(): Promise<void> {
  const request = ++inkRequest;
  const list = $('ink-candidates');
  const status = $('ink-status');
  if (!inkPad.strokes.length) {
    list.textContent = '';
    status.textContent = '';
    return;
  }
  const started = performance.now();
  const [{ ready }, { active }] = await Promise.all([JapaneseOcr.isHandwritingReady(), JapaneseOcr.getEngine()]);
  if (request !== inkRequest) return;
  // The first stroke downloads the model; without network that fails at once with HANDWRITING_NOT_READY.
  status.textContent = ready || active === 'web' ? 'erkenne …' : 'lade Handschrift-Modell (einmalig ~20 MB, braucht Internet) …';
  try {
    const result = await JapaneseOcr.recognizeHandwriting({
      strokes: inkPad.strokes,
      width: inkPad.width,
      height: inkPad.height,
      // The text accepted so far helps the recognizer with the next characters.
      preContext: $<HTMLTextAreaElement>('ink-text').value,
    });
    if (request !== inkRequest) return; // a newer stroke is being recognized
    status.textContent = `${Math.round(performance.now() - started)} ms`;
    list.textContent = '';
    for (const candidate of result.candidates) list.append(candidateItem(candidate.text, candidate.probability));
    $('json').textContent = JSON.stringify(result, null, 2);
    $('handwriting-ready').textContent = 'geladen';
  } catch (error) {
    if (request !== inkRequest) return;
    const { code, message } = error as { code?: string; message?: string };
    status.textContent = `Fehler${code ? ` ${code}` : ''}: ${message ?? String(error)}`;
    log('recognizeHandwriting', error);
  }
}

/** One list entry: the candidate and its probability; tapping appends it and clears the drawing. */
function candidateItem(candidateText: string, candidateProbability: number): HTMLLIElement {
  const item = document.createElement('li');
  const button = document.createElement('button');
  const text = document.createElement('span');
  text.textContent = candidateText;
  const probability = document.createElement('span');
  probability.className = 'probability';
  probability.textContent = `${(candidateProbability * 100).toFixed(1)} %`;
  button.append(text, probability);
  button.onclick = () => {
    $<HTMLTextAreaElement>('ink-text').value += candidateText;
    inkPad.clear();
  };
  item.append(button);
  return item;
}

export function initInk(): void {
  inkPad = new InkPad($<HTMLCanvasElement>('ink'), () => void recognizeInk());
  $('ink-undo').onclick = () => inkPad.undo();
  $('ink-clear').onclick = () => inkPad.clear();
}
