# capacitor-japanese-ocr

Japanese OCR for Capacitor, built on the on-device Google ML Kit Japanese text recognizer, with optional on-device translation (ML Kit Translation).

- Live camera recognition with the preview behind the WebView, results as `textRecognized` events
- Capture: freeze the preview on a full-resolution photo and get its text (optionally the JPEG)
- Recognize existing images (path, `content://` or base64)
- Translation Japanese → target language (default `en`), toggleable at any time
- `isDeviceSupported()` and `isOcrReady()` never throw; every other call rejects with an error `code` when the platform cannot do it

Platform: Android (API 24+). On web and iOS `isDeviceSupported()` returns `supported: false` and all other calls reject with `UNAVAILABLE`.

## Install

The package is not on npm. Install it from GitHub; the `prepare` script builds it:

```bash
npm install github:Yukaru-san/Japanese-OCD#main
npx cap sync android
```

## Usage

```ts
import { JapaneseOcr } from 'capacitor-japanese-ocr';

const { supported, reason } = await JapaneseOcr.isDeviceSupported();
if (!supported) throw new Error(reason);

// The camera preview is drawn behind the WebView: make the page background transparent while live.
document.body.style.background = 'transparent';

await JapaneseOcr.addListener('textRecognized', (result) => {
  console.log(result.text, result.translatedText);
});

// Optional translation: download the model once, then enable it.
await JapaneseOcr.prepareTranslation({ targetLanguage: 'de' });
await JapaneseOcr.startLiveRecognition({ translation: { enabled: true, targetLanguage: 'de' } });

const capture = await JapaneseOcr.captureFrame({ saveImage: true }); // preview freezes
await navigator.clipboard.writeText(capture.text);
await JapaneseOcr.resumeLiveRecognition();

await JapaneseOcr.stopLiveRecognition();
```

Errors are `CapacitorException`s; check `error.code` against `JapaneseOcrErrorCode`
(`UNAVAILABLE`, `NOT_READY`, `PERMISSION_DENIED`, `CAMERA_ERROR`, `ALREADY_RUNNING`, `NOT_RUNNING`,
`INVALID_ARGUMENT`, `RECOGNITION_FAILED`, `TRANSLATION_NOT_READY`, `TRANSLATION_FAILED`).

### Android notes

- The Japanese recognition model is bundled into the app (adds a few MB per ABI); no download, no Play Services needed.
- Translation models (~30 MB per language) are downloaded on demand by `prepareTranslation()`.
- Versions can be overridden in the app's `variables.gradle`: `cameraxVersion`, `mlkitTextRecognitionJapaneseVersion`, `mlkitTranslateVersion`.
- Bounding boxes refer to the upright image (`imageWidth` × `imageHeight`), not to screen pixels.

## API

<docgen-index>

