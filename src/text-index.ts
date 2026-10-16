import type { OcrBlock, OcrResult, Point, Rect } from './definitions';

/**
 * One character of the recognized text, with where it is in `text` and on the picture. This is
 * what a dictionary lookup starts from: `start`/`end` index into `blocks[block].text`, the boxes
 * place it on screen, and `reading` is the furigana printed over the word it belongs to.
 */
export interface OcrCharacter {
  /** The character (one code point, e.g. `日`). */
  text: string;
  /** Position in the array returned by `getCharacters()`. */
  index: number;
  /** Index of the block in `result.blocks`. */
  block: number;
  /** Start in that block's `text` (UTF-16 index, like `String.slice`). */
  start: number;
  /** End in that block's `text`, exclusive. */
  end: number;
  /** Index of the line in `blocks[block].lines`. Absent when the character could not be located. */
  line?: number;
  /** Box in pixels of the recognized image. */
  boundingBox?: Rect;
  /** Box in CSS pixels of the WebView (live and capture results). */
  viewBoundingBox?: Rect;
  /** Index in `result.furigana` of the reading printed over the word this character belongs to. */
  furigana?: number;
  /** That reading, e.g. `にほん` for both `日` and `本` of `日本`. */
  reading?: string;
}

/** A sentence: text up to and including `。！？` (or the end of its block). */
export interface OcrSentence {
  /** The sentence, without leading or trailing spaces. */
  text: string;
  /** Index of the block in `result.blocks`. */
  block: number;
  /** Start in that block's `text` (UTF-16 index). */
  start: number;
  /** End in that block's `text`, exclusive. */
  end: number;
  /** Its characters, as `getCharacters()` returns them (with readings and boxes). */
  characters: OcrCharacter[];
  boundingBox?: Rect;
  viewBoundingBox?: Rect;
}

export interface CharacterAtOptions {
  /**
   * Which coordinates `point` is in: `view` for CSS pixels of the WebView (a tap on the live
   * camera picture), `image` for pixels of the recognized image.
   *
   * @default 'view' when the result has view boxes (live and capture results), otherwise 'image'
   */
  coordinates?: 'view' | 'image';
}

interface Glyph {
  char: string;
  line: number;
  box?: Rect;
  viewBox?: Rect;
}

const SPACE = /\s/u;

/** Characters of the block's lines, one per code point, in the order the lines hold them. */
function glyphsOf(block: OcrBlock): Glyph[] {
  const glyphs: Glyph[] = [];
  block.lines.forEach((line, lineIndex) => {
    for (const element of line.elements ?? []) {
      if (element.symbols?.length) {
        for (const symbol of element.symbols) {
          for (const char of Array.from(symbol.text)) {
            glyphs.push({ char, line: lineIndex, box: symbol.boundingBox, viewBox: symbol.viewBoundingBox });
          }
        }
        continue;
      }
      // No character boxes: share the element's box out over its characters.
      const chars = Array.from(element.text);
      chars.forEach((char, i) => {
        glyphs.push({
          char,
          line: lineIndex,
          box: slice(element.boundingBox, i, chars.length),
          viewBox: slice(element.viewBoundingBox, i, chars.length),
        });
      });
    }
  });
  return glyphs.filter((g) => !SPACE.test(g.char));
}

/** Part `i` of `count` of a box, along its longer side. */
function slice(box: Rect | undefined, i: number, count: number): Rect | undefined {
  if (!box || count <= 1) return box;
  if (box.right - box.left >= box.bottom - box.top) {
    const step = (box.right - box.left) / count;
    return { ...box, left: box.left + step * i, right: box.left + step * (i + 1) };
  }
  const step = (box.bottom - box.top) / count;
  return { ...box, top: box.top + step * i, bottom: box.top + step * (i + 1) };
}

/** How far ahead a character of `text` is searched among the boxes when they get out of step. */
const LOOKAHEAD = 4;

const cache = new WeakMap<OcrResult, OcrCharacter[]>();

/**
 * Every character of the result in reading order (spaces left out), each with its block and
 * position in the block's `text`, its box and the furigana reading over it.
 *
 * Works the same for both engines and for every result (live events, captures, images).
 *
 * ```ts
 * const chars = getCharacters(result);
 * const tapped = chars[5];
 * const rest = result.blocks[tapped.block].text.slice(tapped.start); // look up the longest word in rest
 * ```
 */
export function getCharacters(result: OcrResult): OcrCharacter[] {
  const cached = cache.get(result);
  if (cached) return cached;
  const characters: OcrCharacter[] = [];

  result.blocks.forEach((block, b) => {
    const glyphs = glyphsOf(block);
    const readings = (result.furigana ?? [])
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.block === b && f.start != null && f.end != null);
    let next = 0;
    let offset = 0;
    for (const char of Array.from(block.text)) {
      const start = offset;
      offset += char.length;
      if (SPACE.test(char)) continue;

      const character: OcrCharacter = { text: char, index: characters.length, block: b, start, end: offset };
      // The boxes follow the text, but a box may be missing or hold something the text does not.
      for (let k = next; k < glyphs.length && k < next + LOOKAHEAD; k++) {
        if (glyphs[k].char !== char) continue;
        const glyph = glyphs[k];
        character.line = glyph.line;
        if (glyph.box) character.boundingBox = glyph.box;
        if (glyph.viewBox) character.viewBoundingBox = glyph.viewBox;
        next = k + 1;
        break;
      }
      const ruby = readings.find(({ f }) => start >= f.start! && start < f.end!);
      if (ruby) {
        character.furigana = ruby.i;
        character.reading = ruby.f.text;
      }
      characters.push(character);
    }
  });

  cache.set(result, characters);
  return characters;
}

