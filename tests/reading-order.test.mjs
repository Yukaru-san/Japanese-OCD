// The web engine's port of ReadingOrder.java: the same cases as ReadingOrderTest.java, so both
// engines are held to the same behaviour. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Glyph, Line, arrange, segments } from '../dist/esm/web/reading-order.js';

const line = (text, left, top, right, bottom) => new Line(text, left, top, right, bottom);

/** A line with evenly spaced characters; spaces separate words and take one character width. */
function glyphs(text, left, top, charWidth, height) {
  const list = [];
  let x = left;
  let word = 0;
  for (const c of text) {
    if (c === ' ') word++;
    else list.push(new Glyph(c, word, x, top, x + charWidth, top + height));
    x += charWidth;
  }
  return new Line(text, left, top, x, top + height, list);
}

const rubyText = (layout, p) =>
  segments(layout.paragraphs[p].text, layout.ruby, p)
    .map((s) => (s.reading == null ? s.text : `${s.text}(${s.reading})`))
    .join('');

test('sorts many skewed lines row by row', () => {
  const lines = [];
  for (let r = 11; r >= 0; r--) {
    for (let c = 3; c >= 0; c--) {
      const top = 100 + r * 60 + c * 4;
      lines.push(line(`行${r}の${c}`, c * 120, top, c * 120 + 100, top + 40));
    }
  }
  const text = arrange(lines)
    .paragraphs.map((p) => p.text)
    .join('');
  let expected = '';
  for (let r = 0; r < 12; r++) for (let c = 0; c < 4; c++) expected += `行${r}の${c}`;
  assert.equal(text, expected);
});

test('a scattered page keeps every line', () => {
  let seed = 932;
  const next = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  const lines = [];
  for (let i = 0; i < 400; i++) {
    const top = next(2000);
    const left = next(800);
    lines.push(line('行', left, top, left + 100, top + 40));
  }
  const layout = arrange(lines);
  assert.equal(
    layout.paragraphs.reduce((n, p) => n + p.parts.length, 0),
    400,
  );
});

test('small kana without kanji below stays text', () => {
  const lines = [
    line('本文の一行目です', 0, 100, 400, 140),
    line('本文の二行目です', 0, 160, 400, 200),
    line('本文の三行目です', 0, 220, 400, 260),
    line('ログイン', 0, 400, 80, 420),
  ];
  const layout = arrange(lines);
  assert.deepEqual(layout.furigana, []);
  assert.deepEqual(layout.ruby, []);
  assert.deepEqual(
    layout.paragraphs.map((p) => p.text),
    ['本文の一行目です本文の二行目です本文の三行目です', 'ログイン'],
  );
});

test('base matches the text, also with a space inside', () => {
  const layout = arrange([glyphs('にほんご', 0, 70, 35, 20), glyphs('日本 語を勉強する', 0, 100, 40, 40)]);
  const [r] = layout.ruby;
  assert.equal(r.base, '日本 語');
  assert.equal(layout.paragraphs[0].text.substring(r.start, r.end), r.base);
  assert.equal(rubyText(layout, 0), '日本 語(にほんご)を勉強する');
});

test('two readings over the same kanji: furigana agrees with segments', () => {
  const layout = arrange([
    glyphs('がく', 0, 70, 20, 20),
    glyphs('まな', 30, 70, 20, 20),
    glyphs('学ぶのが好き', 0, 100, 40, 40),
  ]);
  const placed = layout.ruby.filter((r) => r.start >= 0).length;
  const withReading = segments(layout.paragraphs[0].text, layout.ruby, 0).filter((s) => s.reading != null).length;
  assert.equal(placed, withReading);
});