* [`isDeviceSupported()`](#isdevicesupported)
* [`isOcrReady()`](#isocrready)
* [`checkPermissions()`](#checkpermissions)
* [`requestPermissions()`](#requestpermissions)
* [`startLiveRecognition(...)`](#startliverecognition)
* [`stopLiveRecognition()`](#stopliverecognition)
* [`captureFrame(...)`](#captureframe)
* [`resumeLiveRecognition()`](#resumeliverecognition)
* [`getLiveState()`](#getlivestate)
* [`setTorch(...)`](#settorch)
* [`setTranslation(...)`](#settranslation)
* [`recognizeImage(...)`](#recognizeimage)
* [`prepareTranslation(...)`](#preparetranslation)
* [`isTranslationReady(...)`](#istranslationready)
* [`translateText(...)`](#translatetext)
* [`addListener('textRecognized', ...)`](#addlistenertextrecognized-)
* [`addListener('liveRecognitionError', ...)`](#addlistenerliverecognitionerror-)
* [`removeAllListeners()`](#removealllisteners)
* [Interfaces](#interfaces)
* [Type Aliases](#type-aliases)

</docgen-index>

<docgen-api>
<!--Update the source file JSDoc comments and rerun docgen to update the docs below-->

### isDeviceSupported()

```typescript
isDeviceSupported() => any
```

Checks whether Japanese OCR is supported. Never throws.

**Returns:** <code>any</code>

--------------------


### isOcrReady()

```typescript
isOcrReady() => any
```

Checks whether the Japanese recognizer is loaded. Never throws.

**Returns:** <code>any</code>

--------------------


### checkPermissions()

```typescript
checkPermissions() => any
```

**Returns:** <code>any</code>

--------------------


### requestPermissions()

```typescript
requestPermissions() => any
```

**Returns:** <code>any</code>

--------------------


### startLiveRecognition(...)

```typescript
startLiveRecognition(options?: LiveRecognitionOptions | undefined) => any
```

Opens the camera and starts recognizing Japanese text.

The preview is placed behind the WebView, so the page must have a
transparent background where the camera should be visible.
Results are delivered through the `textRecognized` event.
Asks for the camera permission if needed.

| Param         | Type                                                                      |
| ------------- | ------------------------------------------------------------------------- |
| **`options`** | <code><a href="#liverecognitionoptions">LiveRecognitionOptions</a></code> |

**Returns:** <code>any</code>

--------------------


### stopLiveRecognition()

```typescript
stopLiveRecognition() => any
```

Stops live recognition and closes the camera.

**Returns:** <code>any</code>

--------------------


### captureFrame(...)

```typescript
captureFrame(options?: CaptureOptions | undefined) => any
```

Takes a full-resolution photo, freezes the preview on it and returns the recognized text.
Live events pause until `resumeLiveRecognition()` is called.

| Param         | Type                                                      |
| ------------- | --------------------------------------------------------- |
| **`options`** | <code><a href="#captureoptions">CaptureOptions</a></code> |

**Returns:** <code>any</code>

--------------------


### resumeLiveRecognition()

```typescript
resumeLiveRecognition() => any
```

Unfreezes the preview after `captureFrame()` and resumes live recognition.

**Returns:** <code>any</code>

--------------------


### getLiveState()

```typescript
getLiveState() => any
```

**Returns:** <code>any</code>

--------------------


### setTorch(...)

```typescript
setTorch(options: { enabled: boolean; }) => any
```

Switches the flashlight while live recognition runs.

| Param         | Type                               |
| ------------- | ---------------------------------- |
| **`options`** | <code>{ enabled: boolean; }</code> |

**Returns:** <code>any</code>

--------------------


### setTranslation(...)

```typescript
setTranslation(options: TranslationOptions) => any
```

Turns translation of live results on or off, or changes the target language.

| Param         | Type                                                              |
| ------------- | ----------------------------------------------------------------- |
| **`options`** | <code><a href="#translationoptions">TranslationOptions</a></code> |

**Returns:** <code>any</code>

--------------------


### recognizeImage(...)

```typescript
recognizeImage(options: RecognizeImageOptions) => any
```

Recognizes Japanese text in an existing image.

| Param         | Type                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| **`options`** | <code><a href="#recognizeimageoptions">RecognizeImageOptions</a></code> |

**Returns:** <code>any</code>

--------------------


### prepareTranslation(...)

```typescript
prepareTranslation(options?: PrepareTranslationOptions | undefined) => any
```

Downloads the Japanese → target language model, if not on the device yet.

| Param         | Type                                                                            |
| ------------- | ------------------------------------------------------------------------------- |
| **`options`** | <code><a href="#preparetranslationoptions">PrepareTranslationOptions</a></code> |

**Returns:** <code>any</code>

--------------------


### isTranslationReady(...)

```typescript
isTranslationReady(options?: { targetLanguage?: string | undefined; } | undefined) => any
```

Checks whether the Japanese → target language model is downloaded. Never throws.

| Param         | Type                                      |
| ------------- | ----------------------------------------- |
| **`options`** | <code>{ targetLanguage?: string; }</code> |

**Returns:** <code>any</code>

--------------------


### translateText(...)

```typescript
translateText(options: TranslateTextOptions) => any
```

Translates Japanese text on the device.

| Param         | Type                                                                  |
| ------------- | --------------------------------------------------------------------- |
| **`options`** | <code><a href="#translatetextoptions">TranslateTextOptions</a></code> |

**Returns:** <code>any</code>

--------------------


### addListener('textRecognized', ...)

```typescript
addListener(eventName: 'textRecognized', listenerFunc: (result: OcrResult) => void) => any
```

Fired for every recognized live frame.

| Param              | Type                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| **`eventName`**    | <code>'textRecognized'</code>                                        |
| **`listenerFunc`** | <code>(result: <a href="#ocrresult">OcrResult</a>) =&gt; void</code> |

**Returns:** <code>any</code>

--------------------


### addListener('liveRecognitionError', ...)

```typescript
addListener(eventName: 'liveRecognitionError', listenerFunc: (error: LiveRecognitionErrorEvent) => void) => any
```

Fired when recognizing or translating a live frame fails.

| Param              | Type                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| **`eventName`**    | <code>'liveRecognitionError'</code>                                                                 |
| **`listenerFunc`** | <code>(error: <a href="#liverecognitionerrorevent">LiveRecognitionErrorEvent</a>) =&gt; void</code> |

**Returns:** <code>any</code>

--------------------


### removeAllListeners()

```typescript
removeAllListeners() => any
```

**Returns:** <code>any</code>

--------------------


### Interfaces


#### DeviceSupportResult

| Prop              | Type                 | Description                                                             |
| ----------------- | -------------------- | ----------------------------------------------------------------------- |
| **`supported`**   | <code>boolean</code> | `true` when Japanese text recognition is available on this device.      |
| **`liveCamera`**  | <code>boolean</code> | `true` when live camera recognition is available (device has a camera). |
| **`translation`** | <code>boolean</code> | `true` when on-device translation is available.                         |
| **`reason`**      | <code>string</code>  | Why the device is not (fully) supported.                                |


#### OcrReadyResult

| Prop        | Type                 | Description                                                                      |
| ----------- | -------------------- | -------------------------------------------------------------------------------- |
| **`ready`** | <code>boolean</code> | `true` once the Japanese recognizer is loaded and has processed a warm-up image. |


#### PermissionStatus

| Prop         | Type                                                        |
| ------------ | ----------------------------------------------------------- |
| **`camera`** | <code><a href="#permissionstate">PermissionState</a></code> |


#### LiveRecognitionOptions

| Prop              | Type                                                              | Description                                                                                                   | Default             |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------- |
| **`lensFacing`**  | <code>'back' \| 'front'</code>                                    | Which camera to use.                                                                                          | <code>'back'</code> |
| **`intervalMs`**  | <code>number</code>                                               | Minimum time between two recognized frames in milliseconds.                                                   | <code>500</code>    |
| **`translation`** | <code><a href="#translationoptions">TranslationOptions</a></code> | Translate the recognized text of every frame. The model must be downloaded with `prepareTranslation()` first. |                     |


#### TranslationOptions

| Prop                 | Type                 | Description                                                  | Default           |
| -------------------- | -------------------- | ------------------------------------------------------------ | ----------------- |
| **`enabled`**        | <code>boolean</code> | Turns translation of the recognized Japanese text on or off. |                   |
| **`targetLanguage`** | <code>string</code>  | BCP-47 code of the target language, e.g. `en` or `de`.       | <code>'en'</code> |


#### CaptureOptions

| Prop            | Type                 | Description                                                              | Default            |
| --------------- | -------------------- | ------------------------------------------------------------------------ | ------------------ |
| **`saveImage`** | <code>boolean</code> | Store the captured photo as a JPEG in the app cache and return its path. | <code>false</code> |


#### CaptureResult

| Prop            | Type                | Description                                                                                                                     |
| --------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **`imagePath`** | <code>string</code> | `file://` path of the captured JPEG, when `saveImage` was set. Use `Capacitor.convertFileSrc()` to show it in an `&lt;img&gt;`. |


#### LiveState

| Prop              | Type                                                              | Description                                                        |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| **`running`**     | <code>boolean</code>                                              |                                                                    |
| **`frozen`**      | <code>boolean</code>                                              | `true` while the preview shows a frame frozen by `captureFrame()`. |
| **`translation`** | <code><a href="#translationoptions">TranslationOptions</a></code> |                                                                    |


#### RecognizeImageOptions

| Prop              | Type                                                              | Description                                            |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| **`path`**        | <code>string</code>                                               | `file://`, `content://` or absolute path of the image. |
| **`base64`**      | <code>string</code>                                               | Base64 image data, with or without `data:` prefix.     |
| **`translation`** | <code><a href="#translationoptions">TranslationOptions</a></code> | Translate the recognized text.                         |


#### OcrResult

| Prop                 | Type                | Description                                                                                 |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| **`text`**           | <code>string</code> | All recognized text, blocks separated by a line break.                                      |
| **`translatedText`** | <code>string</code> | Translation of all blocks, separated by a line break. Only set when translation is enabled. |
| **`targetLanguage`** | <code>string</code> | Target language of `translatedText`.                                                        |
| **`blocks`**         | <code>{}</code>     |                                                                                             |
| **`imageWidth`**     | <code>number</code> | Width of the (upright) image the coordinates refer to.                                      |
| **`imageHeight`**    | <code>number</code> | Height of the (upright) image the coordinates refer to.                                     |


#### OcrBlock

| Prop                     | Type                                  | Description                                                      |
| ------------------------ | ------------------------------------- | ---------------------------------------------------------------- |
| **`text`**               | <code>string</code>                   |                                                                  |
| **`translatedText`**     | <code>string</code>                   | Translation of this block. Only set when translation is enabled. |
| **`boundingBox`**        | <code><a href="#rect">Rect</a></code> |                                                                  |
| **`cornerPoints`**       | <code>{}</code>                       |                                                                  |
| **`recognizedLanguage`** | <code>string</code>                   |                                                                  |
| **`lines`**              | <code>{}</code>                       |                                                                  |


#### Rect

| Prop         | Type                |
| ------------ | ------------------- |
| **`left`**   | <code>number</code> |
| **`top`**    | <code>number</code> |
| **`right`**  | <code>number</code> |
| **`bottom`** | <code>number</code> |


#### Point

| Prop    | Type                |
| ------- | ------------------- |
| **`x`** | <code>number</code> |
| **`y`** | <code>number</code> |


#### OcrLine

| Prop                     | Type                                  | Description      |
| ------------------------ | ------------------------------------- | ---------------- |
| **`text`**               | <code>string</code>                   |                  |
| **`boundingBox`**        | <code><a href="#rect">Rect</a></code> |                  |
| **`cornerPoints`**       | <code>{}</code>                       |                  |
| **`confidence`**         | <code>number</code>                   | Between 0 and 1. |
| **`recognizedLanguage`** | <code>string</code>                   |                  |
| **`elements`**           | <code>{}</code>                       |                  |


#### OcrElement

| Prop               | Type                                  | Description      |
| ------------------ | ------------------------------------- | ---------------- |
| **`text`**         | <code>string</code>                   |                  |
| **`boundingBox`**  | <code><a href="#rect">Rect</a></code> |                  |
| **`cornerPoints`** | <code>{}</code>                       |                  |
| **`confidence`**   | <code>number</code>                   | Between 0 and 1. |


#### PrepareTranslationOptions

| Prop                 | Type                 | Description                         | Default            |
| -------------------- | -------------------- | ----------------------------------- | ------------------ |
| **`targetLanguage`** | <code>string</code>  | BCP-47 code of the target language. | <code>'en'</code>  |
| **`requireWifi`**    | <code>boolean</code> | Only download the model over Wi-Fi. | <code>false</code> |


#### TranslateTextOptions

| Prop                 | Type                | Description                         | Default           |
| -------------------- | ------------------- | ----------------------------------- | ----------------- |
| **`text`**           | <code>string</code> |                                     |                   |
| **`targetLanguage`** | <code>string</code> | BCP-47 code of the target language. | <code>'en'</code> |


#### PluginListenerHandle

| Prop         | Type                      |
| ------------ | ------------------------- |
| **`remove`** | <code>() =&gt; any</code> |


#### LiveRecognitionErrorEvent

| Prop          | Type                                                                  |
| ------------- | --------------------------------------------------------------------- |
| **`code`**    | <code><a href="#japaneseocrerrorcode">JapaneseOcrErrorCode</a></code> |
| **`message`** | <code>string</code>                                                   |


### Type Aliases


#### PermissionState

<code>'prompt' | 'prompt-with-rationale' | 'granted' | 'denied'</code>


#### JapaneseOcrErrorCode

Error codes used when a call is rejected.

Read it from the `code` property of the thrown error.

<code>'UNAVAILABLE' | 'NOT_READY' | 'PERMISSION_DENIED' | 'CAMERA_ERROR' | 'ALREADY_RUNNING' | 'NOT_RUNNING' | 'INVALID_ARGUMENT' | 'RECOGNITION_FAILED' | 'TRANSLATION_NOT_READY' | 'TRANSLATION_FAILED'</code>

</docgen-api>
