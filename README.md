# capacitor-japanese-ocr

Japanese text recognition (OCR) for Capacitor apps, on the device, with Google ML Kit.

- **Live camera:** the camera preview runs behind your web page, recognized text arrives as events.
- **Capture:** freeze the picture and get its text, optionally the photo as a file.
- **Gallery & images:** let the user pick a photo from the gallery, or pass an image (file path or base64), and
  optionally let them rotate it and frame the text they want.
- **Translation (optional):** Japanese → another language, on the device, switchable at any time.
- **Positions:** every block, line and character comes with its position on screen, so you can draw your own
  highlights or buttons over recognized words.

| Platform | Support                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------- |
| Android  | Yes, Android 7.0 (API 24) or newer                                                              |
| Web, iOS | No. `isDeviceSupported()`, `isOcrReady()` and `isTranslationReady()` return `false`, every other call throws `UNAVAILABLE` |

Requires Capacitor 8.

## Quick start

### 1. Install

If your app already uses Capacitor 8 with Android:

```bash
npm install github:Yukaru-san/Japanese-OCD#main
npm run build           # build your web app
npx cap sync android
```

Starting from a plain web app (e.g. Vite, output folder `dist`), set up Capacitor first:

```bash
npm install @capacitor/core@^8 @capacitor/android@^8
npm install -D @capacitor/cli@^8
npx cap init "My App" com.example.myapp --web-dir dist
npm install github:Yukaru-san/Japanese-OCD#main
npm run build
npx cap add android
```

After any later `npm install` of a Capacitor plugin, run `npm run build && npx cap sync android` again.

That is all the native setup. The plugin adds the camera permission to your Android manifest by itself, and the
Japanese model is bundled with the app (no download, no Google Play Services needed).

### 2. Use it

```ts
import { JapaneseOcr, isJapaneseOcrError } from 'capacitor-japanese-ocr';

const output = document.querySelector('#output')!;

async function startOcr(): Promise<void> {
  // 1. Check support once. This never throws.
  const support = await JapaneseOcr.isDeviceSupported();
  if (!support.supported) {
    output.textContent = support.reason ?? 'Japanese OCR is not supported here.';
    return;
  }

  // 2. Listen for results. Register before starting; listeners stay until you remove them.
  await JapaneseOcr.addListener('textRecognized', (result) => {
    output.textContent = result.text;
  });

  // 3. Start the camera. Asks for the camera permission the first time.
  try {
    await JapaneseOcr.startLiveRecognition();
  } catch (e) {
    output.textContent = isJapaneseOcrError(e) ? `${e.code}: ${e.message}` : String(e);
  }
}

async function capture(): Promise<string> {
  // 4. Freeze the picture and get its text. The preview stays frozen until resume or stop.
  const result = await JapaneseOcr.captureFrame();
  return result.text;
}

// 5. Continue with JapaneseOcr.resumeLiveRecognition() or end with JapaneseOcr.stopLiveRecognition().
```

### 3. Make the camera visible

The camera preview is drawn **behind** the web page. While live recognition runs (also while frozen), the plugin
makes the WebView transparent and adds the class `japanese-ocr-live` to `<html>`. It also injects the rule
`html.japanese-ocr-live, html.japanese-ocr-live body { background: transparent !important }`, so your own
`html`/`body` backgrounds don't need changing. Both are removed on stop.

Any of your own full-screen elements with a background (app shell, `ion-content`, a wrapper `div`) would still
cover the camera. Make them transparent with that class:

```css
html.japanese-ocr-live #app,
html.japanese-ocr-live ion-content {
  --background: transparent;
  background: transparent;
}
```

Hide the parts of your UI you don't want over the camera the same way.

## Common tasks

### Copy the text

