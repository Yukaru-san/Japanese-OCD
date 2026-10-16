# JP OCR Test App

Test app for [`capacitor-japanese-ocr`](https://github.com/Yukaru-san/Japanese-OCD/tree/main) (Android).

It shows `isDeviceSupported()` / `isOcrReady()`, runs live recognition with capture/freeze and torch,
recognizes picked images, copies the text, and draws tappable markers over words
from its own glossary (`src/dictionary.ts`, e.g. せかい → „Welt“). The explanations come from the app,
not from ML Kit, which only recognizes the characters.

## Run on Android

```bash
npm install
npm run android   # builds the web app, syncs and starts it on a device/emulator
```

The plugin is installed from the `main` branch on GitHub. To work against a local checkout instead:
`npm install ../Japanese-OCD` (plugin repo next to this one).

## Bridge test

`npm run build && npm run test:bridge` runs the app in Chromium against a simulated Android bridge
(`tests/fake-android.js`, same JSON protocol and result shape as the Java plugin) and once as a plain
web page. It checks the web side (text reaches the app, overlays line up, copy, handwriting,
error codes). It does not run ML Kit or the camera; that needs a real device.
