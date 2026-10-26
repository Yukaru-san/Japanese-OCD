# capacitor-japanese-ocr

Japanese text recognition (OCR) for Capacitor apps, on the device: with Google ML Kit on Android, and with a
built-in PaddleOCR engine in the browser (web, iOS WebView, or on Android when you switch to it).

- **Live camera:** the camera preview runs behind your web page, recognized text arrives as events.
- **Capture:** freeze the picture and get its text, optionally the photo as a file.
- **Gallery & images:** let the user pick a photo from the gallery, or pass an image (file path or base64), and
  optionally let them rotate it and frame the text they want.
- **Handwriting:** the user writes in a drawing area, you get up to 5 candidate words or sentences with their
  probability.
- **Positions:** every block, line and character comes with its position on screen, so you can draw your own
  highlights or buttons over recognized words.

| Platform | Engine                                                                                     |
| -------- | ------------------------------------------------------------------------------------------ |
| Android  | Native ML Kit (Android 7.0 / API 24 or newer). Switchable to the web engine with `setEngine({ engine: 'web' })`. |
| Web, iOS | Web engine (PaddleOCR PP-OCRv6 in WebAssembly), same API and same result format. See [Web engine](#web-engine). |

Requires Capacitor 8.

## Quick start

### 1. Install

If your app already uses Capacitor 8 with Android:

```bash
npm install github:Yukaru-san/Japanese-OCD#main
npm run build           # build your web app
npx cap sync android
```

For a web-only app (browser, no Android), `npm install @capacitor/core@^8 github:Yukaru-san/Japanese-OCD#main` is
enough; the [web engine](#web-engine) is used automatically.

Starting from a plain web app (e.g. Vite, output folder `dist`) for Android, set up Capacitor first:

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

## Examples

Short examples for every method. All of them assume:

```ts
import { Capacitor } from '@capacitor/core';
import { JapaneseOcr, findText, isJapaneseOcrError, toRubyHtml } from 'capacitor-japanese-ocr';
import { characterAt, getCharacters, getSentences } from 'capacitor-japanese-ocr';
```

### Check support and readiness

```ts
const support = await JapaneseOcr.isDeviceSupported(); // never throws
// { supported: true, liveCamera: true, handwriting: true, engine: 'native' }
if (!support.supported) showMessage(support.reason);

const { ready, reason } = await JapaneseOcr.isOcrReady(); // false while the model is still loading; for display only
// reason is set only when loading failed, e.g. 'Japanese text recognizer failed to load: ...'
```

### Camera permission

`startLiveRecognition()` asks by itself. Use these only to ask earlier, e.g. on an onboarding screen:

```ts
const { camera } = await JapaneseOcr.checkPermissions(); // 'granted' | 'denied' | 'prompt' | ...
if (camera !== 'granted') await JapaneseOcr.requestPermissions();
```

### Live camera

```ts
const onText = await JapaneseOcr.addListener('textRecognized', (result) => {
  output.textContent = result.text; // fires for every analyzed frame, '' when no text is visible
});
const onError = await JapaneseOcr.addListener('liveRecognitionError', (e) => console.warn(e.code, e.message));

await JapaneseOcr.startLiveRecognition({ lensFacing: 'back', intervalMs: 300 }); // all optional

await JapaneseOcr.setTorch({ enabled: true });                 // flash on (throws UNAVAILABLE without flash)
await JapaneseOcr.focusAt({ x: event.clientX, y: event.clientY }); // tap to focus
await JapaneseOcr.setZoom({ ratio: 2 });                       // bigger text, e.g. for small furigana
const state = await JapaneseOcr.getLiveState();                // { running, frozen, zoom, minZoom, maxZoom }

const photo = await JapaneseOcr.captureFrame({ saveImage: true }); // freezes the preview
image.src = Capacitor.convertFileSrc(photo.imagePath!);        // the photo, with photo.text recognized in it
await JapaneseOcr.resumeLiveRecognition();                     // unfreeze, events continue

await JapaneseOcr.stopLiveRecognition();
await onText.remove();                                         // or JapaneseOcr.removeAllListeners()
await onError.remove();
```

The camera shows **behind** the page, see [Make the camera visible](#3-make-the-camera-visible).

**Stable results.** `textRecognized` delivers results smoothed over several frames, so the text does not jump
while the camera is held still: a paragraph appears once it was seen in two frames, a different reading of it
(for example furigana read into the line in one frame) only replaces the shown one once it came twice in a row, a
paragraph that is missing for one or two frames stays where it was, and position changes of a few pixels are
ignored. Text the camera sees outside the visible preview is left out. Every block carries a `trackId` that stays
the same while the paragraph is followed, so you can move your markers instead of recreating them (a marker that is
recreated on every frame cannot be tapped reliably). Pass `stabilize: false` for the raw result of every frame;
`LiveStabilizer` is exported if you want to smooth it yourself.

```ts
const markers = new Map<number, HTMLElement>();
await JapaneseOcr.addListener('textRecognized', (result) => {
  const seen = new Set<number>();
  for (const block of result.blocks) {
    if (block.trackId === undefined || !block.viewBoundingBox) continue;
    seen.add(block.trackId);
    const marker = markers.get(block.trackId) ?? createMarker(block.trackId); // your own element
    markers.set(block.trackId, marker);
    placeOver(marker, block.viewBoundingBox);
  }
  for (const [id, marker] of markers) if (!seen.has(id)) (marker.remove(), markers.delete(id));
});
```

Tips for small text such as furigana: hold the camera so the text fills a good part of the picture, or use
`setZoom()`; ML Kit needs roughly 16 pixels per character. Frames are analyzed in Full HD.

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
const marker = document.querySelector<HTMLButtonElement>('#marker')!; // position: fixed; hidden by default
marker.onclick = () => alert('せかい (sekai): Welt'); // your own explanation

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

### Connect your dictionary

Three functions turn a result into what a dictionary needs: single characters with their position in the text and on
screen, the character the user tapped, and whole sentences. They work the same for both engines and for every result
(live events, captures, gallery and images).

```ts
const chars = getCharacters(result); // every character in reading order, spaces left out
chars[0]; // { text: '日', index: 0, block: 0, start: 0, end: 1, line: 0, boundingBox, viewBoundingBox?, furigana: 0, reading: 'にほん' }

// Tap on a word in the camera picture (CSS pixels, like the event's clientX/clientY):
const char = characterAt(result, { x: event.clientX, y: event.clientY });
if (char) {
  const text = result.blocks[char.block].text;
  const entry = dictionary.longestMatch(text.slice(char.start)); // your dictionary: longest word starting here
  showEntry(entry, char.reading); // char.reading: the furigana printed over that word, if any
}

// A tap on an image you show yourself: convert to image pixels and say so.
const scale = result.imageWidth / img.clientWidth;
const r = img.getBoundingClientRect();
characterAt(result, { x: (event.clientX - r.left) * scale, y: (event.clientY - r.top) * scale }, { coordinates: 'image' });

// Look up or translate whole sentences:
for (const sentence of getSentences(result)) {
  sentence.text;            // '日本語を勉強しています。'
  sentence.characters;      // its characters, with readings
  sentence.viewBoundingBox; // where it is on screen
}
```

What to rely on:

- `start`/`end` are UTF-16 indexes into `result.blocks[block].text` (like `String.slice`), the same as
  `furigana[].start`/`end`. Characters outside the BMP (e.g. `𠮟`) are one character with `end - start === 2`.
- `reading` is the furigana of the whole word the character belongs to (`日` and `本` of `日本` both get `にほん`);
  `furigana` is its index in `result.furigana`, whose `start`/`end` give the word's range.
- The text is not split into words: Japanese has no spaces, and where words end depends on your dictionary. Do a
  longest-match lookup from the tapped character, as above. A block's `text` may contain a space between two Japanese
  words when the recognizer saw a gap there; `getCharacters()` leaves spaces out, so join `chars[i].text` for a lookup
  string without them.
- A sentence ends after `。！？…` (closing brackets like `」` stay with it) or at the end of its block. Paragraph
  blocks are cut at a change of text size or a clear gap, so a sentence never spans two blocks.
- Indexes refer to one result. Live results are new objects for every frame; keep the result you looked up together
  with the character.
- A character can lack `boundingBox` when the recognizer reported no box for it; `characterAt` never returns those.

### Recognize a photo from the gallery

```ts
try {
  const result = await JapaneseOcr.recognizeFromGallery(); // opens the system photo picker
  output.textContent = result.text;
  preview.src = Capacitor.convertFileSrc(result.imagePath); // show the chosen photo
} catch (e) {
  if (isJapaneseOcrError(e) && e.code === 'CANCELLED') return; // user closed the picker
  throw e;
}
```

No permission is needed: Android's photo picker only hands over the image the user chose. The camera does not
have to be running. Results have `boundingBox` but no `viewBoundingBox`, since the image is not on screen.

### Recognize an existing image

```ts
const fromFile = await JapaneseOcr.recognizeImage({ path: 'file:///…/photo.jpg' }); // or content://…
const fromData = await JapaneseOcr.recognizeImage({ base64: 'data:image/jpeg;base64,…' }); // prefix optional
```

In the browser (web engine), `path` is a URL the page can fetch; see [Web engine](#web-engine).

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
result.rotation;    // 90, 180 or 270 when the user rotated the image
```

`recognizeImage({ path, selectRegion: true })` works the same for an image you already have. With your own selection
UI, pass the boxes instead: `recognizeImage({ path, regions: [{ left, top, right, bottom }] })` (pixels of the
upright image as the result reports it in `imageWidth`/`imageHeight`; images over 4096 px on a side may be scaled
down first). Cancelling the selection screen rejects with `CANCELLED`. The screen follows the device language
(English, German, Japanese); override the `japanese_ocr_select_*` strings in your app's `strings.xml` to change it.

### Show furigana as ruby

```ts
const result = await JapaneseOcr.recognizeFromGallery();
element.innerHTML = toRubyHtml(result);         // <ruby>日本<rt>にほん</rt></ruby>の…, escaped
element.innerHTML = toRubyHtml(result.blocks[0]); // or a single block
```

See [Text order and furigana](#text-order-and-furigana) for the data behind it.

### Recognize handwriting

Let the user write with a finger or pen and get up to 5 candidates with their probability. Works for single
characters, words and whole sentences. The plugin takes the strokes; the drawing area is yours, e.g. a `<canvas>`:

```ts
import { JapaneseOcr, type InkStroke } from 'capacitor-japanese-ocr';

const canvas = document.querySelector('canvas')!;
const ctx = canvas.getContext('2d')!;
const strokes: InkStroke[] = [];
let timer: number | undefined;

void JapaneseOcr.prepareHandwriting(); // optional: download the model before the first stroke

canvas.style.touchAction = 'none'; // keep the page from scrolling while writing
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  strokes.push({ points: [{ x: e.offsetX, y: e.offsetY, t: Date.now() }] });
  ctx.beginPath();
  ctx.moveTo(e.offsetX, e.offsetY);
});
canvas.addEventListener('pointermove', (e) => {
  if (!canvas.hasPointerCapture(e.pointerId)) return;
  strokes[strokes.length - 1].points.push({ x: e.offsetX, y: e.offsetY, t: Date.now() });
  ctx.lineTo(e.offsetX, e.offsetY);
  ctx.stroke();
});
canvas.addEventListener('pointerup', () => {
  clearTimeout(timer);
  timer = window.setTimeout(recognize, 300); // recognize shortly after each stroke
});

async function recognize(): Promise<void> {
  const result = await JapaneseOcr.recognizeHandwriting({
    strokes,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
  });
  // result.candidates: [{ text: '日本語', probability: 0.82, score: 1.9 }, ...], best first
  list.innerHTML = result.candidates
    .map((c) => `<li>${c.text} ${Math.round(c.probability * 100)} %</li>`)
    .join('');
}
```

- **Model:** the handwriting model (~20 MB) is downloaded on the first `recognizeHandwriting()` and then works
  offline. Call `prepareHandwriting()` earlier (e.g. on the screen with the drawing area) to avoid the wait;
  `isHandwritingReady()` tells whether it is on the device. Without network on first use, the call throws
  `HANDWRITING_NOT_READY`.
- **Sentences:** write horizontally. A sentence may continue on the next row below; rows are recognized one after
  the other and joined. Pass already accepted text as `preContext` to improve the next characters.
- **Probability** is relative to the returned candidates (they add up to 1), so it says how sure the recognizer is
  of the first candidate compared to the others. `score` is the recognizer's raw value (lower is better).
- No strokes returns `{ text: '', candidates: [] }`. Coordinates can be in any unit; `width` and `height` in the
  same unit help to tell small kana (っ, ゃ) from big ones. `maxResults` (1 to 5) limits the candidates.

### Handle errors

```ts
try {
  await JapaneseOcr.startLiveRecognition();
} catch (e) {
  if (!isJapaneseOcrError(e)) throw e;
  if (e.code === 'PERMISSION_DENIED') showMessage('Please allow the camera in the settings.');
  else showMessage(`${e.code}: ${e.message}`);
}
```

All codes are listed under [Errors](#errors).

### Switch the engine

```ts
await JapaneseOcr.setEngine({ engine: 'web' }); // 'auto' (default), 'native' or 'web'
const { engine, active, nativeAvailable } = await JapaneseOcr.getEngine();
```

See [Web engine](#web-engine) for what changes.

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
- **Loading later:** ML Kit sends usage metrics to Google once it runs. To ask the user first, turn off loading at
  start in `capacitor.config.json` (`"plugins": { "JapaneseOcr": { "warmUpOnLoad": false } }`) and call
  `prepareOcr()` after they agreed; any other call loads it as well.
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
- **Saved images** stay in the app's cache (`cache/japanese-ocr/`) until `clearImages()` deletes them, e.g. when the
  user leaves the scan screen.
- **Stopping** gives the WebView its background back (the one it had before the camera started).

## Web engine

In the browser (and in the iOS WebView) the plugin runs its own OCR: PaddleOCR **PP-OCRv6 small** (text detection
and recognition, Apache-2.0) on **ONNX Runtime Web 1.30.0** (WebAssembly). The model weights and the WebAssembly
runtime are bundled in the package, nothing is downloaded from a server at runtime. Results have exactly the same
format as on Android (same fields, same key order, furigana, segments, reading order, `viewBoundingBox` for live
results), so the same app code works on both.

### Switching engines

```ts
await JapaneseOcr.setEngine({ engine: 'web' });    // 'auto' (default), 'native' or 'web'
const { engine, active, nativeAvailable } = await JapaneseOcr.getEngine();
```

- `'auto'` uses the native engine on Android and the web engine everywhere else.
- `'web'` makes the app behave like a plain web page, also on Android: browser camera, browser file picker, no
  native features.
- `'native'` throws `UNAVAILABLE` where there is no native engine (web, iOS).
- Switching stops a running live recognition of the previous engine. Listeners stay registered and keep working.
- `isDeviceSupported()` also returns `engine: 'native' | 'web'`, the engine that answered.

The choice is not stored; call `setEngine()` again after the app starts if you want to keep it.

### Size and loading

- The web engine adds about **25 MB** of JavaScript (about 16.6 MB gzipped): detection model 6.7 MB, recognition
  model 14.2 MB, WebAssembly runtime 4.9 MB, character list 0.1 MB.
- These are separate chunks that bundlers (Vite, webpack, Rollup) load **only when the web engine is used**. On
  Android with the native engine they are never loaded, but they are part of the app's web assets.
- Loading starts with the first call that recognizes text, or with `prepareOcr()` (e.g. after a "Load text
  recognition" button); `isDeviceSupported()` and `isOcrReady()` don't load anything. `isOcrReady()` turns `true` when
  the models are ready (a few seconds), so the first recognition takes a few seconds longer.
- Vite warns that these chunks are larger than 500 kB; that is expected (`build.chunkSizeWarningLimit` silences it).

### How it behaves in the browser

| Feature | Web engine |
| --- | --- |
| Live camera | `getUserMedia`. The video is placed full-screen behind the page (like the native preview); your page needs a transparent background where the camera should show. The plugin sets `background: transparent` on `html` and `body` while live recognition runs (class `japanese-ocr-live` on `<html>`). `lensFacing`, `intervalMs`, `stabilize` and `viewBoundingBox` work as on Android. `setZoom()` works where the browser supports the `zoom` constraint; `focusAt()` has no effect (the browser keeps focusing by itself). |
| Camera permission | The browser's own prompt. `checkPermissions()` uses the Permissions API; `requestPermissions()` opens the camera briefly to ask. Needs HTTPS or `localhost`. |
| Flash | `setTorch()` works where the browser supports the `torch` constraint (Chrome on Android); otherwise `UNAVAILABLE`. |
| Capture | `saveImage: true` returns `imagePath` as a `blob:` URL; use it directly as `<img src>`. |
| Gallery | Opens the browser's file picker. `imagePath` is a `blob:` URL. Cancelling throws `CANCELLED` (in browsers that report it; otherwise when the window gets focus back without a file). |
| `recognizeImage` | `base64`, or `path` as any URL the page can `fetch()` (`https:`, relative, `blob:`, `data:`). `file://` and `content://` paths don't work in the browser. |
| Selection screen | `selectRegion: true` shows the same rotate/frame screen, as HTML. |
| Handwriting | Recognized with the PaddleOCR recognizer, limited to Japanese characters, up to 5 candidates with probabilities. Noticeably less accurate than ML Kit's handwriting model, best with neat, upright characters; `preContext` is ignored. `prepareHandwriting()` only loads the OCR models. |

### Limits

- **Speed:** a 1600 px image takes a few seconds (about 7 s for a full phone screenshot on a desktop browser,
  slower on phones). Live recognition analyzes frames at 960 px and produces fewer results per second than ML Kit.
  When the page is cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`), up to 4 threads are used, which is about twice as fast. The
  Capacitor WebView on Android cannot send these headers, so there it runs single-threaded.
- **Vertical text** is recognized and ordered correctly, but less reliably than horizontal text: small punctuation
  (`、` `。`) can be missed and furigana next to each other may be merged.
- **Text near the image edge** that is cut off may come back as a separate block.
- Confidence values come from PaddleOCR and are not comparable with ML Kit's.

## Errors

Every rejected call has a `code` and a `message`. Use `isJapaneseOcrError(e)` to narrow a caught value.

| Code                    | Meaning                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `UNAVAILABLE`           | Not supported here: no camera, no flash, no WebAssembly, or `setEngine({ engine: 'native' })` without a native engine. |
| `NOT_READY`             | The recognizer failed to load on this device (web: the models could not be loaded). Retrying won't help. |
| `PERMISSION_DENIED`     | The camera permission was refused.                            |
| `CAMERA_ERROR`          | The camera could not be opened or a photo failed.             |
| `ALREADY_RUNNING`       | Live recognition (or a capture) is already running.           |
| `NOT_RUNNING`           | The call needs a running live recognition.                    |
| `INVALID_ARGUMENT`      | A required option is missing or invalid.                      |
| `RECOGNITION_FAILED`    | The image could not be loaded or recognized.                  |
| `CANCELLED`             | The user closed the photo picker or the selection screen.     |
| `HANDWRITING_NOT_READY` | The handwriting model is missing and could not be downloaded (offline?). Web: the OCR models failed to load. |

## API

All methods return Promises. Types are exported from the package.

| Method                                     | Returns                    | Notes                                                    |
| ------------------------------------------ | -------------------------- | -------------------------------------------------------- |
| `setEngine({ engine })`                    | `void`                     | `'auto'`, `'native'` or `'web'`. See [Web engine](#web-engine). |
| `getEngine()`                              | `{ engine, active, nativeAvailable }` | `active` is `'native'` or `'web'`.              |
| `isDeviceSupported()`                      | `DeviceSupportResult`      | `{ supported, liveCamera, handwriting, engine, reason? }`. Never throws. |
| `isOcrReady()`                             | `{ ready, reason? }`       | Never throws. `reason` when loading failed.              |
| `prepareOcr()`                             | `void`                     | Loads the recognizer now, e.g. once the user agreed.     |
| `checkPermissions()` / `requestPermissions()` | `{ camera: PermissionState }` |                                                     |
| `startLiveRecognition(options?)`           | `void`                     | `{ lensFacing?: 'back' \| 'front', intervalMs?: number (300), stabilize?: boolean (true) }` |
| `stopLiveRecognition()`                    | `void`                     |                                                          |
| `captureFrame(options?)`                   | `CaptureResult`            | `{ saveImage?: boolean }`. With `saveImage`, `imagePath` is a `file://` path; show it with `Capacitor.convertFileSrc()` (web engine: a `blob:` URL). |
| `resumeLiveRecognition()`                  | `void`                     |                                                          |
| `getLiveState()`                           | `{ running, frozen, zoom?, minZoom?, maxZoom? }` |                                    |
| `setTorch({ enabled })`                    | `void`                     |                                                          |
| `focusAt({ x, y })`                        | `void`                     | CSS pixels in the WebView. Back to autofocus after 5 s. `UNAVAILABLE` if the camera cannot focus on a point. |
| `setZoom({ ratio })`                       | `void`                     | Clamped to `minZoom`…`maxZoom`. `UNAVAILABLE` if the camera cannot zoom. |
| `recognizeImage({ path?, base64?, selectRegion?, regions? })` | `OcrResult` | `selectRegion: true` lets the user rotate and frame text first; `regions` limits recognition to your own boxes. |
| `recognizeFromGallery({ selectRegion?, regions? }?)` | `GalleryResult` | `OcrResult` plus `imagePath` (`content://`, or `file://` after rotating; web engine: `blob:`). |
| `clearImages()`                            | `void`                     | Deletes the saved images (`saveImage`, rotated gallery images); web: revokes their `blob:` URLs. |
| `recognizeHandwriting({ strokes, width?, height?, preContext?, maxResults? })` | `{ text, candidates }` | `strokes: { points: { x, y, t? }[] }[]`; up to 5 `{ text, probability, score }`, best first. |
| `prepareHandwriting({ requireWifi? })`     | `void`                     | Downloads the handwriting model if needed.               |
| `isHandwritingReady()`                     | `{ ready }`                | Never throws.                                            |
| `findText(result, text)` (function)        | `TextMatch[]`              | Position of a word in a result. Not async.               |
| `isJapaneseOcrError(e)` (function)         | `boolean`                  | Type guard for caught errors.                            |
| `toRubyHtml(resultOrBlock)` (function)     | `string`                   | Escaped HTML with furigana as `<ruby>`. Not async.       |
| `getCharacters(result)` (function)         | `OcrCharacter[]`           | Every character with block, `start`/`end`, boxes and `reading`. See [Connect your dictionary](#connect-your-dictionary). |
| `characterAt(result, { x, y }, { coordinates? }?)` (function) | `OcrCharacter \| undefined` | The character at a tap; `coordinates: 'view'` (default on live results) or `'image'`. |
| `getSentences(result)` (function)          | `OcrSentence[]`            | `{ text, block, start, end, characters, boundingBox?, viewBoundingBox? }`. |
| `addListener('textRecognized', fn)`        | `PluginListenerHandle`     | `fn(result: OcrResult)` for every live frame, smoothed (see [Stable results](#live-camera)). |
| `addListener('liveRecognitionError', fn)`  | `PluginListenerHandle`     | `fn({ code, message })` when a live frame fails.         |
| `removeAllListeners()`                     | `void`                     |                                                          |

### Result types

```ts
interface OcrResult {
  text: string;              // all text in reading order, paragraphs separated by "\n", no furigana
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
  text: string; recognizedLanguage: string; lines: OcrLine[];
  segments: OcrSegment[];    // text split into pieces; pieces with furigana have a reading
  region?: number;           // index in result.regions
  trackId?: number;          // live only: same paragraph across frames
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

// From getCharacters() / characterAt() / getSentences():
interface OcrCharacter {
  text: string; index: number; // index in getCharacters(result)
  block: number; start: number; end: number; // blocks[block].text.slice(start, end) === text
  line?: number; boundingBox?: Rect; viewBoundingBox?: Rect;
  furigana?: number; reading?: string; // the furigana over the word this character belongs to
}
interface OcrSentence {
  text: string; block: number; start: number; end: number;
  characters: OcrCharacter[]; boundingBox?: Rect; viewBoundingBox?: Rect;
}
```

## Android details

- Added to your manifest automatically: `CAMERA`, `INTERNET` and `ACCESS_NETWORK_STATE` (handwriting
  model download), and `android.hardware.camera.any` as not required, so devices without camera can still install.
- The Japanese model adds a few MB per CPU architecture to the app.
- Release builds with R8/minify need no extra rules.
- Library versions can be overridden in your app's `android/variables.gradle`: `cameraxVersion`,
  `mlkitTextRecognitionJapaneseVersion`, `mlkitDigitalInkVersion`.

### Devices without Google Play Services

Text recognition needs neither Google Play Services nor internet: the ML Kit model and its native library are
inside your APK, so it works on GrapheneOS (with or without sandboxed Google Play), LineageOS without GApps,
Huawei devices and with the app's network access turned off. `isDeviceSupported()` does not check for Play
Services.

Handwriting is the exception: its model (~20 MB) is not in the APK and is downloaded from Google once. It needs
internet for that one download, but no Play Services. Offline and without the model, `prepareHandwriting()` and
`recognizeHandwriting()` throw `HANDWRITING_NOT_READY` at once (they don't wait for a network), and
`isHandwritingReady()` returns `false`. Once downloaded it works offline.

## Web engine details

- Models: [PP-OCRv6_small_det](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx) and
  [PP-OCRv6_small_rec](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx) (Apache-2.0), stored in
  `web-models/` with their weights as float16 to halve the size (they are converted back to float32 when loaded; the
  recognized text matched the original weights in our tests). See [web-models/README.md](web-models/README.md).
- Runtime: ONNX Runtime Web 1.30.0 (MIT), WebAssembly backend, copied into the package at build time; your app does
  not install `onnxruntime-web`. The `.wasm` file is embedded in the JavaScript, so no bundler or server
  configuration is needed.
- For contributors: the plugin's own `npm run build` turns the models into the JavaScript chunks in
  `dist/esm/web/assets/`.

## How it works

This part is for people who want to read or change the plugin. Every method call takes the same way:

```
your app:  JapaneseOcr.recognizeImage({ ... })
               │
               ▼
src/engine-switch.ts        picks the active engine ('auto' | 'native' | 'web')
     │                                   │
     ▼ Android                           ▼ web, iOS, or setEngine({ engine: 'web' })
Capacitor bridge (JSON)             src/web.ts   (loaded on first use)
     │                                   │
     ▼                                   ▼
JapaneseOcrPlugin.java              src/web/*.ts
ML Kit, CameraX, Android UI         PaddleOCR on ONNX Runtime Web, getUserMedia, HTML UI
     │                                   │
     └──────────► the same OcrResult JSON ◄┘
```

### Files

`android/.../` stands for `android/src/main/java/com/yukarusan/japaneseocr/`.

| File | What happens there |
| --- | --- |
| `src/index.ts` | Package entry: creates `JapaneseOcr`, exports the types, `findText`, `toRubyHtml`, `isJapaneseOcrError`. |
| `src/definitions.ts`, `src/handwriting.ts` | The public API: method signatures, options, result types, error codes. |
| `src/engine-switch.ts` | Builds the `JapaneseOcr` object. Forwards each method to the native plugin or to the web engine, registers listeners with both, implements `setEngine` / `getEngine`. |
| `src/find-text.ts`, `src/ruby.ts`, `src/text-index.ts` | Plain helpers on a result: find a word and its box; render furigana as `<ruby>`; characters, tap lookup and sentences for dictionaries (unit tests in `tests/`, `npm test`). |
| `android/.../JapaneseOcrPlugin.java` | Android entry point. One `@PluginMethod` per API method: checks options, starts the work, resolves or rejects the call with an error code. |
| `android/.../OcrEngine.java` | Wraps the ML Kit Japanese recognizer (with a warm-up at app start) and builds the result JSON. |
| `android/.../ReadingOrder.java` | Reading order, paragraphs, furigana detection and pairing, regions. Plain Java, unit tested. |
| `android/.../LiveCameraController.java` | CameraX: preview behind the WebView, Full HD frame analysis at the interval, freeze and full-resolution capture, torch, zoom, tap to focus. |
| `src/live-stabilizer.ts` | Smooths live results over frames (follows paragraphs, hysteresis for new readings, dead band), `trackId`. Tests: `npm test`. |
| `android/.../ViewMapper.java` | Converts camera image pixels to CSS pixels of the WebView (`viewBoundingBox`). |
| `android/.../RegionSelector.java` | The full-screen rotate-and-frame dialog (`selectRegion: true`). Texts in `res/values*/strings.xml`. |
| `android/.../ImageFiles.java` | Paths, base64, decoding photos upright (EXIF) and at most 4096 px, saving JPEGs to the cache. |
| `android/.../HandwritingEngine.java`, `InkLines.java` | ML Kit Digital Ink; `InkLines` splits strokes into rows and combines the rows' candidates (plain Java, unit tested). |
| `src/web.ts` | The web engine (`JapaneseOcrWeb`): the same methods and error codes as the Java plugin, built on the modules below. |
| `src/web/paddle.ts` | Loads the bundled models and runs them: text detection, line recognition, CTC decoding, candidates. |
| `src/web/result.ts` | Turns PaddleOCR lines into the same `OcrResult` as Android (same fields and key order). |
| `src/web/reading-order.ts` | Line-by-line TypeScript port of `ReadingOrder.java`. Keep both in sync. |
| `src/web/geometry.ts` | Convex hull and minimum-area rectangle for the detector's boxes. |
| `src/web/image.ts`, `live.ts`, `region-selector.ts`, `handwriting.ts` | Browser versions of image loading, live camera, the selection screen and handwriting. |
| `web-models/`, `scripts/` | The ONNX models and their character list; build scripts (see [Building](#building-and-testing)). |

### Between JavaScript and Android

Capacitor sends the call's options as JSON to the Java method with the same name (`PluginCall`). The Java
side answers with `call.resolve(JSObject)`, which resolves the Promise in JS, or `call.reject(message, code)`,
which rejects it with an error whose `code` is one of the [error codes](#errors). Live results don't belong to a
call: Java sends them with `notifyListeners('textRecognized', result)` (and `liveRecognitionError`), which
reaches every `addListener` callback. Images travel as paths (`file://`, `content://`) or base64, results as JSON.

### Android: what happens on each call

- **App start:** `load()` creates the ML Kit recognizer and runs a blank 64×64 image through it, so the model is
  loaded before the first real call (`isOcrReady()` turns `true`).
- **Live recognition:** after the permission check, `LiveCameraController` puts a CameraX
  `PreviewView` behind the WebView, makes the WebView transparent and sets the `japanese-ocr-live` class on the
  page. Frames (about 1280×720) go to ML Kit at most every `intervalMs`; a frame is skipped while the previous
  one is still being processed. Each result is put in reading order, converted to JSON
  with `ViewMapper` positions and sent as `textRecognized`.
- **Capture:** the current preview picture is shown frozen on top of the preview, a full-resolution photo is
  taken, turned upright, optionally saved to `cache/japanese-ocr/`, recognized and returned. Frames are not
  analyzed until `resumeLiveRecognition()`.
- **Still images:** `recognizeFromGallery` opens the system photo picker; `recognizeImage` opens a path or decodes
  base64. On a worker thread the image is decoded; with `selectRegion` the `RegionSelector` dialog returns the
  rotated image and the frames. Then the same recognition path as capture runs, limited to the regions.
- **Handwriting:** strokes are grouped into rows written one below the other (`InkLines.rows`; flat rows such as
  the bars of 三 stay with their characters). Each row is recognized by ML Kit with the text so far as context; the
  rows' candidates are combined, best combinations first, and their scores turned into probabilities (softmax).

### Web engine: what happens on each call

- **Loading:** the first call imports `src/web.ts`; `paddle.ts` then imports the models and the WebAssembly runtime
  (JavaScript chunks generated at build time), creates two ONNX sessions and runs a warm-up image.
- **Recognition:** the image is scaled to at most 1600 px (960 px for live frames). The detection model returns a
  text probability map; every connected area becomes a rotated box. Each box is cut out along its reading
  direction (vertical columns are turned), scaled to 48 px height and read by the recognition model; CTC decoding
  gives the text and where each character lies. Lines read with less than 50 % confidence are dropped.
- **Result:** `result.ts` groups the characters into words, runs the reading order port and writes the same JSON
  as `OcrEngine.java`.
- **Live camera:** a `<video>` from `getUserMedia` fills the window behind the page; a frame is copied to a canvas
  at each interval. `viewMapper()` converts camera pixels to page pixels for the `object-fit: cover` video.
- **Handwriting:** each row of strokes is drawn black on white and read with the recognizer as a single line,
  restricted to Japanese characters, with up to `maxResults` alternatives from a CTC beam search; rows are
  combined like on Android.

### Reading order and furigana

`ReadingOrder.java` (and its port `reading-order.ts`) works on boxes only:

1. **Direction:** the text is vertical when more lines are tall than wide.
2. **Furigana:** a line of kana only is furigana when it is clearly thinner than the typical line (below 0.7 of
   it), or thinner than the kanji line it sits on (below 0.8 of it, for headings with big furigana).
3. **Order:** the other lines are sorted into rows top to bottom and left to right (vertical: columns right to
   left, top to bottom).
4. **Pairing:** each furigana line is split into one reading per word, and each reading is paired with the
   nearest line below it (left of it in vertical text) and the kanji under its extent.
5. **Paragraphs:** consecutive lines form a paragraph until the text size changes (more than 1.3×), the gap grows
   (more than 1.5 lines) or the lines stop overlapping. With `regions`, only characters whose center lies in a
   region are kept, region by region.
6. **Positions:** each reading's kanji are located in the paragraph text (`block`, `start`, `end`), which gives
   the block's `segments`.

### Building and testing

- `npm run build`: `tsc` compiles `src/` to `dist/esm/`; `scripts/embed-assets.mjs` writes the models, the
  character list and ONNX Runtime Web into `dist/esm/web/assets/` as JavaScript modules; Rollup builds
  `dist/plugin.js` (one file for `<script>` tags) and `dist/plugin.cjs.js` (CommonJS, web engine in `dist/cjs/`).
  The Java sources are not compiled here; they ship as source and are built by the app's Gradle build.
- `npm run lint` / `npm run fmt`: ESLint and Prettier (also for Java).
- `cd android && ./gradlew test`: unit tests for `ReadingOrder` and `InkLines`; `./gradlew build lint` compiles
  and checks the Android library. Both need the Android SDK and `npm install` (for `@capacitor/android`).
- The models in `web-models/` are converted with `scripts/fp16-weights.py`; see
  [web-models/README.md](web-models/README.md).
- The test app on the [`test-app` branch](https://github.com/Yukaru-san/Japanese-OCD/tree/test-app) shows every
  feature on a device and has browser tests against a simulated Android bridge.
