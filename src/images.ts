// The "Bild erkennen" section: an image from the system gallery (recognizeFromGallery) or from a
// file input (read as base64 and passed to recognizeImage), optionally framed by the user first.
import { JapaneseOcr } from 'capacitor-japanese-ocr';

import { showResult } from './result';
import { $, log } from './ui';

function selectRegion(): boolean {
  return $<HTMLInputElement>('select-region').checked;
}

async function recognizeFile(file: File): Promise<void> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  try {
    const started = performance.now();
    const result = await JapaneseOcr.recognizeImage({ base64, selectRegion: selectRegion() });
    showResult(result);
    log(`recognizeImage ok (${Math.round(performance.now() - started)} ms)`);
  } catch (error) {
    // Closing the selection screen is not an error worth showing.
    const code = (error as { code?: string }).code;
    log(code === 'CANCELLED' ? 'Auswahl abgebrochen' : 'recognizeImage', code === 'CANCELLED' ? undefined : error);
  }
}

async function recognizeGallery(): Promise<void> {
  try {
    const started = performance.now();
    const result = await JapaneseOcr.recognizeFromGallery({ selectRegion: selectRegion() });
    showResult(result);
    log(`recognizeFromGallery ok (${Math.round(performance.now() - started)} ms)`);
  } catch (error) {
    const code = (error as { code?: string }).code;
    log(
      code === 'CANCELLED' ? 'Galerie: keine Auswahl oder abgebrochen' : 'recognizeFromGallery',
      code === 'CANCELLED' ? undefined : error,
    );
  }
}

export function initImages(): void {
  $('gallery').onclick = () => void recognizeGallery();
  $<HTMLInputElement>('file').onchange = (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void recognizeFile(file);
  };
}