/**
 * The character at a point, e.g. where the user tapped. Returns the character whose box contains
 * the point, or the nearest one when the tap was just beside it; `undefined` when nothing is near.
 *
 * ```ts
 * layer.addEventListener('click', (e) => {
 *   const char = characterAt(result, { x: e.clientX, y: e.clientY });
 *   if (char) lookUp(result.blocks[char.block].text.slice(char.start));
 * });
 * ```
 */
export function characterAt(result: OcrResult, point: Point, options?: CharacterAtOptions): OcrCharacter | undefined {
  const characters = getCharacters(result);
  const coordinates = options?.coordinates ?? (characters.some((c) => c.viewBoundingBox) ? 'view' : 'image');
  const boxOf = (c: OcrCharacter) => (coordinates === 'view' ? c.viewBoundingBox : c.boundingBox);

  let best: OcrCharacter | undefined;
  let bestDistance = Infinity;
  for (const character of characters) {
    const box = boxOf(character);
    if (!box) continue;
    const size = Math.min(box.right - box.left, box.bottom - box.top);
    // Distance from the box's edge; 0 inside.
    const dx = Math.max(box.left - point.x, 0, point.x - box.right);
    const dy = Math.max(box.top - point.y, 0, point.y - box.bottom);
    const distance = Math.hypot(dx, dy);
    if (distance > size / 2) continue;
    // Inside several (overlapping) boxes: the one whose center is nearest.
    const center = Math.hypot((box.left + box.right) / 2 - point.x, (box.top + box.bottom) / 2 - point.y);
    const score = distance * 1000 + center;
    if (score < bestDistance) {
      bestDistance = score;
      best = character;
    }
  }
  return best;
}

/** End of a sentence. A full stop `.` only counts before a space or at the end (not in `3.5`). */
const TERMINATORS = new Set(['。', '．', '！', '？', '!', '?', '…', '‥', '｡']);
/** Closing brackets and quotes that still belong to the sentence before them. */
const CLOSING = new Set(['」', '』', '）', ')', '】', '〉', '》', '〕', '］', ']', '”', '’', '"', "'", '｣']);

/**
 * Splits the recognized text into sentences, in reading order. A sentence ends after `。！？…`
 * (with closing brackets like `」`) or at the end of its block; it never spans two blocks.
 *
 * ```ts
 * for (const sentence of getSentences(result)) translate(sentence.text);
 * ```
 */
export function getSentences(result: OcrResult): OcrSentence[] {
  const characters = getCharacters(result);
  const sentences: OcrSentence[] = [];

  result.blocks.forEach((block, b) => {
    const text = block.text;
    const ends: number[] = [];
    const chars = Array.from(text);
    let offset = 0;
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      offset += char.length;
      const nextChar = chars[i + 1];
      const terminates = TERMINATORS.has(char) || (char === '.' && (nextChar === undefined || SPACE.test(nextChar)));
      if (!terminates) continue;
      // Keep further terminators and closing brackets with this sentence: 「本当？！」
      while (i + 1 < chars.length && (TERMINATORS.has(chars[i + 1]) || CLOSING.has(chars[i + 1]))) {
        i++;
        offset += chars[i].length;
      }
      ends.push(offset);
    }
    if (!ends.length || ends[ends.length - 1] < text.length) ends.push(text.length);

    let start = 0;
    for (const end of ends) {
      const raw = text.slice(start, end);
      const lead = raw.length - raw.trimStart().length;
      const sentenceText = raw.trim();
      if (sentenceText) {
        const s = start + lead;
        const e = s + sentenceText.length;
        const own = characters.filter((c) => c.block === b && c.start >= s && c.end <= e);
        sentences.push({
          text: sentenceText,
          block: b,
          start: s,
          end: e,
          characters: own,
          ...boxes(own),
        });
      }
      start = end;
    }
  });
  return sentences;
}

function boxes(characters: OcrCharacter[]): Pick<OcrSentence, 'boundingBox' | 'viewBoundingBox'> {
  const result: Pick<OcrSentence, 'boundingBox' | 'viewBoundingBox'> = {};
  const box = union(characters.map((c) => c.boundingBox));
  const viewBox = union(characters.map((c) => c.viewBoundingBox));
  if (box) result.boundingBox = box;
  if (viewBox) result.viewBoundingBox = viewBox;
  return result;
}

function union(list: (Rect | undefined)[]): Rect | undefined {
  const present = list.filter((b): b is Rect => !!b);
  if (!present.length) return undefined;
  return {
    left: Math.min(...present.map((b) => b.left)),
    top: Math.min(...present.map((b) => b.top)),
    right: Math.max(...present.map((b) => b.right)),
    bottom: Math.max(...present.map((b) => b.bottom)),
  };
}