Use [`@capacitor/clipboard`](https://capacitorjs.com/docs/apis/clipboard). It works without a user gesture,
unlike `navigator.clipboard` in the Android WebView after an `await`:

```bash
npm install @capacitor/clipboard
npm run build && npx cap sync android
```

```ts
import { Clipboard } from '@capacitor/clipboard';

const { text } = await JapaneseOcr.captureFrame();
await Clipboard.write({ string: text });
```

### Draw over recognized words

`findText(result, word)` finds a word in a result and tells you where it is on screen. Its `viewBoundingBox` is
in CSS pixels relative to the WebView, so a `position: fixed` element at those values sits exactly on the word:

```ts
import { JapaneseOcr, findText } from 'capacitor-japanese-ocr';

const marker = document.querySelector<HTMLButtonElement>('#marker')!; // position: fixed; hidden by default
marker.onclick = () => alert('せかい (sekai): Welt'); // your own explanation, no translation involved

await JapaneseOcr.addListener('textRecognized', (result) => {
  const box = findText(result, 'せかい')[0]?.viewBoundingBox;
  marker.hidden = !box;
  if (box) {
    Object.assign(marker.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.right - box.left}px`,
      height: `${box.bottom - box.top}px`,
    });
  }
});
```

`findText` ignores spaces and matches across element borders within a line. For your own logic, every block, line,
element and character (`symbols`, one character each) carries `viewBoundingBox` as well. On live results it can
be missing for the first frames, before the preview is laid out; `findText` then returns a match without
`viewBoundingBox`.

### Translate

Translation needs a language model (~30 MB) that is downloaded once:

```ts
await JapaneseOcr.prepareTranslation({ targetLanguage: 'de' }); // download once, e.g. in settings
await JapaneseOcr.startLiveRecognition({ translation: { enabled: true, targetLanguage: 'de' } });
// result.translatedText and block.translatedText are now set

await JapaneseOcr.setTranslation({ enabled: false }); // switch off while live
const { text } = await JapaneseOcr.translateText({ text: 'こんにちは', targetLanguage: 'de' });
```

Target languages are BCP-47 codes supported by ML Kit (`en`, `de`, `fr`, `es`, `ko`, `zh`, ...). Default: `en`.
Using a language whose model is not downloaded throws `TRANSLATION_NOT_READY`.

### Recognize a photo from the gallery

```ts
try {
  const result = await JapaneseOcr.recognizeFromGallery(); // opens the system photo picker
  output.textContent = result.text;
  preview.src = Capacitor.convertFileSrc(result.imagePath); // show the chosen photo
} catch (e) {
  if (isJapaneseOcrError(e) && e.code === 'CANCELLED') return; // user closed the picker
}
```

No permission is needed: Android's photo picker only hands over the image the user chose. The camera does not
have to be running. Results have `boundingBox` but no `viewBoundingBox`, since the image is not on screen.

### Let the user frame the text they want

Add `selectRegion: true` and the plugin shows the picked image full-screen first. The user can rotate it and drag
one or more frames around the text they care about (drag a corner to resize, the red × removes a frame). Only the
text inside the frames is returned, frame by frame in the order they were drawn, together with the furigana of that
text, even when the furigana sits just above the frame. Without a frame the whole image is recognized.

```ts
const result = await JapaneseOcr.recognizeFromGallery({ selectRegion: true });
result.text;        // only the framed text
result.regions;     // the frames, in image pixels
result.blocks[0].region; // which frame a block came from
```

`recognizeImage({ path, selectRegion: true })` works the same for an image you already have. With your own selection
UI, pass the boxes instead: `recognizeImage({ path, regions: [{ left, top, right, bottom }] })` (pixels of the
upright image). Cancelling the selection screen rejects with `CANCELLED`. The screen follows the device language
(English, German, Japanese); override the `japanese_ocr_select_*` strings in your app's `strings.xml` to change it.

### Recognize an existing image

```ts
const result = await JapaneseOcr.recognizeImage({ path: 'file:///…/photo.jpg' }); // or content://…
const result2 = await JapaneseOcr.recognizeImage({ base64: 'data:image/jpeg;base64,…' });
```

## Text order and furigana

ML Kit finds text pieces in no particular order. The plugin puts them in reading order before returning them:

- Horizontal text: top to bottom, left to right. Vertical text (`result.vertical`): columns right to left.
- Lines that belong together become one paragraph (`blocks`), joined without line breaks, so
  `result.text` reads like the original. A change in text size (title vs. body) or a clear gap starts a new paragraph.
- Furigana (small kana over kanji) are taken out of `text` and returned in `result.furigana`, one entry per word,
  with the kanji it belongs to and where they are in the block's text. Each block also comes split into
  `segments`, so you can show the text with its readings right away:

```ts
const result = await JapaneseOcr.recognizeFromGallery();
result.text;     // "なぜ日本の学校では女子のポニーテールが禁止されていたの？\n2026-10-14\n日本の学校では、…"
result.furigana; // [{ text: 'にほん', base: '日本', block: 0, start: 2, end: 4, ... }, { text: 'がっこう', base: '学校', ... }, ...]
result.blocks[0].segments; // [{ text: 'なぜ' }, { text: '日本', reading: 'にほん' }, { text: 'の' }, ...]

