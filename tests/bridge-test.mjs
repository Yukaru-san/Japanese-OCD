// Runs the built test app in Chromium against a simulated Android bridge (tests/fake-android.js)
// and once as a plain web page. Checks what a user would see; does not look at app internals.
//   npm run build && npm run test:bridge
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const shots = join(root, 'tests', 'screenshots');
mkdirSync(shots, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const body = readFileSync(join(dist, path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const nativeBridge = readFileSync(
  join(root, 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js'),
  'utf8',
);
const promise = (names) => names.map((name) => ({ name, rtype: 'promise' }));
const headers = [
  {
    name: 'JapaneseOcr',
    methods: promise([
      'isDeviceSupported', 'isOcrReady', 'checkPermissions', 'requestPermissions', 'startLiveRecognition',
      'stopLiveRecognition', 'captureFrame', 'resumeLiveRecognition', 'getLiveState', 'setTorch',
      'setTranslation', 'recognizeImage', 'recognizeFromGallery', 'prepareTranslation', 'isTranslationReady', 'translateText',
      'recognizeHandwriting', 'prepareHandwriting', 'isHandwritingReady', 'removeAllListeners',
    ]).concat([{ name: 'addListener', rtype: 'callback' }]),
  },
  { name: 'Clipboard', methods: promise(['write', 'read']) },
];

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const browser = await chromium.launch();

// Android, simulated
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript({ path: join(root, 'tests', 'fake-android.js') });
  await page.addInitScript(`${nativeBridge}\nwindow.Capacitor.PluginHeaders = ${JSON.stringify(headers)};`);
  await page.goto(url);

  await page.waitForFunction(() => document.getElementById('ready').textContent === 'ja');
  check('isDeviceSupported shown', (await page.textContent('#supported')).startsWith('ja'));
  check('isOcrReady shown', (await page.textContent('#ready')) === 'ja');

  await page.click('#start');
  await page.waitForFunction(() => document.getElementById('live-text').textContent.includes('せかい'));
  const liveText = await page.textContent('#live-text');
  check('live text reaches the web app', liveText === 'こんにちは、せかい\n日本語を勉強する', JSON.stringify(liveText));

  const marker = page.locator('.word-marker[data-word="せかい"]');
  await marker.waitFor();
  const box = await marker.boundingBox();
  // せかい are characters 6–8 of the first line: x 244–346, y 160–194 in the fake camera image.
  const aligned = Math.abs(box.x + 4 - 244) <= 2 && Math.abs(box.y + 4 - 160) <= 2 && Math.abs(box.width - 8 - 102) <= 2;
  check('marker sits on せかい in the camera image', aligned, JSON.stringify(box));
  const words = await page.$$eval('.word-marker', (els) => els.map((e) => e.dataset.word));
  check('glossary words found', ['こんにちは', 'せかい', '日本語', '勉強'].every((w) => words.includes(w)), words.join(','));

  await page.screenshot({ path: join(shots, '1-live.png') });
  await marker.click();
  const popup = await page.textContent('#word-popup');
  check('tap shows own explanation for せかい', popup.includes('Welt') && popup.includes('sekai') && popup.includes('世界'), popup);
  check('explanation does not come from ML Kit translation', (await page.evaluate(() => window.__fakeAndroid.translation)) === null);
  await page.screenshot({ path: join(shots, '2-explanation.png') });

  await page.click('#capture');
  await page.waitForFunction(() => !document.getElementById('resume').hidden);
  check('capture freezes', await page.evaluate(() => window.__fakeAndroid.frozen));
  check('captured text in result field', (await page.inputValue('#result')) === 'こんにちは、せかい\n日本語を勉強する');
  check('markers stay on frozen frame', (await page.locator('.word-marker').count()) >= 4);
  await page.click('#resume');
  check('resume unfreezes', !(await page.evaluate(() => window.__fakeAndroid.frozen)));

  // Translation toggle while live
  await page.click('#stop');
  await page.selectOption('#language', 'de');
  await page.click('#prepare-translation');
  await page.waitForFunction(() => document.getElementById('translation-ready').textContent.includes('geladen') && !document.getElementById('translation-ready').textContent.includes('nicht'));
  await page.click('#start');
  await page.click('#live-translate');
  await page.waitForFunction(() => document.getElementById('live-translation').textContent.includes('Hallo, Welt'));
  check('live translation toggles on', true, await page.textContent('#live-translation'));
  await page.click('#live-translate');
  await page.waitForTimeout(700);
  check('live translation toggles off', (await page.textContent('#live-translation')) === '');
  await page.screenshot({ path: join(shots, '3-live-again.png') });

  await page.click('#capture');
  await page.waitForFunction(() => !document.getElementById('resume').hidden);
  await page.click('#stop');
  await page.click('#copy');
  await page.waitForTimeout(100);
  check('copy puts recognized text on the clipboard', (await page.evaluate(() => window.__fakeAndroid.clipboard)) === 'こんにちは、せかい\n日本語を勉強する');

  await page.click('#translate-result');
  await page.waitForFunction(() => document.getElementById('result-translation').value !== '');
  check('translateText on captured text', (await page.inputValue('#result-translation')).startsWith('[de]'));

  // Gallery
  await page.uncheck('#translate');
  await page.fill('#result', '');
  await page.click('#gallery');
  await page.waitForFunction(() => document.getElementById('result').value !== '');
  check('gallery image text reaches the web app', (await page.inputValue('#result')) === 'こんにちは、せかい\n日本語を勉強する');
  check('gallery result lists glossary words', (await page.textContent('#result-words')).includes('せかい = Welt'));
  check('furigana listed separately from the text', (await page.textContent('#result-furigana')) === 'Furigana: 日本語 = にほんご' && !(await page.inputValue('#result')).includes('にほんご'));
  check('gallery asks for the selection screen', (await page.evaluate(() => window.__fakeAndroid.lastGallery?.selectRegion)) === true);
  check('text is shown with furigana as ruby', (await page.innerHTML('#result-ruby')).includes('<ruby>日本語<rt>にほんご</rt></ruby>を勉強する'));
  check('gallery photo is shown', await page.evaluate(() => !document.getElementById('captured-image').hidden && document.getElementById('captured-image').src.includes('_capacitor_content_')));
  await page.evaluate(() => { window.__fakeAndroid.pickerCancels = true; });
  await page.click('#gallery');
  await page.waitForFunction(() => document.getElementById('log').textContent.includes('Galerie: keine Auswahl'));
  check('closing the picker is handled quietly', !(await page.textContent('#log')).split('\n')[0].includes('→'));

  // Handwriting: draw two strokes, candidates appear by themselves
  const ink = page.locator('#ink');
  await ink.scrollIntoViewIfNeeded();
  const inkBox = await ink.boundingBox();
  const drawLine = async (x1, y1, x2, y2) => {
    await page.mouse.move(inkBox.x + x1, inkBox.y + y1);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(inkBox.x + x1 + ((x2 - x1) * i) / 8, inkBox.y + y1 + ((y2 - y1) * i) / 8);
    await page.mouse.up();
  };
  await drawLine(40, 40, 40, 140);
  await drawLine(40, 40, 100, 40);
  await page.waitForFunction(() => document.querySelectorAll('#ink-candidates li').length === 5);
  const ink1 = await page.evaluate(() => window.__fakeAndroid.lastInk);
  check('strokes reach the plugin with points and times', ink1.strokes.length === 2 && ink1.strokes[0].points.length >= 8 && ink1.strokes[0].points.every((p) => typeof p.t === 'number'), JSON.stringify(ink1.strokes[0].points[0]));
  check('drawing area size is passed', Math.abs(ink1.width - inkBox.width) <= 2 && Math.abs(ink1.height - 200) < 2, `${ink1.width}x${ink1.height}`);
  const firstPoint = ink1.strokes[0].points[0];
  check('points are relative to the drawing area', Math.abs(firstPoint.x - 40) < 2 && Math.abs(firstPoint.y - 40) < 2, JSON.stringify(firstPoint));
  const items = await page.$$eval('#ink-candidates li', (els) => els.map((e) => e.textContent));
  check('5 candidates with probability shown', items[0] === '日本56.1 %' && items.every((t) => / %$/.test(t)), items.join(' | '));
  await page.screenshot({ path: join(shots, '5-handwriting.png') });
  await page.click('#ink-candidates li:first-child button');
  await page.waitForFunction(() => document.querySelectorAll('#ink-candidates li').length === 0);
  check('tapping a candidate appends it and clears the drawing', (await page.inputValue('#ink-text')) === '日本');
  await drawLine(40, 40, 120, 120);
  await page.waitForFunction(() => document.querySelectorAll('#ink-candidates li').length === 5);
  check('accepted text is sent as preContext', (await page.evaluate(() => window.__fakeAndroid.lastInk.preContext)) === '日本');
  await page.click('#ink-undo');
  await page.waitForFunction(() => document.querySelectorAll('#ink-candidates li').length === 0);
  check('undo of the only stroke clears the candidates', true);
  check('handwriting model shown as loaded', (await page.textContent('#handwriting-ready')) === 'geladen');

  // Error path: starting with translation for a language whose model is missing
  await page.selectOption('#language', 'en');
  await page.check('#translate');
  await page.click('#start');
  await page.waitForFunction(() => document.getElementById('log').textContent.includes('TRANSLATION_NOT_READY'));
  check('missing model rejects with TRANSLATION_NOT_READY', true);
  await page.screenshot({ path: join(shots, '4-panels.png'), fullPage: true });

  check('no uncaught page errors (android)', errors.length === 0, errors.join(' | '));
  await page.close();
}

// Plain web: must report unsupported and throw on use
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('supported').textContent !== '…');
  check('web: isDeviceSupported is false, no throw', (await page.textContent('#supported')).startsWith('nein'));
  check('web: isOcrReady is false', (await page.textContent('#ready')) === 'nein');
  await page.click('#start');
  await page.waitForFunction(() => document.getElementById('log').textContent.includes('startLiveRecognition'));
  check('web: startLiveRecognition throws UNAVAILABLE', (await page.textContent('#log')).includes('UNAVAILABLE'));
  check('no uncaught page errors (web)', errors.length === 0, errors.join(' | '));
  await page.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
