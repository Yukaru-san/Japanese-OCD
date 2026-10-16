# JP OCR Test App

Test app for [`capacitor-japanese-ocr`](https://github.com/Yukaru-san/Japanese-OCD/tree/claude/project-thread-5sqnyx)
in its Play Services variant: the Japanese ML Kit model is not in the APK but downloaded by Google Play Services. It is a plain
Vite + TypeScript page wrapped in a Capacitor Android app and uses every feature of the plugin, so it can be tried
on a phone and tested in a browser:

- **Engine:** switch between the native engine (ML Kit) and the web engine (PaddleOCR in the WebView).
- **Status:** `isDeviceSupported()`, `isOcrReady()`, the OCR model from Google Play Services (state, download
  progress, "OCR-Modell laden" calls `prepareOcr()`), camera permission and the handwriting model.
- **Live camera:** text of the current picture, freeze/resume, torch, and tappable markers over words from the
  app's own glossary (e.g. せかい → „Welt“).
- **Images:** gallery or file, optionally framed by the user first; text, furigana as ruby, glossary words, photo.
- **Handwriting:** a drawing area with up to 5 candidates and their probability.
- **Result:** copy the text, raw JSON, and a log of every plugin call.

The glossary explanations come from the app (`src/dictionary.ts`), not from the plugin: ML Kit and PaddleOCR only
recognize the characters.

## Run it

```bash
npm install
npm run android   # builds the web app, syncs it into android/ and starts it on a device or emulator
npm start         # or: the same page in the browser (web engine only)
```

Other scripts: `npm run build` (type check + Vite build to `dist/`), `npm run sync` (build + `cap sync android`).
A debug APK is built with `cd android && ./gradlew assembleDebug` after `npm run sync`
(`android/app/build/outputs/apk/debug/app-debug.apk`).

The APK contains native code for `arm64-v8a` only (`abiFilters` in `android/app/build.gradle`), which every
current phone uses; x86 emulators and old 32-bit phones can't install it. Remove the filter to build for all
architectures (about 50 MB larger).

The plugin is installed from the `main` branch on GitHub. To try a local checkout of the plugin instead:
`npm install ../Japanese-OCD` (plugin repo next to this one), then `npm run sync` again.

## What happens where

| File | What happens there |
| --- | --- |
| `index.html` | The page: one `<section>` per feature, plus the live overlay (`#live-overlay`) and the glossary marker layer (`#word-layer`, `#word-popup`) that lie on top of the camera picture. |
| `src/main.ts` | Entry point. Starts the sections in order: engine choice first, then the live event listeners, the buttons, and the first status refresh. |
| `src/ui.ts` | Shared helpers: `$` (element by id), `log` (log panel), `run` (calls the plugin, logs ok or the error code, never throws). |
| `src/status.ts` | "Engine" and "Status" sections. The engine choice is stored in `localStorage` and applied with `setEngine()` at start, since the plugin does not store it. |
| `src/live.ts` | Live camera: start/stop, capture/resume, torch, and the `textRecognized` / `liveRecognitionError` listeners. |
| `src/overlay.ts` | Finds glossary words in a result (`findWords`) and draws a tappable marker at each word's `viewBoundingBox`; tapping shows the explanation. |
| `src/dictionary.ts` | The app's glossary: reading, meaning and a note per word. |
| `src/images.ts` | "Bild erkennen": `recognizeFromGallery()`, or a file read as base64 for `recognizeImage()`; both with `selectRegion` when the checkbox is on. |
| `src/result.ts` | "Ergebnis": shows a result (text, `toRubyHtml`, furigana list, glossary words, photo, JSON), copy via `@capacitor/clipboard`. |
| `src/ink.ts`, `src/ink-pad.ts` | "Handschrift": `InkPad` collects the strokes on a `<canvas>`; `ink.ts` calls `recognizeHandwriting()` 300 ms after each stroke and lists the candidates. |
| `src/style.css` | Layout. `body.live` hides the panels and makes the page transparent while the camera runs. |
| `android/` | The Capacitor Android project (`MainActivity` is the default `BridgeActivity`). The plugin is linked in by `npx cap sync`. |
| `tests/` | Browser tests, see below. |

### How a live result reaches the screen

1. "Live starten" calls `startLiveRecognition()` (`src/live.ts`). The plugin opens the camera **behind** the
   WebView; `setLive(true)` adds `body.live`, so the page is transparent and only the overlay is visible.
2. For every analyzed frame the plugin fires `textRecognized` with an `OcrResult`. The listener shows `text` in
   the overlay and passes the result to `WordOverlay.render()`.
3. `findWords()` (`src/overlay.ts`) looks for glossary words character by character in each line and joins the
   characters' `viewBoundingBox` (CSS pixels of the WebView). A `position: fixed` button at that box sits exactly on
   the word in the camera picture.
4. "Festhalten" calls `captureFrame({ saveImage: true })`: the picture freezes, the result is shown in the overlay
   and in the result section, including the saved photo.

Gallery and file results take the same way into `showResult()` (`src/result.ts`), but have no
`viewBoundingBox`, since the image is not on screen, so no markers are drawn for them.

## Bridge test

```bash
npm run build && npm run test:bridge
```

`tests/bridge-test.mjs` serves `dist/` and opens it twice in headless Chromium (Playwright):

- **Android, simulated:** `tests/fake-android.js` is injected before the app loads. It plays the Android side of
  Capacitor: it answers the plugin calls through the same JSON bridge protocol (`androidBridge.postMessage` →
  `Capacitor.fromNative`) with data in the exact shape the Java plugin builds, sends `textRecognized` events for
  a fake camera picture with two lines of text, and paints that picture behind the transparent page. The test
  clicks through the app like a user and checks what it shows: live text, marker positions, explanations,
  capture/resume, restart after stop, clipboard, gallery, furigana and ruby, handwriting candidates, error codes and
  engine switching.
- **Plain web page:** no fake bridge, so the plugin's real web engine answers (no camera in headless Chromium).

Screenshots go to `tests/screenshots/`. The test does not run ML Kit or a real camera; that needs a device.
