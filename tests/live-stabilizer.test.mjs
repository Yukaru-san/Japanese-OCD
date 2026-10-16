// Unit tests for the live result smoothing. Run with `npm test` (compiles with tsc first).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LiveStabilizer, textSimilarity } from '../dist/esm/live-stabilizer.js';

/** A block with one line, at image box [left, top, right, bottom]; view boxes are image / 2. */
function block(text, [left, top, right, bottom]) {
  const box = { left, top, right, bottom };
  const view = { left: left / 2, top: top / 2, right: right / 2, bottom: bottom / 2 };
  return {
    text,
    recognizedLanguage: 'ja',
    boundingBox: box,
    viewBoundingBox: view,
    segments: [{ text }],
    lines: [{ text, confidence: 1, recognizedLanguage: 'ja', boundingBox: box, viewBoundingBox: view, elements: [] }],
  };
}

function frame(blocks, furigana = []) {
  return {
    text: blocks.map((b) => b.text).join('\n'),
    blocks,
    furigana,
    vertical: false,
    imageWidth: 1080,
    imageHeight: 1920,
  };
}

const texts = (result) => result.blocks.map((b) => b.text);

test('a paragraph appears after two frames and gets a stable trackId', () => {
  const s = new LiveStabilizer();
  assert.deepEqual(texts(s.push(frame([block('日本語', [100, 100, 400, 160])]))), []);
  const second = s.push(frame([block('日本語', [102, 101, 402, 161])]));
  assert.deepEqual(texts(second), ['日本語']);
  const third = s.push(frame([block('日本語', [140, 100, 440, 160])]));
  assert.equal(third.blocks[0].trackId, second.blocks[0].trackId);
  assert.equal(third.text, '日本語');
});

test('a one-frame misreading (furigana read into the line) does not replace the text', () => {
  const s = new LiveStabilizer();
  const base = [100, 100, 400, 160];
  s.push(frame([block('日本語を勉強する', base)]));
  s.push(frame([block('日本語を勉強する', base)]));
  assert.deepEqual(texts(s.push(frame([block('にほんご日本語を勉強する', base)]))), ['日本語を勉強する']);
  assert.deepEqual(texts(s.push(frame([block('日本語を勉強する', base)]))), ['日本語を勉強する']);
  // Alternating readings never switch.
  assert.deepEqual(texts(s.push(frame([block('日本語を勉強すろ', base)]))), ['日本語を勉強する']);
  assert.deepEqual(texts(s.push(frame([block('日本語を勉強する', base)]))), ['日本語を勉強する']);
});

test('a reading seen twice in a row and often enough replaces the old one', () => {
  const s = new LiveStabilizer();
  const base = [100, 100, 400, 160];
  for (let i = 0; i < 4; i++) s.push(frame([block('日本語を勉強', base)]));
  assert.deepEqual(texts(s.push(frame([block('日本語を勉強する', base)]))), ['日本語を勉強']);
  assert.deepEqual(texts(s.push(frame([block('日本語を勉強する', base)]))), ['日本語を勉強する']);
});

test('the shown reading follows the paragraph when the camera moves', () => {
  const s = new LiveStabilizer();
  s.push(frame([block('猫が好き', [100, 100, 400, 160])]));
  s.push(frame([block('猫が好き', [100, 100, 400, 160])]));
  const moved = s.push(frame([block('描が好き', [200, 300, 500, 360])]));
  assert.deepEqual(texts(moved), ['猫が好き']);
  assert.deepEqual(moved.blocks[0].boundingBox, { left: 200, top: 300, right: 500, bottom: 360 });
  assert.deepEqual(moved.blocks[0].viewBoundingBox, { left: 100, top: 150, right: 250, bottom: 180 });
  assert.deepEqual(moved.blocks[0].lines[0].viewBoundingBox, { left: 100, top: 150, right: 250, bottom: 180 });
});

