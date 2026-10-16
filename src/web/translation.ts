/**
 * Japanese → target language translation in the browser, with the built-in on-device Translator
 * API (Chrome 138+ on desktop). Where the browser has no such API, translation is unavailable.
 */

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface BrowserTranslator {
  translate(text: string): Promise<string>;
  destroy?(): void;
}

interface TranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
  create(options: { sourceLanguage: string; targetLanguage: string }): Promise<BrowserTranslator>;
}

export const DEFAULT_TARGET = 'en';

function api(): TranslatorApi | null {
  const candidate = (globalThis as { Translator?: TranslatorApi }).Translator;
  return candidate && typeof candidate.availability === 'function' ? candidate : null;
}

/** `true` when the browser can translate on the device. */
export function isTranslationSupported(): boolean {
  return api() != null;
}

/**
 * Maps a BCP-47 tag to the language code used for translation, like the Android engine.
 *
 * @return null when the tag is invalid or Japanese itself
 */
export function resolveTarget(tag: string | undefined | null): string | null {
  const language = (tag || DEFAULT_TARGET).split(/[-_]/)[0].toLowerCase();
  if (!/^[a-z]{2,3}$/.test(language) || language === 'ja') return null;
  return language;
}

const translators = new Map<string, Promise<BrowserTranslator>>();

/** Some browsers (e.g. headless Chrome) never answer `availability()`; after this, it counts as unavailable. */
const AVAILABILITY_TIMEOUT_MS = 5000;

async function availabilityOf(target: string): Promise<Availability> {
  const translator = api();
  if (!translator) return 'unavailable';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      translator.availability({ sourceLanguage: 'ja', targetLanguage: target }),
      new Promise<Availability>(
        (resolve) => (timer = setTimeout(() => resolve('unavailable'), AVAILABILITY_TIMEOUT_MS)),
      ),
    ]);
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}

export async function isReady(target: string): Promise<boolean> {
  return (await availabilityOf(target)) === 'available';
}

/** Downloads the language pack if needed. Browsers may require a user gesture (a tap) for this. */
export async function download(target: string): Promise<void> {
  if (!api()) throw new Error('This browser has no on-device translation.');
  const availability = await availabilityOf(target);
  if (availability === 'unavailable')
    throw new Error(`Translating Japanese to '${target}' is not supported by this browser.`);
  await get(target);
}

function get(target: string): Promise<BrowserTranslator> {
  let translator = translators.get(target);
  if (!translator) {
    translator = api()!.create({ sourceLanguage: 'ja', targetLanguage: target });
    translators.set(target, translator);
    translator.catch(() => translators.delete(target));
  }
  return translator;
}

export async function translate(target: string, text: string): Promise<string> {
  if (!text) return '';
  return (await get(target)).translate(text);
}

export async function translateAll(target: string, texts: string[]): Promise<string[]> {
  const translator = await get(target);
  return Promise.all(texts.map((text) => (text ? translator.translate(text) : Promise.resolve(''))));
}
