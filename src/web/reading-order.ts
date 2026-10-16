/**
 * Puts recognized lines into reading order, separates furigana and pairs each reading with the
 * characters it is printed over.
 *
 * Line-by-line port of `android/.../ReadingOrder.java`, so the web engine returns the same
 * paragraphs, furigana and segments as the Android engine. Keep both in sync.
 */

/** An axis-aligned box in image pixels. */
export class Box {
  constructor(
    readonly left: number,
    readonly top: number,
    readonly right: number,
    readonly bottom: number,
  ) {}

  width(): number {
    return this.right - this.left;
  }

  height(): number {
    return this.bottom - this.top;
  }

  centerX(): number {
    return (this.left + this.right) / 2;
  }

  centerY(): number {
    return (this.top + this.bottom) / 2;
  }

  contains(x: number, y: number): boolean {
    return x >= this.left && x <= this.right && y >= this.top && y <= this.bottom;
  }
}

/** One recognized character. */
export class Glyph extends Box {
  constructor(
    readonly text: string,
    /** Index of the word (element) within its line; words are separated by spaces. */
    readonly word: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ) {
    super(left, top, right, bottom);
  }
}

/** A recognized line: its text, box and, when known, its characters. */
export class Line extends Box {
  constructor(
    readonly text: string,
    left: number,
    top: number,
    right: number,
    bottom: number,
    readonly glyphs: Glyph[] = [],
  ) {
    super(left, top, right, bottom);
  }
}

/** A line, or the characters of it that lie inside a selected region. */
export interface Part {
  line: number;
  /** Indexes into the line's glyphs, or null for the whole line. */
  glyphs: number[] | null;
  box: Box;
}

export interface Paragraph {
  parts: Part[];
  /** Index of the region this paragraph was selected by, or -1 without regions. */
  region: number;
  text: string;
}

/** A reading paired with the characters it belongs to. */
export class Ruby extends Box {
  /** The characters it is printed over, or null when they could not be determined. */
  base: string | null = null;
  /** Paragraph that holds the base characters, or -1. */
  paragraph = -1;
  /** Range of the base characters in the paragraph text, or -1 when unknown. */
  start = -1;
  end = -1;

  constructor(
    /** The reading in kana. */
    readonly reading: string,
    /** Index of the furigana line it was read from. */
    readonly line: number,
    box: Box,
  ) {
    super(box.left, box.top, box.right, box.bottom);
  }
}

/** A piece of paragraph text, with its reading when furigana was printed over it. */
export interface Segment {
  text: string;
  reading: string | null;
}

export interface Layout {
  /** Paragraphs in reading order (per region, in the order the regions were given). */
  paragraphs: Paragraph[];
  /** Indexes of every line recognized as furigana, in reading order. */
  furigana: number[];
  /** Readings that belong to the returned paragraphs, in reading order. */
  ruby: Ruby[];
  vertical: boolean;
}

/** Lines thinner than this share of the typical text size are furigana candidates. */
const FURIGANA_RATIO = 0.7;
/** A kana line this much thinner than the kanji line right below it is furigana. */
const FURIGANA_NEIGHBOR_RATIO = 0.8;
/** Lines whose centers are closer than this share of the text size are on the same row. */
const SAME_ROW = 0.5;
/** A gap larger than this share of the text size starts a new paragraph. */
const PARAGRAPH_GAP = 1.5;
/** Lines whose size differs by more than this ratio belong to different paragraphs (title vs body). */
const SIZE_CHANGE = 1.3;

/**
 * @param regions only text whose characters lie inside one of these boxes is returned, each
 *     region in turn; furigana belonging to selected characters is kept even when it lies just
 *     outside. Null returns everything.
 */