element.innerHTML = toRubyHtml(result); // <ruby>日本<rt>にほん</rt></ruby>の<ruby>学校<rt>がっこう</rt></ruby>…
```

`toRubyHtml` is exported from the package and escapes the text.

Text that is part of the image but not of the content (app buttons, badges, clock in a screenshot) is still
recognized; use `selectRegion: true` to let the user frame only the article.

## Behaviour you can rely on

- **Ready state:** the recognizer starts loading when the app starts. You don't have to wait for it: calls made
  before it is fully loaded simply take a little longer. `isOcrReady()` is for display only.
- **Permissions:** `startLiveRecognition()` asks for the camera permission itself and throws `PERMISSION_DENIED`
  when it is refused. Call `checkPermissions()` / `requestPermissions()` only if you want to ask earlier.
- **Events:** `textRecognized` fires for every analyzed frame (default every 500 ms), also with an empty result
  (`text: ''`, no blocks) when no text is visible, so highlights can be cleared.
- **Capture:** `captureFrame()` freezes the preview on the photo (`getLiveState().frozen` becomes `true`) and pauses
  `textRecognized` events until `resumeLiveRecognition()` or `stopLiveRecognition()`. Calling it again while frozen
  takes a new photo; calling it while a capture is still in progress throws `ALREADY_RUNNING`.
- **Listeners** are independent of start/stop. Remove them with the handle's `remove()` or `removeAllListeners()`.
- **Start twice** throws `ALREADY_RUNNING`; capture/resume/torch without a running camera throw `NOT_RUNNING`.
- **Leaving the app** pauses the camera; it resumes when the app comes back.

## Errors

Every rejected call has a `code` and a `message`. Use `isJapaneseOcrError(e)` to narrow a caught value.

| Code                    | Meaning                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `UNAVAILABLE`           | Not supported on this platform/device (web, iOS, no camera, no flash). |
| `NOT_READY`             | The recognizer failed to load on this device. Retrying won't help. |
| `PERMISSION_DENIED`     | The camera permission was refused.                            |
| `CAMERA_ERROR`          | The camera could not be opened or a photo failed.             |
| `ALREADY_RUNNING`       | Live recognition (or a capture) is already running.           |
| `NOT_RUNNING`           | The call needs a running live recognition.                    |
| `INVALID_ARGUMENT`      | A required option is missing or invalid.                      |
| `RECOGNITION_FAILED`    | The image could not be loaded or recognized.                  |
| `TRANSLATION_NOT_READY` | The translation model is not downloaded. Call `prepareTranslation()`. |
| `TRANSLATION_FAILED`    | Translating failed.                                           |
| `CANCELLED`             | The user closed the photo picker or the selection screen.     |

## API

All methods return Promises. Types are exported from the package.

| Method                                     | Returns                    | Notes                                                    |
| ------------------------------------------ | -------------------------- | -------------------------------------------------------- |
| `isDeviceSupported()`                      | `DeviceSupportResult`      | `{ supported, liveCamera, translation, reason? }`. Never throws. |
| `isOcrReady()`                             | `{ ready }`                | Never throws.                                            |
| `checkPermissions()` / `requestPermissions()` | `{ camera: PermissionState }` |                                                     |
| `startLiveRecognition(options?)`           | `void`                     | `{ lensFacing?: 'back' \| 'front', intervalMs?: number (500), translation?: { enabled, targetLanguage? } }` |
| `stopLiveRecognition()`                    | `void`                     |                                                          |
| `captureFrame(options?)`                   | `CaptureResult`            | `{ saveImage?: boolean }`. With `saveImage`, `imagePath` is a `file://` path; show it with `Capacitor.convertFileSrc()`. |
| `resumeLiveRecognition()`                  | `void`                     |                                                          |
| `getLiveState()`                           | `{ running, frozen, translation }` |                                                  |
| `setTorch({ enabled })`                    | `void`                     |                                                          |
| `setTranslation({ enabled, targetLanguage? })` | `void`                 |                                                          |
| `recognizeImage({ path?, base64?, translation?, selectRegion?, regions? })` | `OcrResult` | `selectRegion: true` lets the user rotate and frame text first; `regions` limits recognition to your own boxes. |
| `recognizeFromGallery({ translation?, selectRegion?, regions? }?)` | `GalleryResult` | `OcrResult` plus `imagePath` (`content://`, or `file://` after rotating). |
| `prepareTranslation({ targetLanguage?, requireWifi? })` | `void`        | Downloads the model if needed.                           |
| `isTranslationReady({ targetLanguage? })`  | `{ ready }`                | Never throws.                                            |
| `findText(result, text)` (function)        | `TextMatch[]`              | Position of a word in a result. Not async.               |
| `isJapaneseOcrError(e)` (function)         | `boolean`                  | Type guard for caught errors.                            |
| `toRubyHtml(resultOrBlock)` (function)     | `string`                   | Escaped HTML with furigana as `<ruby>`. Not async.       |
| `translateText({ text, targetLanguage? })` | `{ text, targetLanguage }` |                                                          |
| `addListener('textRecognized', fn)`        | `PluginListenerHandle`     | `fn(result: OcrResult)` for every live frame.            |
| `addListener('liveRecognitionError', fn)`  | `PluginListenerHandle`     | `fn({ code, message })` when a live frame fails.         |
| `removeAllListeners()`                     | `void`                     |                                                          |

