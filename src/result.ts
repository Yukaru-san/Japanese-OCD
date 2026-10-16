// The "Ergebnis" section: shows a recognition result (text, ruby, furigana, glossary words, photo,
// raw JSON) and copies the text.
import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';
import { toRubyHtml } from 'capacitor-japanese-ocr';
import type { OcrResult } from 'capacitor-japanese-ocr';

import { findWords } from './overlay';
import { $, log, run } from './ui';

const resultText = $<HTMLTextAreaElement>('result');
const capturedImage = $<HTMLImageElement>('captured-image');

export function showResult(result: OcrResult & { imagePath?: string }): void {
  resultText.value = result.text;
  $('json').textContent = JSON.stringify(result, null, 2);
  // Text with its furigana as <ruby>; toRubyHtml escapes the text.
  $('result-ruby').innerHTML = result.furigana?.length ? toRubyHtml(result) : '';
  const words = findWords(result).map((m) => `${m.word} = ${m.entry.meaning}`);
  const readings = (result.furigana ?? []).map((f) => (f.base ? `${f.base} = ${f.text}` : f.text));
  $('result-furigana').textContent = readings.length ? `Furigana: ${[...new Set(readings)].join(', ')}` : '';
  $('result-words').textContent = words.length ? `Glossar: ${[...new Set(words)].join(', ')}` : '';
  if (result.imagePath) {
    // file:// and content:// paths need the WebView's URL for them.
    capturedImage.src = Capacitor.convertFileSrc(result.imagePath);
    capturedImage.hidden = false;
  } else {
    capturedImage.hidden = true;
  }
}

async function copy(text: string, label: string): Promise<void> {
  if (!text) {
    log(`${label}: nichts zu kopieren`);
    return;
  }
  await run(label, () => Clipboard.write({ string: text }));
}

export function initResult(): void {
  $('copy').onclick = () => void copy(resultText.value, 'Text kopiert');
}