export function arrange(lines: Line[], regions: Box[] | null = null): Layout {
  const layout: Layout = { paragraphs: [], furigana: [], ruby: [], vertical: false };
  if (!lines.length) return layout;

  layout.vertical = isVertical(lines);
  const vertical = layout.vertical;

  const reference = percentile(
    lines.map((l) => thickness(l, vertical)),
    0.75,
  );

  const main: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isFurigana(lines, i, vertical, reference)) layout.furigana.push(i);
    else main.push(i);
  }

  // Typical size of the main text, without the furigana pulling it down.
  const size = !main.length
    ? reference
    : percentile(
        main.map((i) => thickness(lines[i], vertical)),
        0.5,
      );
  const order = readingOrder(lines, vertical, size);
  main.sort(order);
  layout.furigana.sort(order);

  const readings: Ruby[] = [];
  const baseLine = new Map<Ruby, number>();
  const baseGlyphs = new Map<Ruby, number[]>();
  for (const index of layout.furigana) {
    for (const ruby of readingsOf(lines, index, vertical)) {
      readings.push(ruby);
      pairWithBase(lines, main, ruby, vertical, baseLine, baseGlyphs);
    }
  }

  if (regions == null) {
    group(
      layout,
      lines,
      main.map((index) => ({ line: index, glyphs: null, box: lines[index] })),
      -1,
      vertical,
      size,
    );
  } else {
    regions.forEach((region, r) => group(layout, lines, select(lines, main, region), r, vertical, size));
  }

  placeReadings(layout, lines, readings, baseLine, baseGlyphs, regions);
  return layout;
}

/**
 * Locates every reading's base characters in the returned paragraphs and keeps the readings that
 * belong to returned text. With regions, a reading without a base line is kept when it lies inside
 * a region itself.
 */
function placeReadings(
  layout: Layout,
  lines: Line[],
  readings: Ruby[],
  baseLine: Map<Ruby, number>,
  baseGlyphs: Map<Ruby, number[]>,
  regions: Box[] | null,
): void {
  for (const ruby of readings) {
    const line = baseLine.get(ruby);
    let placed = false;
    if (line !== undefined) {
      for (let p = 0; p < layout.paragraphs.length && !placed; p++) {
        placed = place(layout.paragraphs[p], p, lines, line, baseGlyphs.get(ruby) ?? null, ruby);
      }
    }
    if (placed || regions == null || (line === undefined && inAny(regions, ruby))) {
      layout.ruby.push(ruby);
    }
  }
}

/** Joins the lines of a paragraph. Japanese lines are joined directly, Latin words with a space. */
export function join(parts: string[]): string {
  let text = '';
  for (const part of parts) text = append(text, part);
  return text;
}

/** Splits a paragraph into plain text and text with its reading, for rendering as ruby. */
export function segments(text: string, ruby: Ruby[], paragraph: number): Segment[] {
  const own = ruby
    .filter((r) => r.paragraph === paragraph && r.start >= 0 && r.end <= text.length && r.start < r.end)
    .sort((a, b) => a.start - b.start);
  const result: Segment[] = [];
  let cursor = 0;
  for (const r of own) {
    if (r.start < cursor) continue; // overlaps the previous reading
    if (r.start > cursor) result.push({ text: text.substring(cursor, r.start), reading: null });
    result.push({ text: text.substring(r.start, r.end), reading: r.reading });
    cursor = r.end;
  }
  if (cursor < text.length) result.push({ text: text.substring(cursor), reading: null });
  return result;
}

// Furigana detection

function isFurigana(lines: Line[], index: number, vertical: boolean, reference: number): boolean {
  const line = lines[index];
  if (!isKana(line.text)) return false;
  const t = thickness(line, vertical);
  if (t < reference * FURIGANA_RATIO) return true;
  // Large headings have large furigana: compare with the line it sits on instead.
  for (const other of lines) {
    if (other === line || !hasKanji(other.text)) continue;
    if (t >= thickness(other, vertical) * FURIGANA_NEIGHBOR_RATIO) continue;
    if (sitsOn(line, other, vertical, t)) return true;
  }
  return false;
}

/** True when `reading` is printed right above (or right of, in vertical text) `base`. */
function sitsOn(reading: Box, base: Box, vertical: boolean, size: number): boolean {
  if (vertical) {
    const overlaps = base.top < reading.bottom && base.bottom > reading.top;
    const gap = reading.left - base.right;
    return overlaps && base.centerX() < reading.centerX() && gap > -size && gap < size;
  }
  const overlaps = base.left < reading.right && base.right > reading.left;
  const gap = base.top - reading.bottom;
  return overlaps && base.centerY() > reading.centerY() && gap > -size && gap < size;
}

