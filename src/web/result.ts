/**
 * Turns PaddleOCR lines into the plugin's `OcrResult`, exactly like `OcrEngine.toResult()` does
 * for ML Kit on Android: paragraphs in reading order, furigana split off and paired with their
 * words, segments for ruby rendering.
 */
import type {
  OcrBlock,
  OcrElement,
  OcrFurigana,
  OcrGeometry,
  OcrLine,
  OcrResult,
  OcrSymbol,
  Point,
  Rect,
} from '../definitions';

import type { Pt } from './geometry';
import type { PaddleChar, PaddleLine } from './paddle';
import { Box, Glyph, Line, arrange, join, segments } from './reading-order';
import type { Layout } from './reading-order';

/** Lines read with less confidence are dropped. */
const MIN_CONFIDENCE = 0.5;

/** Maps image pixels to CSS pixels of the page (live camera results only). */
export type ViewMapper = (point: Pt) => Pt;

/** A recognized line with its words, as ML Kit structures it. */
interface Word {
  text: string;
  chars: PaddleChar[];
}

export interface Arranged {
  lines: PaddleLine[];
  words: Word[][];
  layout: Layout;
}

/** Puts the lines into reading order. `regions` limits the result to text inside them. */
export function arrangeLines(lines: PaddleLine[], regions: Rect[] | null): Arranged {
  const kept: PaddleLine[] = [];
  const words: Word[][] = [];
  const input: Line[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    // Like PaddleOCR's drop_score: unsure readings are mostly icons and lines, not text.
    if (!text || !line.chars.length || line.confidence < MIN_CONFIDENCE) continue;
    const lineWords: Word[] = [];
    for (const c of line.chars) {
      const last = lineWords[lineWords.length - 1];
      if (last && last.chars[last.chars.length - 1].word === c.word) {
        last.chars.push(c);
        last.text += c.text;
      } else {
        lineWords.push({ text: c.text, chars: [c] });
      }
    }
    const box = boundsOf(line.corners);
    const glyphs = lineWords.flatMap((word, w) =>
      word.chars.map((c) => {
        const b = boundsOf(c.corners);
        return new Glyph(c.text, w, b.left, b.top, b.right, b.bottom);
      }),
    );
    kept.push({ ...line, text: lineWords.map((w) => w.text).join(' ') });
    words.push(lineWords);
    input.push(new Line(kept[kept.length - 1].text, box.left, box.top, box.right, box.bottom, glyphs));
  }
  const boxes = regions?.map((r) => new Box(r.left, r.top, r.right, r.bottom)) ?? null;
  return { lines: kept, words, layout: arrange(input, boxes) };
}

/** Text of every paragraph (result block) in reading order, for translation. */
export function paragraphTexts(arranged: Arranged): string[] {
  return arranged.layout.paragraphs.map((p) => p.text);
}

/**
 * @param translations one entry per block, or null when translation is off
 */
export function toResult(
  arranged: Arranged,
  imageWidth: number,
  imageHeight: number,
  translations: string[] | null,
  targetLanguage: string | null,
  view: ViewMapper | null,
): OcrResult {
  const { layout } = arranged;
  const blocks: OcrBlock[] = [];
  const allText: string[] = [];
  const allTranslated: string[] = [];

  layout.paragraphs.forEach((paragraph, i) => {
    let box: Rect | null = null;
    const lines: OcrLine[] = [];
    for (const part of paragraph.parts) {
      lines.push(lineToJson(arranged, part.line, part.glyphs, view));
      const partBox = { left: part.box.left, top: part.box.top, right: part.box.right, bottom: part.box.bottom };
      box = box ? union(box, partBox) : partBox;
    }
    // Same key order as the Android engine's JSON.
    const block = { recognizedLanguage: lines[0]?.recognizedLanguage ?? 'ja' } as OcrBlock;
    putGeometry(block, box, box ? cornersOf(box) : null, view);
    if (paragraph.region >= 0) block.region = paragraph.region;
    block.segments = segments(paragraph.text, layout.ruby, i).map((s) =>
      s.reading != null ? { text: s.text, reading: s.reading } : { text: s.text },
    );
    block.text = paragraph.text;
    if (translations != null && i < translations.length) {
      block.translatedText = translations[i];
      allTranslated.push(translations[i]);
    }
    block.lines = lines;
    blocks.push(block);
    allText.push(paragraph.text);
  });

  const furigana: OcrFurigana[] = layout.ruby.map((ruby) => {
    const reading: OcrFurigana = { text: ruby.reading };
    if (ruby.base != null) reading.base = ruby.base;
    if (ruby.paragraph >= 0) reading.block = ruby.paragraph;
    if (ruby.start >= 0) {
      reading.start = ruby.start;
      reading.end = ruby.end;
    }
    const box = { left: ruby.left, top: ruby.top, right: ruby.right, bottom: ruby.bottom };
    putGeometry(reading, box, cornersOf(box), view);
    return reading;
  });

  const result = { text: allText.join('\n') } as OcrResult;
  if (translations != null) {
    result.translatedText = allTranslated.join('\n');
    if (targetLanguage != null) result.targetLanguage = targetLanguage;
  }
  result.blocks = blocks;
  result.furigana = furigana;
  result.vertical = layout.vertical;
  result.imageWidth = imageWidth;
  result.imageHeight = imageHeight;
  return result;
}