### Result types

```ts
interface OcrResult {
  text: string;              // all text in reading order, paragraphs separated by "\n", no furigana
  translatedText?: string;   // only with translation enabled
  targetLanguage?: string;
  blocks: OcrBlock[];        // paragraphs in reading order
  furigana: OcrFurigana[];   // readings over kanji, not part of text
  vertical: boolean;         // vertical writing detected
  imageWidth: number;        // size of the image that boundingBox refers to
  imageHeight: number;
  regions?: Rect[];          // frames the text was taken from (selectRegion / regions)
  rotation?: number;         // degrees the user rotated the image in the selection screen
}
interface CaptureResult extends OcrResult {
  imagePath?: string;        // with saveImage: true
}

interface OcrBlock extends OcrGeometry {
  text: string; translatedText?: string; recognizedLanguage: string; lines: OcrLine[];
  segments: OcrSegment[];    // text split into pieces; pieces with furigana have a reading
  region?: number;           // index in result.regions
}
interface OcrSegment { text: string; reading?: string } // e.g. { text: '日本', reading: 'にほん' }
interface OcrLine extends OcrGeometry { text: string; confidence: number; recognizedLanguage: string; elements: OcrElement[] }
interface OcrElement extends OcrGeometry { text: string; confidence: number; symbols: OcrSymbol[] }
interface OcrSymbol extends OcrGeometry { text: string; confidence: number } // one character
interface OcrFurigana extends OcrGeometry {
  text: string;              // the reading, e.g. 'にほん'
  base?: string;             // the kanji it belongs to, e.g. '日本'
  block?: number;            // blocks[block].text.slice(start, end) === base
  start?: number;
  end?: number;
}

interface OcrGeometry {
  boundingBox?: Rect;        // pixels of the recognized image
  cornerPoints?: Point[];
  viewBoundingBox?: Rect;    // CSS pixels in the WebView (live and capture only)
  viewCornerPoints?: Point[];
}
interface Rect { left: number; top: number; right: number; bottom: number }
interface Point { x: number; y: number }
```

## Android details

- Added to your manifest automatically: `CAMERA`, `INTERNET` and `ACCESS_NETWORK_STATE` (translation model
  download), and `android.hardware.camera.any` as not required, so devices without camera can still install.
- The Japanese model adds a few MB per CPU architecture to the app.
- Release builds with R8/minify need no extra rules.
- Library versions can be overridden in your app's `android/variables.gradle`: `cameraxVersion`,
  `mlkitTextRecognitionJapaneseVersion`, `mlkitTranslateVersion`.