/**
 * Splits a furigana line into one reading per word: the readings of neighbouring words can end up
 * in one line ("にほん がっこう"), separated by spaces or wide gaps.
 */
function readingsOf(lines: Line[], index: number, vertical: boolean): Ruby[] {
  const line = lines[index];
  const result: Ruby[] = [];
  if (!line.glyphs.length) {
    const words = javaTrim(line.text).split(/[ \t\n\v\f\r]+/);
    if (words.length === 1) {
      result.push(new Ruby(words[0], index, line));
    } else {
      // No character boxes: share the line's extent out by character count.
      let total = 0;
      for (const word of words) total += word.length + 1;
      let position = 0;
      const extent = vertical ? line.height() : line.width();
      const origin = vertical ? line.top : line.left;
      for (const word of words) {
        const from = origin + Math.trunc((extent * position) / total);
        const to = origin + Math.trunc((extent * (position + word.length)) / total);
        const box = vertical ? new Box(line.left, from, line.right, to) : new Box(from, line.top, to, line.bottom);
        result.push(new Ruby(word, index, box));
        position += word.length + 1;
      }
    }
    return result;
  }

  let group: Glyph[] = [];
  let previous: Glyph | null = null;
  for (const glyph of line.glyphs) {
    if (
      previous != null &&
      (glyph.word !== previous.word || gap(previous, glyph, vertical) > thickness(line, vertical))
    ) {
      result.push(rubyOf(group, index));
      group = [];
    }
    if (javaTrim(glyph.text).length) group.push(glyph);
    previous = glyph;
  }
  if (group.length) result.push(rubyOf(group, index));
  return result;
}

function rubyOf(glyphs: Glyph[], line: number): Ruby {
  let text = '';
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const g of glyphs) {
    text += g.text;
    left = Math.min(left, g.left);
    top = Math.min(top, g.top);
    right = Math.max(right, g.right);
    bottom = Math.max(bottom, g.bottom);
  }
  return new Ruby(text, line, new Box(left, top, right, bottom));
}

function gap(a: Box, b: Box, vertical: boolean): number {
  return vertical ? b.top - a.bottom : b.left - a.right;
}

/** Finds the main line a reading is printed over and the characters within its extent. */
function pairWithBase(
  lines: Line[],
  main: number[],
  ruby: Ruby,
  vertical: boolean,
  baseLine: Map<Ruby, number>,
  baseGlyphs: Map<Ruby, number[]>,
): void {
  const size = Math.max(1, vertical ? ruby.width() : ruby.height());
  let nearest = -1;
  let nearestDistance = Number.MAX_VALUE;
  for (const index of main) {
    const line = lines[index];
    let distance: number;
    if (vertical) {
      const overlaps = line.top < ruby.bottom && line.bottom > ruby.top;
      if (!overlaps || line.centerX() >= ruby.centerX()) continue;
      distance = Math.abs(ruby.left - line.right);
    } else {
      const overlaps = line.left < ruby.right && line.right > ruby.left;
      if (!overlaps || line.centerY() <= ruby.centerY()) continue;
      distance = Math.abs(line.top - ruby.bottom);
    }
    if (distance < nearestDistance && distance < size * 3) {
      nearest = index;
      nearestDistance = distance;
    }
  }
  if (nearest < 0) return;
  baseLine.set(ruby, nearest);

  const line = lines[nearest];
  if (!line.glyphs.length) return;
  const from = (vertical ? ruby.top : ruby.left) - size / 2;
  const to = (vertical ? ruby.bottom : ruby.right) + size / 2;
  const glyphs: number[] = [];
  line.glyphs.forEach((g, i) => {
    const center = vertical ? g.centerY() : g.centerX();
    if (center >= from && center <= to) glyphs.push(i);
  });
  // Furigana belongs to kanji: drop kana the extent caught at either end.
  while (glyphs.length > 1 && !hasKanji(line.glyphs[glyphs[0]].text)) glyphs.shift();
  while (glyphs.length > 1 && !hasKanji(line.glyphs[glyphs[glyphs.length - 1]].text)) glyphs.pop();
  if (!glyphs.length) return;

  ruby.base = glyphs.map((i) => line.glyphs[i].text).join('');
  baseGlyphs.set(ruby, glyphs);
}

