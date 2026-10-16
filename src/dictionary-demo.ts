// The "Wörterbuch" section: shows how an app connects its own dictionary to the plugin's results.
// The recognized text is drawn character by character (getCharacters / getSentences); tapping a
// character, a spot on the photo (characterAt) or a sentence looks it up in the sample dictionary
// in lexicon.ts. Search works without OCR, too.
import { characterAt, getCharacters, getSentences } from 'capacitor-japanese-ocr';
import type { OcrCharacter, OcrResult, OcrSentence } from 'capacitor-japanese-ocr';

import { isKanji, kanjiInfo, longestMatch, search, tokenize } from './lexicon';
import type { KanjiEntry, Match, WordEntry } from './lexicon';
import { $ } from './ui';

let current: OcrResult | null = null;

type Child = Node | string | null | undefined | false;

function el(tag: string, className?: string, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) if (child) node.append(child);
  return node;
}

function kanjiCard(entry: KanjiEntry): HTMLElement {
  const readings = [
    entry.on.length ? `On: ${entry.on.join('、')}` : '',
    entry.kun.length ? `Kun: ${entry.kun.join('、')}` : '',
  ].filter(Boolean);
  return el(
    'div',
    'kanji',
    el('span', 'kanji-char', entry.kanji),
    el(
      'div',
      '',
      el('div', 'meaning', entry.meanings.join(', ')),
      el('div', 'muted', [...readings, `${entry.strokes} Striche`, entry.jlpt ? `JLPT N${entry.jlpt}` : ''].filter(Boolean).join(' · ')),
    ),
  );
}

/** Kanji of a word with their info; kanji missing from the sample dictionary are listed by name. */
function kanjiOf(word: string): HTMLElement[] {
  return [...new Set(Array.from(word).filter(isKanji))].map((char) => {
    const info = kanjiInfo(char);
    return info ? kanjiCard(info) : el('div', 'kanji muted', `${char}: nicht im Beispiel-Wörterbuch`);
  });
}

function wordCard(entry: WordEntry, ocrReading?: string): HTMLElement {
  const head = el('div', 'entry-head', el('strong', '', entry.word));
  if (entry.reading !== entry.word) head.append(el('span', 'reading', `【${entry.reading}】`));
  head.append(el('span', 'muted', [entry.pos, entry.jlpt ? `N${entry.jlpt}` : ''].filter(Boolean).join(' · ')));
  const card = el('div', 'entry', head, el('ol', 'meanings', ...entry.meanings.map((m) => el('li', '', m))));
  if (entry.note) card.append(el('div', 'note', entry.note));
  if (ocrReading) {
    const same = ocrReading === entry.reading;
    card.append(el('div', same ? 'ocr-reading' : 'ocr-reading differs', `Furigana im Bild: ${ocrReading}${same ? ' ✓' : ' (weicht vom Wörterbuch ab)'}`));
  }
  card.append(...kanjiOf(entry.word));
  return card;
}

function matchCard(match: Match, ocrReading?: string): HTMLElement[] {
  const cards: HTMLElement[] = [];
  if (match.form) {
    cards.push(el('div', 'form', `${match.surface} → Grundform ${match.entries[0].word} (${match.form})`));
  }
  cards.push(...match.entries.map((entry) => wordCard(entry, ocrReading)));
  return cards;
}

function show(...nodes: Child[]): void {
  const panel = $('dict-entry');
  panel.replaceChildren(...nodes.filter((n): n is Node | string => !!n));
  panel.hidden = false;
}

/** Marks characters `from`…`to` (indexes of getCharacters) in the drawn text. */
function highlight(from = -1, to = -1): void {
  for (const span of $('dict-text').querySelectorAll<HTMLElement>('[data-i]')) {
    const i = Number(span.dataset.i);
    span.classList.toggle('hit', i >= from && i < to);
  }
}

/**
 * A tapped character: the longest dictionary word that starts there, else the kanji alone. Inside
 * a word with furigana (日本語 under にほんご) the lookup starts at the word, wherever it was tapped.
 */
export function lookUpCharacter(result: OcrResult, char: OcrCharacter): void {
  const block = result.blocks[char.block].text;
  const ruby = char.furigana != null ? result.furigana[char.furigana] : undefined;
  if (ruby?.start != null && ruby.end != null) {
    const match = longestMatch(block.slice(ruby.start));
    const first = getCharacters(result).find((c) => c.block === char.block && c.start === ruby.start);
    if (match && first && match.surface.length >= ruby.end - ruby.start - (block.slice(ruby.start, ruby.end).match(/\s/g)?.length ?? 0)) {
      highlight(first.index, first.index + Array.from(match.surface).length);
      show(...matchCard(match, char.reading));
      return;
    }
  }
  const match = longestMatch(block.slice(char.start));
  if (match) {
    highlight(char.index, char.index + Array.from(match.surface).length);
    // The furigana belongs to the whole word; only compare it when the match starts there.
    show(...matchCard(match, ruby?.start === char.start ? char.reading : undefined));
    return;
  }
  highlight(char.index, char.index + 1);
  const info = isKanji(char.text) ? kanjiInfo(char.text) : undefined;
  show(info ? kanjiCard(info) : el('div', 'muted', `„${char.text}“ ist nicht im Beispiel-Wörterbuch.`));
}