test('a paragraph missing for up to two frames keeps its place, then disappears', () => {
  const s = new LiveStabilizer();
  const box = [100, 100, 400, 160];
  s.push(frame([block('こんにちは', box)]));
  s.push(frame([block('こんにちは', box)]));
  assert.deepEqual(texts(s.push(frame([]))), ['こんにちは']);
  assert.deepEqual(texts(s.push(frame([]))), ['こんにちは']);
  assert.deepEqual(texts(s.push(frame([]))), []);
});

test('a missing paragraph moves along with the others', () => {
  const s = new LiveStabilizer();
  const a = (dy) => block('一行目のテキスト', [100, 100 + dy, 600, 160 + dy]);
  const b = (dy) => block('二行目です', [100, 400 + dy, 500, 460 + dy]);
  s.push(frame([a(0), b(0)]));
  s.push(frame([a(0), b(0)]));
  const result = s.push(frame([a(50)]));
  assert.deepEqual(texts(result), ['一行目のテキスト', '二行目です']);
  assert.deepEqual(result.blocks[1].boundingBox, { left: 100, top: 450, right: 500, bottom: 510 });
});

test('small position changes are ignored, larger ones are not', () => {
  const s = new LiveStabilizer();
  s.push(frame([block('日本', [100, 100, 300, 160])]));
  const first = s.push(frame([block('日本', [100, 100, 300, 160])]));
  const jitter = s.push(frame([block('日本', [104, 98, 306, 164])]));
  assert.deepEqual(jitter.blocks[0].viewBoundingBox, first.blocks[0].viewBoundingBox);
  const moved = s.push(frame([block('日本', [140, 100, 340, 160])]));
  assert.deepEqual(moved.blocks[0].viewBoundingBox, { left: 70, top: 50, right: 170, bottom: 80 });
});

test('a fragment of a shown paragraph does not become a paragraph of its own', () => {
  const s = new LiveStabilizer();
  const whole = block('日本語を勉強する', [100, 100, 600, 160]);
  s.push(frame([whole]));
  s.push(frame([whole]));
  const split = s.push(frame([block('日本語を', [100, 100, 330, 160]), block('勉強する', [340, 100, 600, 160])]));
  assert.equal(split.blocks.length, 1);
  assert.equal(split.text, '日本語を勉強する');
});

test('furigana stay with their paragraph and point at its new index', () => {
  const s = new LiveStabilizer();
  const a = block('日本', [100, 400, 300, 460]);
  const b = block('猫', [100, 100, 200, 160]);
  const reading = {
    text: 'にほん',
    base: '日本',
    block: 0,
    start: 0,
    end: 2,
    boundingBox: { left: 100, top: 370, right: 300, bottom: 395 },
  };
  s.push(frame([a, b], [reading]));
  const result = s.push(frame([a, b], [reading]));
  assert.equal(result.furigana.length, 1);
  assert.equal(result.blocks[result.furigana[0].block].text, '日本');
});

test('blocks outside the visible preview are dropped', () => {
  const s = new LiveStabilizer();
  const viewport = { width: 400, height: 800 };
  const visible = block('見える', [100, 100, 300, 160]);
  const cutOff = block('見えない', [900, 100, 1060, 160]);
  s.push(frame([visible, cutOff]), viewport);
  assert.deepEqual(texts(s.push(frame([visible, cutOff]), viewport)), ['見える']);
});

test('reset forgets all paragraphs', () => {
  const s = new LiveStabilizer();
  const box = [100, 100, 400, 160];
  s.push(frame([block('日本', box)]));
  s.push(frame([block('日本', box)]));
  s.reset();
  assert.deepEqual(texts(s.push(frame([block('日本', box)]))), []);
});

test('textSimilarity', () => {
  assert.equal(textSimilarity('日本語', '日本語'), 1);
  assert.equal(textSimilarity('日本語', '英語'), 0);
  assert.ok(textSimilarity('日本語を勉強する', 'にほんご日本語を勉強する') > 0.7);
});