/** Sets the reading's position when its base characters are part of the paragraph. */
function place(
  paragraph: Paragraph,
  index: number,
  lines: Line[],
  line: number,
  glyphs: number[] | null,
  ruby: Ruby,
): boolean {
  for (const part of paragraph.parts) {
    if (part.line !== line) continue;
    if (glyphs == null) {
      ruby.paragraph = index;
      return true;
    }
    if (part.glyphs != null && !glyphs.every((g) => part.glyphs!.includes(g))) continue;
    const offsets = offsetsIn(paragraph, lines, part);
    ruby.paragraph = index;
    if (offsets == null) return true;
    const lastGlyph = glyphs[glyphs.length - 1];
    const first = offsets[glyphs[0]];
    const last = offsets[lastGlyph];
    // Characters that could not be found in the text: the reading keeps its paragraph only.
    if (first < 0 || last < 0) return true;
    ruby.start = first;
    ruby.end = last + lines[line].glyphs[lastGlyph].text.length;
    return true;
  }
  return false;
}

function inAny(regions: Box[], box: Box): boolean {
  return regions.some((region) => region.contains(box.centerX(), box.centerY()));
}

// Selection and paragraphs

function select(lines: Line[], main: number[], region: Box): Part[] {
  const parts: Part[] = [];
  for (const index of main) {
    const line = lines[index];
    if (!line.glyphs.length) {
      if (region.contains(line.centerX(), line.centerY())) parts.push({ line: index, glyphs: null, box: line });
      continue;
    }
    const inside: number[] = [];
    line.glyphs.forEach((g, i) => {
      if (region.contains(g.centerX(), g.centerY())) inside.push(i);
    });
    if (!inside.length) continue;
    if (inside.length === line.glyphs.length) {
      parts.push({ line: index, glyphs: null, box: line });
    } else {
      parts.push({ line: index, glyphs: inside, box: boxOf(line.glyphs, inside) });
    }
  }
  return parts;
}

function boxOf(glyphs: Glyph[], indexes: number[]): Box {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const i of indexes) {
    const g = glyphs[i];
    left = Math.min(left, g.left);
    top = Math.min(top, g.top);
    right = Math.max(right, g.right);
    bottom = Math.max(bottom, g.bottom);
  }
  return new Box(left, top, right, bottom);
}

function group(layout: Layout, lines: Line[], parts: Part[], region: number, vertical: boolean, size: number): void {
  const first = layout.paragraphs.length;
  let paragraph: Paragraph | null = null;
  let previous: Box | null = null;
  for (const part of parts) {
    if (paragraph == null || startsParagraph(previous!, part.box, vertical, size)) {
      paragraph = { parts: [], region, text: '' };
      layout.paragraphs.push(paragraph);
    }
    paragraph.parts.push(part);
    previous = part.box;
  }
  for (let p = first; p < layout.paragraphs.length; p++) {
    const current = layout.paragraphs[p];
    current.text = join(current.parts.map((part) => partText(lines, part)));
  }
}

export function partText(lines: Line[], part: Part): string {
  const line = lines[part.line];
  if (part.glyphs == null) return line.text;
  let text = '';
  let previous: Glyph | null = null;
  for (const i of part.glyphs) {
    const g = line.glyphs[i];
    if (previous != null && previous.word !== g.word) text = append(text, g.text);
    else text += g.text;
    previous = g;
  }
  return text;
}

