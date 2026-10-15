import type { OcrLine, OcrResult, Rect } from './definitions';

export interface TextMatch {
  /** The text that was found, as written in the result. */
  text: string;
  /** Box around the found characters in the recognized image. */
  boundingBox?: Rect;
  /** Box around the found characters in CSS pixels of the WebView (live and capture results). */
  viewBoundingBox?: Rect;
  /** The line the match is in. */
  line: OcrLine;
}

interface Glyph {
  text: string;
  box?: Rect;
  viewBox?: Rect;
}

function glyphsOf(line: OcrLine): Glyph[] {
  const glyphs: Glyph[] = [];
  for (const element of line.elements) {
    if (element.symbols?.length) {
      for (const symbol of element.symbols) {
        glyphs.push({ text: symbol.text, box: symbol.boundingBox, viewBox: symbol.viewBoundingBox });
      }
    } else {
      glyphs.push({ text: element.text, box: element.boundingBox, viewBox: element.viewBoundingBox });
    }
  }
  return glyphs;
}

function union(boxes: (Rect | undefined)[]): Rect | undefined {
  const present = boxes.filter((b): b is Rect => !!b);
  if (!present.length) return undefined;
  return {
    left: Math.min(...present.map((b) => b.left)),
    top: Math.min(...present.map((b) => b.top)),
    right: Math.max(...present.map((b) => b.right)),
    bottom: Math.max(...present.map((b) => b.bottom)),
  };
}

/**
 * Finds every occurrence of `query` in a result and returns where it is, so the page can
 * highlight it. Spaces are ignored on both sides, matching works across element borders
 * within a line.
 *
 * ```ts
 * for (const match of findText(result, 'せかい')) {
 *   const box = match.viewBoundingBox; // place your marker here
 * }
 * ```
 */
export function findText(result: OcrResult, query: string): TextMatch[] {
  const needle = Array.from(query.replace(/\s+/g, ''));
  if (!needle.length) return [];
  const matches: TextMatch[] = [];

  for (const block of result.blocks) {
    for (const line of block.lines) {
      const glyphs = glyphsOf(line);
      // One entry per character (code point), pointing to the glyph it belongs to.
      const chars: { char: string; glyph: number }[] = [];
      glyphs.forEach((glyph, index) => {
        for (const char of Array.from(glyph.text.replace(/\s+/g, ''))) chars.push({ char, glyph: index });
      });

      for (let i = 0; i + needle.length <= chars.length; i++) {
        if (!needle.every((c, k) => chars[i + k].char === c)) continue;
        const used = [...new Set(chars.slice(i, i + needle.length).map((c) => c.glyph))].map((g) => glyphs[g]);
        matches.push({
          text: query,
          boundingBox: union(used.map((g) => g.box)),
          viewBoundingBox: union(used.map((g) => g.viewBox)),
          line,
        });
        i += needle.length - 1;
      }
    }
  }
  return matches;
}
