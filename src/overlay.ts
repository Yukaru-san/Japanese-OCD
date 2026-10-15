import type { OcrLine, OcrResult, Rect } from 'capacitor-japanese-ocr';

import { glossary, glossaryKeys } from './dictionary';
import type { GlossaryEntry } from './dictionary';

/** One character of a line with its position in the WebView. */
interface Glyph {
  text: string;
  box?: Rect;
}

export interface WordMatch {
  word: string;
  entry: GlossaryEntry;
  box: Rect;
}

/** Splits a line into characters with WebView boxes, using symbols when ML Kit provides them. */
function glyphsOf(line: OcrLine): Glyph[] {
  const glyphs: Glyph[] = [];
  for (const element of line.elements) {
    if (element.symbols?.length) {
      for (const symbol of element.symbols) {
        glyphs.push({ text: symbol.text, box: symbol.viewBoundingBox });
      }
      continue;
    }
    // No symbols: split the element box evenly over its characters.
    const chars = Array.from(element.text);
    const box = element.viewBoundingBox;
    chars.forEach((text, i) => {
      if (!box) return glyphs.push({ text });
      const horizontal = box.right - box.left >= box.bottom - box.top;
      const step = (horizontal ? box.right - box.left : box.bottom - box.top) / chars.length;
      glyphs.push({
        text,
        box: horizontal
          ? { left: box.left + step * i, right: box.left + step * (i + 1), top: box.top, bottom: box.bottom }
          : { left: box.left, right: box.right, top: box.top + step * i, bottom: box.top + step * (i + 1) },
      });
    });
  }
  return glyphs;
}

function union(boxes: Rect[]): Rect {
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

/** Finds glossary words in the recognized text, with their position in the WebView. */
export function findWords(result: OcrResult): WordMatch[] {
  const matches: WordMatch[] = [];
  for (const block of result.blocks) {
    for (const line of block.lines) {
      const glyphs = glyphsOf(line);
      // Character index → glyph index, since a symbol may hold more than one code point.
      const owner: number[] = [];
      let text = '';
      glyphs.forEach((g, i) => {
        for (const c of Array.from(g.text)) {
          text += c;
          owner.push(i);
        }
      });
      const chars = Array.from(text);
      let i = 0;
      while (i < chars.length) {
        const word = glossaryKeys.find((key) => chars.slice(i, i + Array.from(key).length).join('') === key);
        if (!word) {
          i++;
          continue;
        }
        const length = Array.from(word).length;
        const boxes = [...new Set(owner.slice(i, i + length))]
          .map((g) => glyphs[g].box)
          .filter((b): b is Rect => !!b);
        if (boxes.length) {
          matches.push({ word, entry: glossary[word], box: union(boxes) });
        }
        i += length;
      }
    }
  }
  return matches;
}

/** Draws tappable markers over glossary words and opens an explanation on tap. */
export class WordOverlay {
  private readonly layer: HTMLElement;
  private readonly popup: HTMLElement;
  private openWord: string | null = null;

  constructor(layer: HTMLElement, popup: HTMLElement) {
    this.layer = layer;
    this.popup = popup;
    popup.addEventListener('click', () => this.closePopup());
  }

  render(result: OcrResult): WordMatch[] {
    const matches = findWords(result);
    this.layer.replaceChildren(
      ...matches.map((match) => {
        const marker = document.createElement('button');
        marker.className = 'word-marker';
        marker.dataset.word = match.word;
        marker.title = match.word;
        const pad = 4;
        Object.assign(marker.style, {
          left: `${match.box.left - pad}px`,
          top: `${match.box.top - pad}px`,
          width: `${match.box.right - match.box.left + pad * 2}px`,
          height: `${match.box.bottom - match.box.top + pad * 2}px`,
        });
        marker.addEventListener('click', (event) => {
          event.stopPropagation();
          this.openPopup(match);
        });
        return marker;
      }),
    );
    return matches;
  }

  clear(): void {
    this.layer.replaceChildren();
    this.closePopup();
  }

  private openPopup(match: WordMatch): void {
    this.openWord = match.word;
    this.popup.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = `${match.word} (${match.entry.reading})`;
    const meaning = document.createElement('div');
    meaning.className = 'meaning';
    meaning.textContent = match.entry.meaning;
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = match.entry.note;
    this.popup.append(title, meaning, note);
    const left = Math.max(8, Math.min(match.box.left, window.innerWidth - 248));
    const below = match.box.bottom + 8;
    Object.assign(this.popup.style, { left: `${left}px`, top: `${below}px` });
    this.popup.hidden = false;
  }

  private closePopup(): void {
    this.openWord = null;
    this.popup.hidden = true;
  }

  get shownWord(): string | null {
    return this.openWord;
  }
}