/** Offset of each of the line's glyphs in the paragraph text, -1 where not found; null if the part is missing. */
function offsetsIn(paragraph: Paragraph, lines: Line[], target: Part): number[] | null {
  let text = '';
  for (const part of paragraph.parts) {
    const ownText = partText(lines, part);
    text = append(text, ownText);
    const start = text.length - ownText.length;
    if (part !== target) continue;

    const line = lines[part.line];
    const offsets = new Array<number>(line.glyphs.length).fill(-1);
    const indexes = part.glyphs ?? line.glyphs.map((_, i) => i);
    let cursor = 0;
    for (const i of indexes) {
      const g = line.glyphs[i].text;
      const found = !g.length ? -1 : ownText.indexOf(g, cursor);
      if (found < 0) continue;
      offsets[i] = start + found;
      cursor = found + g.length;
    }
    return offsets;
  }
  return null;
}

function append(text: string, part: string): string {
  if (text.length && part.length && isLatin(text.charAt(text.length - 1)) && isLatin(part.charAt(0))) {
    return text + ' ' + part;
  }
  return text + part;
}

function isVertical(lines: Line[]): boolean {
  let vertical = 0;
  let horizontal = 0;
  for (const line of lines) {
    if (Array.from(line.text).length < 2) continue;
    if (line.height() > line.width() * 1.5) vertical++;
    else if (line.width() > line.height() * 1.5) horizontal++;
  }
  return vertical > horizontal;
}

function thickness(box: Box, vertical: boolean): number {
  return vertical ? box.width() : box.height();
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.round((sorted.length - 1) * p);
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

/**
 * Horizontal: rows top to bottom, left to right within a row.
 * Vertical: columns right to left, top to bottom within a column.
 */
function readingOrder(lines: Line[], vertical: boolean, size: number): (a: number, b: number) => number {
  const tolerance = size * SAME_ROW;
  return (a, b) => {
    const x = lines[a];
    const y = lines[b];
    if (vertical) {
      const cx = x.centerX();
      const cy = y.centerX();
      if (Math.abs(cx - cy) > tolerance) return Math.sign(cy - cx);
      return Math.sign(x.top - y.top);
    }
    const rx = x.centerY();
    const ry = y.centerY();
    if (Math.abs(rx - ry) > tolerance) return Math.sign(rx - ry);
    return Math.sign(x.left - y.left);
  };
}

function startsParagraph(previous: Box, line: Box, vertical: boolean, size: number): boolean {
  const a = thickness(previous, vertical);
  const b = thickness(line, vertical);
  if (Math.max(a, b) > Math.min(a, b) * SIZE_CHANGE) return true;
  if (vertical) {
    // Next column must be to the left, close by, and start near the same top.
    const g = previous.left - line.right;
    const overlaps = line.top < previous.bottom && line.bottom > previous.top;
    return g < -size * SAME_ROW || g > size * PARAGRAPH_GAP || !overlaps;
  }
  // Next row must be below, close by, and overlap the previous line horizontally.
  const g = line.top - previous.bottom;
  const overlaps = line.left < previous.right && line.right > previous.left;
  return g < -size * SAME_ROW || g > size * PARAGRAPH_GAP || !overlaps;
}

/** Java's Character.isWhitespace (no non-breaking spaces), so kana checks match the Android engine. */
function isWhitespace(code: number): boolean {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    (code >= 0x1c && code <= 0x20) ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x2006) ||
    (code >= 0x2008 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x205f ||
    code === 0x3000
  );
}

/** True when the text only contains hiragana, katakana and spaces. */
export function isKana(text: string): boolean {
  let any = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isWhitespace(code)) continue;
    const kana = (code >= 0x3040 && code <= 0x30ff) || (code >= 0x31f0 && code <= 0x31ff);
    if (!kana) return false;
    any = true;
  }
  return any;
}

const HAN = /\p{Script=Han}/u;

export function hasKanji(text: string): boolean {
  return HAN.test(text);
}

const LETTER_OR_DIGIT = /[\p{L}\p{Nd}]/u;

function isLatin(c: string): boolean {
  return c.charCodeAt(0) < 0x3000 && LETTER_OR_DIGIT.test(c);
}

/** Java's String.trim(): removes characters up to U+0020 only. */
function javaTrim(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) <= 0x20) start++;
  while (end > start && text.charCodeAt(end - 1) <= 0x20) end--;
  return text.substring(start, end);
}
