# capacitor-japanese-ocr

Japanese text recognition (OCR) for Capacitor apps, on the device, with Google ML Kit.

- **Live camera:** the camera preview runs behind your web page, recognized text arrives as events.
- **Capture:** freeze the picture and get its text, optionally the photo as a file.
- **Images:** recognize text in an existing image (file path or base64).
- **Translation (optional):** Japanese → another language, on the device, switchable at any time.
- **Positions:** every block, line and character comes with its position on screen, so you can draw your own
  highlights or buttons over recognized words.

| Platform | Support                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------- |
| Android  | Yes, Android 7.0 (API 24) or newer                                                              |
| Web, iOS | No. `isDeviceSupported()` returns `supported: false`, all other calls throw `UNAVAILABLE` |

Requires Capacitor 8.

## Quick start

### 1. Install

```bash
npm install github:Yukaru-san/Japanese-OCD#main
npx cap add android     # only if your app has no android/ folder yet
npm run build           # build your web app
npx cap sync android
```

That is all the native setup. The plugin adds the camera permission to your Android manifest by itself, and the
Japanese model is bundled with the app (no download, no Google Play Services needed).

### 2. Use it

```ts
import { JapaneseOcr, isJapaneseOcrError } from 'capacitor-japanese-ocr';

// 1. Check support once. This never throws.
const support = await JapaneseOcr.isDeviceSupported();
if (!support.supported) {
  showMessage(support.reason ?? 'Japanese OCR is not supported here.');
  return;
}

// 2. Listen for results. Register before starting; listeners stay until you remove them.
await JapaneseOcr.addListener('textRecognized', (result) => {
  textElement.textContent = result.text;
});

// 3. Start the camera. Asks for the camera permission the first time.
try {
  await JapaneseOcr.startLiveRecognition();
} catch (e) {
  if (isJapaneseOcrError(e) && e.code === 'PERMISSION_DENIED') {
    showMessage('Please allow the camera.');
  }
}

// 4. Freeze the picture and get its text. The preview stays frozen until resume or stop.
const capture = await JapaneseOcr.captureFrame();
console.log(capture.text);

// 5. Continue or stop.
await JapaneseOcr.resumeLiveRecognition();
await JapaneseOcr.stopLiveRecognition();
```

### 3. Make the camera visible

The camera preview is drawn **behind** the web page. While live recognition runs, the plugin makes the WebView,
`<html>` and `<body>` transparent and adds the class `japanese-ocr-live` to `<html>`; it undoes both on stop.

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

```ts
import { Clipboard } from '@capacitor/clipboard';

const { text } = await JapaneseOcr.captureFrame();
await Clipboard.write({ string: text });
```

### Draw over recognized words

Live and capture results carry `viewBoundingBox` (CSS pixels, relative to the WebView) on every block, line,
element and character (`symbols`). Position elements with `position: fixed` at those values:

```ts
JapaneseOcr.addListener('textRecognized', (result) => {
  for (const block of result.blocks) {
    for (const line of block.lines) {
      for (const element of line.elements) {
        for (const symbol of element.symbols) {
          const box = symbol.viewBoundingBox; // { left, top, right, bottom }
          // e.g. place a marker at box.left / box.top with width box.right - box.left
        }
      }
    }
  }
});
```

To mark a word like `せかい`, join the `symbols` of a line, find the word in that string and combine the boxes of
its characters.

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

### Recognize an existing image

```ts
const result = await JapaneseOcr.recognizeImage({ path: 'file:///…/photo.jpg' }); // or content://…
const result2 = await JapaneseOcr.recognizeImage({ base64: 'data:image/jpeg;base64,…' });
```

## Behaviour you can rely on

- **Ready state:** the recognizer starts loading when the app starts. You don't have to wait for it: calls made
  before it is fully loaded simply take a little longer. `isOcrReady()` is for display only.
- **Permissions:** `startLiveRecognition()` asks for the camera permission itself and throws `PERMISSION_DENIED`
  when it is refused. Call `checkPermissions()` / `requestPermissions()` only if you want to ask earlier.
- **Capture:** `captureFrame()` freezes the preview on the photo and pauses `textRecognized` events until
  `resumeLiveRecognition()` or `stopLiveRecognition()`. Calling it again while frozen takes a new photo.
- **Listeners** are independent of start/stop. Remove them with the handle's `remove()` or `removeAllListeners()`.
- **Start twice** throws `ALREADY_RUNNING`; capture/resume/torch without a running camera throw `NOT_RUNNING`.
- **Leaving the app** pauses the camera; it resumes when the app comes back.

## Errors

Every rejected call has a `code` and a `message`. Use `isJapaneseOcrError(e)` to narrow a caught value.

| Code                    | Meaning                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `UNAVAILABLE`           | Not supported on this platform/device (web, iOS, no camera, no flash). |
| `NOT_READY`             | The recognizer failed to load.                                |
| `PERMISSION_DENIED`     | The camera permission was refused.                            |
| `CAMERA_ERROR`          | The camera could not be opened or a photo failed.             |
| `ALREADY_RUNNING`       | Live recognition (or a capture) is already running.           |
| `NOT_RUNNING`           | The call needs a running live recognition.                    |
| `INVALID_ARGUMENT`      | A required option is missing or invalid.                      |
| `RECOGNITION_FAILED`    | The image could not be loaded or recognized.                  |
| `TRANSLATION_NOT_READY` | The translation model is not downloaded. Call `prepareTranslation()`. |
| `TRANSLATION_FAILED`    | Translating failed.                                           |

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
| `recognizeImage({ path?, base64?, translation? })` | `OcrResult`        |                                                          |
| `prepareTranslation({ targetLanguage?, requireWifi? })` | `void`        | Downloads the model if needed.                           |
| `isTranslationReady({ targetLanguage? })`  | `{ ready }`                | Never throws.                                            |
| `translateText({ text, targetLanguage? })` | `{ text, targetLanguage }` |                                                          |
| `addListener('textRecognized', fn)`        | `PluginListenerHandle`     | `fn(result: OcrResult)` for every live frame.            |
| `addListener('liveRecognitionError', fn)`  | `PluginListenerHandle`     | `fn({ code, message })` when a live frame fails.         |
| `removeAllListeners()`                     | `void`                     |                                                          |

### Result types

```ts
interface OcrResult {
  text: string;              // all text, blocks separated by "\n"
  translatedText?: string;   // only with translation enabled
  targetLanguage?: string;
  blocks: OcrBlock[];
  imageWidth: number;        // size of the image that boundingBox refers to
  imageHeight: number;
}
interface CaptureResult extends OcrResult {
  imagePath?: string;        // with saveImage: true
}

interface OcrBlock extends OcrGeometry { text: string; translatedText?: string; recognizedLanguage: string; lines: OcrLine[] }
interface OcrLine extends OcrGeometry { text: string; confidence: number; recognizedLanguage: string; elements: OcrElement[] }
interface OcrElement extends OcrGeometry { text: string; confidence: number; symbols: OcrSymbol[] }
interface OcrSymbol extends OcrGeometry { text: string; confidence: number } // one character

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