/**
 * @param glyphs indexes of the characters to include (counted across the line's words), or null
 *     for the whole line
 */
function lineToJson(arranged: Arranged, index: number, glyphs: number[] | null, view: ViewMapper | null): OcrLine {
  const line = arranged.lines[index];
  const elements: OcrElement[] = [];
  const words: string[] = [];
  let lineBox: Rect | null = null;
  let counter = 0;
  for (const word of arranged.words[index]) {
    const symbols: OcrSymbol[] = [];
    let text = '';
    let wordBox: Rect | null = null;
    let wordCorners: Pt[] = [];
    for (const c of word.chars) {
      const included = glyphs == null || glyphs.includes(counter);
      counter++;
      if (!included) continue;
      const box = boundsOf(c.corners);
      const symbol: OcrSymbol = { text: c.text, confidence: round(c.confidence) };
      putGeometry(symbol, box, c.corners.map(roundPoint), view);
      symbols.push(symbol);
      text += c.text;
      wordBox = wordBox ? union(wordBox, box) : box;
      wordCorners = wordCorners.length ? [wordCorners[0], c.corners[1], c.corners[2], wordCorners[3]] : c.corners;
    }
    if (glyphs != null && !symbols.length) continue;

    const element = { text, confidence: round(mean(symbols.map((s) => s.confidence))) } as OcrElement;
    if (glyphs == null) {
      putGeometry(element, wordBox, wordCorners.map(roundPoint), view);
    } else {
      putGeometry(element, wordBox, wordBox ? cornersOf(wordBox) : null, view);
    }
    element.symbols = symbols;
    elements.push(element);
    words.push(text);
    if (wordBox) lineBox = lineBox ? union(lineBox, wordBox) : wordBox;
  }

  const result = { confidence: round(line.confidence), recognizedLanguage: languageOf(line.text) } as OcrLine;
  if (glyphs == null) {
    result.text = line.text;
    putGeometry(result, boundsOf(line.corners), line.corners.map(roundPoint), view);
  } else {
    result.text = join(words);
    putGeometry(result, lineBox, lineBox ? cornersOf(lineBox) : null, view);
  }
  result.elements = elements;
  return result;
}

/** BCP-47 code of the line's script, like ML Kit's `recognizedLanguage`. */
function languageOf(text: string): string {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)) return 'ja';
  if (/\p{Script=Latin}/u.test(text)) return 'en';
  return 'und';
}

function putGeometry(target: OcrGeometry, box: Rect | null, corners: Point[] | null, view: ViewMapper | null): void {
  if (box) {
    target.boundingBox = box;
    if (view) target.viewBoundingBox = mapRect(box, view);
  }
  if (corners) {
    target.cornerPoints = corners;
    if (view) target.viewCornerPoints = corners.map((p) => roundTo(view(p)));
  }
}

function mapRect(box: Rect, view: ViewMapper): Rect {
  const a = view({ x: box.left, y: box.top });
  const b = view({ x: box.right, y: box.bottom });
  return {
    left: roundTo1(Math.min(a.x, b.x)),
    top: roundTo1(Math.min(a.y, b.y)),
    right: roundTo1(Math.max(a.x, b.x)),
    bottom: roundTo1(Math.max(a.y, b.y)),
  };
}

function boundsOf(points: Pt[]): Rect {
  return {
    left: Math.round(Math.min(...points.map((p) => p.x))),
    top: Math.round(Math.min(...points.map((p) => p.y))),
    right: Math.round(Math.max(...points.map((p) => p.x))),
    bottom: Math.round(Math.max(...points.map((p) => p.y))),
  };
}

function cornersOf(box: Rect): Point[] {
  return [
    { x: box.left, y: box.top },
    { x: box.right, y: box.top },
    { x: box.right, y: box.bottom },
    { x: box.left, y: box.bottom },
  ];
}

function union(a: Rect, b: Rect): Rect {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

function roundPoint(p: Pt): Point {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

function roundTo(p: Pt): Point {
  return { x: roundTo1(p.x), y: roundTo1(p.y) };
}

/** View coordinates keep one decimal, like the Android engine's density conversion. */
function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
