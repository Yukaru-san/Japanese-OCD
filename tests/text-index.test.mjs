// Unit tests for getCharacters / characterAt / getSentences. Run with `npm test` (after a build).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { characterAt, getCharacters, getSentences } from '../dist/esm/text-index.js';

const box = (left, top, right, bottom) => ({ left, top, right, bottom });

/** A horizontal line whose characters are 10 px wide, starting at x; `words` become elements. */
function line(words, x, y, view = false) {
  let left = x;
  const elements = words.map((word) => {
    const symbols = Array.from(word).map((text) => {
      const b = box(left, y, left + 10, y + 10);
      left += 10;
      return { text, confidence: 1, boundingBox: b, ...(view ? { viewBoundingBox: b } : {}) };
    });
    return { text: word, confidence: 1, symbols };
  });
  return { text: words.join(' '), confidence: 1, recognizedLanguage: 'ja', elements };
}

function result(blocks, furigana = []) {
  return {
    text: blocks.map((b) => b.text).join('\n'),
    blocks: blocks.map((b) => ({ recognizedLanguage: 'ja', segments: [{ text: b.text }], ...b })),
    furigana,
    vertical: false,
    imageWidth: 1000,
    imageHeight: 1000,
  };
}

test('characters map to block text, boxes and furigana', () => {
  const r = result(
    [{ text: '日本語を勉強します。', lines: [line(['日本語を', '勉強します。'], 0, 0)] }],
    [{ text: 'にほんご', base: '日本語', block: 0, start: 0, end: 3 }],
  );
  const chars = getCharacters(r);
  assert.equal(chars.map((c) => c.text).join(''), '日本語を勉強します。');
  assert.deepEqual(chars[1], {
    text: '本',
    index: 1,
    block: 0,
    start: 1,
    end: 2,
    line: 0,
    boundingBox: box(10, 0, 20, 10),
    furigana: 0,
    reading: 'にほんご',
  });
  assert.equal(chars[3].reading, undefined);
  assert.deepEqual(chars[4].boundingBox, box(40, 0, 50, 10));
});

test('spaces in the text are skipped and boxes stay in step', () => {
  // ML Kit / Paddle may put a space between words; the block text keeps it.
  const r = result([{ text: '今日は 晴れ', lines: [line(['今日は', '晴れ'], 0, 0)] }]);
  const chars = getCharacters(r);
  assert.equal(chars.length, 5);
  assert.deepEqual(
    chars.map((c) => c.start),
    [0, 1, 2, 4, 5],
  );
  assert.deepEqual(chars[3].boundingBox, box(30, 0, 40, 10));
});

test('a character without a box gets no geometry but keeps its offset', () => {
  const l = line(['猫です'], 0, 0);
  l.elements[0].symbols.splice(1, 1); // no box for で
  const chars = getCharacters(result([{ text: '猫です', lines: [l] }]));
  assert.equal(chars[1].boundingBox, undefined);
  assert.deepEqual(chars[2].boundingBox, box(20, 0, 30, 10));
});

test('surrogate pairs count as one character with UTF-16 offsets', () => {
  const r = result([{ text: '𠮟る', lines: [line(['𠮟る'], 0, 0)] }]);
  const chars = getCharacters(r);
  assert.deepEqual(
    chars.map((c) => [c.text, c.start, c.end]),
    [
      ['𠮟', 0, 2],
      ['る', 2, 3],
    ],
  );
});

test('characterAt finds the tapped character, also just beside it', () => {
  const r = result([{ text: '日本', lines: [line(['日本'], 0, 0, true)] }]);
  assert.equal(characterAt(r, { x: 15, y: 5 })?.text, '本');
  assert.equal(characterAt(r, { x: 22, y: 5 })?.text, '本');
  assert.equal(characterAt(r, { x: 60, y: 5 }), undefined);
  assert.equal(characterAt(r, { x: 5, y: 5 }, { coordinates: 'image' })?.text, '日');
});

test('sentences end after 。！？ with closing brackets, never span blocks', () => {
  const r = result([
    { text: '「本当？！」と言った。 ねこ', lines: [line(['「本当？！」と言った。', 'ねこ'], 0, 0)] },
    { text: 'Version 3.5 is out. Yes', lines: [line(['Version', '3.5', 'is', 'out.', 'Yes'], 0, 20)] },
  ]);
  assert.deepEqual(
    getSentences(r).map((s) => [s.text, s.block, s.start, s.end]),
    [
      ['「本当？！」', 0, 0, 6],
      ['と言った。', 0, 6, 11],
      ['ねこ', 0, 12, 14],
      ['Version 3.5 is out.', 1, 0, 19],
      ['Yes', 1, 20, 23],
    ],
  );
  const first = getSentences(r)[0];
  assert.equal(first.characters.length, 6);
  assert.deepEqual(first.boundingBox, box(0, 0, 60, 10));
});