/** A sentence split into words, each tappable, with the word list below. */
function sentenceCard(text: string, sentence?: OcrSentence): HTMLElement[] {
  const tokens = tokenize(text);
  const details = el('div', 'token-details');
  // Tokens and the sentence's characters both leave spaces out, so they run in step.
  let position = 0;
  const chips = tokens.map((token) => {
    const first = sentence?.characters[position];
    position += Array.from(token.text).length;
    const chip = el('button', token.match ? 'token known' : 'token', token.text);
    chip.onclick = () => {
      // The reading the picture shows for this word, when the sentence came from OCR.
      const ocrReading = first?.reading;
      details.replaceChildren(
        ...(token.match
          ? matchCard(token.match, ocrReading)
          : kanjiOf(token.text).length
            ? kanjiOf(token.text)
            : [el('div', 'muted', `„${token.text}“ ist nicht im Beispiel-Wörterbuch.`)]),
      );
    };
    return chip;
  });
  const gloss = tokens
    .filter((t) => t.match)
    .map((t) => `${t.text} = ${t.match!.entries[0].meanings[0]}`)
    .join(' · ');
  return [
    el('div', 'sentence-title', text),
    el('div', 'tokens', ...chips),
    el('div', 'gloss muted', gloss || 'Keine Wörter aus dem Beispiel-Wörterbuch gefunden.'),
    details,
  ];
}

function lookUpSentence(sentence: OcrSentence): void {
  highlight(sentence.characters[0]?.index ?? -1, (sentence.characters[sentence.characters.length - 1]?.index ?? -2) + 1);
  show(...sentenceCard(sentence.text, sentence));
}

/** Draws the sentences of a result with tappable characters and their furigana as ruby. */
function renderText(result: OcrResult): void {
  const sentences = getSentences(result);
  const rows = sentences.map((sentence) => {
    const line = el('div', 'chars');
    // One <ruby> per furigana; its characters stay separately tappable.
    let ruby = null as { node: HTMLElement; furigana: number } | null;
    for (const char of sentence.characters) {
      const span = el('span', 'char', char.text);
      span.dataset.i = String(char.index);
      span.onclick = () => lookUpCharacter(result, char);
      if (char.furigana == null) {
        ruby = null;
        line.append(span);
        continue;
      }
      if (ruby?.furigana !== char.furigana) {
        ruby = { node: el('ruby'), furigana: char.furigana };
        ruby.node.append(span, el('rt', '', char.reading));
        line.append(ruby.node);
      } else {
        ruby.node.insertBefore(span, ruby.node.lastChild);
      }
    }
    const button = el('button', 'sentence-button', 'Satz');
    button.title = 'Satz nachschlagen';
    button.onclick = () => lookUpSentence(sentence);
    return el('div', 'sentence', line, button);
  });
  $('dict-text').replaceChildren(
    ...(rows.length ? rows : [el('p', 'muted', 'Kein Text erkannt.')]),
  );
}

/** Called with every result shown in the "Ergebnis" section. */
export function showDictionaryResult(result: OcrResult): void {
  current = result;
  renderText(result);
  $('dict-entry').hidden = true;
  $('dict-hint').textContent = `${getCharacters(result).length} Zeichen, ${getSentences(result).length} Sätze. Zeichen antippen, „Satz“ für den ganzen Satz${result.blocks.length ? ', oder auf dem Foto antippen' : ''}.`;
}

function runSearch(): void {
  const query = $<HTMLInputElement>('dict-query').value.trim();
  if (!query) return;
  highlight();
  // One (possibly conjugated) word: its entry, with the dictionary form.
  const whole = longestMatch(query);
  if (whole && whole.surface === query.replace(/\s+/g, '')) {
    show(...matchCard(whole));
    return;
  }
  const found = search(query);
  const cards: HTMLElement[] = found.words.map((entry) => wordCard(entry));
  const shownKanji = new Set(found.words.flatMap((e) => Array.from(e.word)));
  cards.push(...found.kanji.filter((k) => !shownKanji.has(k.kanji)).map(kanjiCard));
  // Longer Japanese text: look it up as a sentence.
  const japanese = !/\p{Script=Latin}/u.test(query);
  if (japanese && (Array.from(query).length > 4 || (!found.words.length && Array.from(query).length > 1))) {
    show(...sentenceCard(query), ...(found.words.length ? [el('h3', '', 'Treffer'), ...cards] : []));
    return;
  }
  show(...(cards.length ? cards : [el('div', 'muted', `Nichts zu „${query}“ im Beispiel-Wörterbuch.`)]));
}

/** A tap on the photo: the character there, found with characterAt in image pixels. */
function tapOnImage(event: MouseEvent): void {
  const image = event.currentTarget as HTMLImageElement;
  if (!current || !image.naturalWidth) return;
  const rect = image.getBoundingClientRect();
  // The photo is shown scaled; result coordinates are pixels of the recognized (upright) image.
  const scaleX = current.imageWidth / rect.width;
  const scaleY = current.imageHeight / rect.height;
  const point = { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
  const char = characterAt(current, point, { coordinates: 'image' });
  if (char) {
    lookUpCharacter(current, char);
    $('dict-entry').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

export function initDictionary(): void {
  $('dict-search').onclick = runSearch;
  $<HTMLInputElement>('dict-query').onkeydown = (event) => {
    if (event.key === 'Enter') runSearch();
  };
  $('captured-image').addEventListener('click', tapOnImage);
}
