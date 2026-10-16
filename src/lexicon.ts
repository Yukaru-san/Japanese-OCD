// A small built-in sample dictionary for the "Wörterbuch" demo: words, kanji and a simple lookup
// with longest match and a few conjugation rules. It stands in for your own dictionary: the
// plugin only delivers characters, readings and positions; meanings come from here.

export interface WordEntry {
  word: string;
  /** Reading in hiragana (katakana for loan words). */
  reading: string;
  meanings: string[];
  /** Part of speech, in German. */
  pos: string;
  jlpt?: number;
  note?: string;
}

export interface KanjiEntry {
  kanji: string;
  meanings: string[];
  /** Sino-Japanese readings (katakana). */
  on: string[];
  /** Japanese readings (hiragana; okurigana after the dot). */
  kun: string[];
  strokes: number;
  jlpt?: number;
}

const w = (word: string, reading: string, pos: string, meanings: string[], jlpt?: number, note?: string): WordEntry => ({
  word,
  reading,
  pos,
  meanings,
  jlpt,
  note,
});

export const WORDS: WordEntry[] = [
  w('こんにちは', 'こんにちは', 'Begrüßung', ['Guten Tag', 'Hallo'], 5, 'Das は wird hier „wa“ gelesen.'),
  w('ありがとう', 'ありがとう', 'Ausdruck', ['Danke'], 5, 'Höflicher: ありがとうございます.'),
  w('世界', 'せかい', 'Nomen', ['Welt'], 4),
  w('せかい', 'せかい', 'Nomen', ['Welt'], 4, 'In Kanji: 世界.'),
  w('日本', 'にほん', 'Nomen (Eigenname)', ['Japan'], 5, 'Wörtlich „Ursprung der Sonne“.'),
  w('日本語', 'にほんご', 'Nomen', ['Japanisch (Sprache)'], 5),
  w('勉強', 'べんきょう', 'Nomen, する-Verb', ['Lernen', 'Studium'], 5, 'Meist als 勉強する („lernen“).'),
  w('する', 'する', 'Verb (unregelmäßig)', ['tun', 'machen'], 5),
  w('猫', 'ねこ', 'Nomen', ['Katze'], 5),
  w('ねこ', 'ねこ', 'Nomen', ['Katze'], 5, 'In Kanji: 猫.'),
  w('犬', 'いぬ', 'Nomen', ['Hund'], 5),
  w('なぜ', 'なぜ', 'Adverb', ['warum'], 4),
  w('学校', 'がっこう', 'Nomen', ['Schule'], 5),
  w('学生', 'がくせい', 'Nomen', ['Student', 'Schüler'], 5),
  w('先生', 'せんせい', 'Nomen', ['Lehrer', 'Lehrerin'], 5),
  w('女子', 'じょし', 'Nomen', ['Mädchen', 'Frauen'], 2),
  w('ポニーテール', 'ポニーテール', 'Nomen', ['Pferdeschwanz (Frisur)'], undefined, 'Lehnwort aus dem Englischen „ponytail“.'),
  w('禁止', 'きんし', 'Nomen, する-Verb', ['Verbot'], 3, '禁止される = verboten werden.'),
  w('今日', 'きょう', 'Nomen', ['heute'], 5, 'Unregelmäßige Lesung: nicht こんにち.'),
  w('天気', 'てんき', 'Nomen', ['Wetter'], 5),
  w('新聞', 'しんぶん', 'Nomen', ['Zeitung'], 5),
  w('本', 'ほん', 'Nomen', ['Buch'], 5),
  w('人', 'ひと', 'Nomen', ['Mensch', 'Person'], 5),
  w('言葉', 'ことば', 'Nomen', ['Wort', 'Sprache'], 4),
  w('漢字', 'かんじ', 'Nomen', ['Kanji', 'chinesisches Schriftzeichen'], 5),
  w('電車', 'でんしゃ', 'Nomen', ['Zug', 'Bahn'], 5),
  w('駅', 'えき', 'Nomen', ['Bahnhof'], 5),
  w('東京', 'とうきょう', 'Nomen (Eigenname)', ['Tokio'], 5),
  w('時間', 'じかん', 'Nomen', ['Zeit', 'Stunde'], 5),
  w('会社', 'かいしゃ', 'Nomen', ['Firma'], 5),
  w('仕事', 'しごと', 'Nomen', ['Arbeit'], 5),
  w('毎日', 'まいにち', 'Nomen, Adverb', ['jeden Tag'], 5),
  w('友達', 'ともだち', 'Nomen', ['Freund', 'Freundin'], 5),
  w('水', 'みず', 'Nomen', ['Wasser'], 5),
  w('読む', 'よむ', 'Verb (godan)', ['lesen'], 5),
  w('食べる', 'たべる', 'Verb (ichidan)', ['essen'], 5),
  w('見る', 'みる', 'Verb (ichidan)', ['sehen', 'anschauen'], 5),
  w('行く', 'いく', 'Verb (godan)', ['gehen', 'fahren'], 5),
  w('書く', 'かく', 'Verb (godan)', ['schreiben'], 5),
  w('言う', 'いう', 'Verb (godan)', ['sagen'], 5),
  w('いる', 'いる', 'Verb (ichidan)', ['sein, sich befinden (Lebewesen)'], 5, 'Nach て-Form: Verlaufsform (〜ている).'),
  w('大きい', 'おおきい', 'い-Adjektiv', ['groß'], 5),
  w('小さい', 'ちいさい', 'い-Adjektiv', ['klein'], 5),
  w('新しい', 'あたらしい', 'い-Adjektiv', ['neu'], 5),
  w('です', 'です', 'Kopula', ['sein (höflich)'], 5),
  w('の', 'の', 'Partikel', ['Genitiv / Attribut („von“)', 'am Satzende: Frage oder Erklärung'], 5),
  w('は', 'は', 'Partikel', ['Thema („was … betrifft“)'], 5, 'Als Partikel „wa“ gelesen.'),
  w('が', 'が', 'Partikel', ['Subjekt'], 5),
  w('を', 'を', 'Partikel', ['direktes Objekt'], 5, 'Gelesen „o“.'),
  w('に', 'に', 'Partikel', ['Ziel, Zeitpunkt („nach“, „um“)'], 5),
  w('で', 'で', 'Partikel', ['Ort einer Handlung, Mittel („in“, „mit“)'], 5),
  w('では', 'では', 'Partikel', ['in … (betont)', 'also'], 5),
  w('と', 'と', 'Partikel', ['und', 'mit', 'Zitat („dass“)'], 5),
  w('も', 'も', 'Partikel', ['auch'], 5),
  w('か', 'か', 'Partikel', ['Fragepartikel'], 5),
];

const k = (kanji: string, strokes: number, meanings: string[], on: string[], kun: string[], jlpt?: number): KanjiEntry => ({
  kanji,
  strokes,
  meanings,
  on,
  kun,
  jlpt,
});

export const KANJI: KanjiEntry[] = [
  k('日', 4, ['Sonne', 'Tag'], ['ニチ', 'ジツ'], ['ひ', 'か'], 5),
  k('本', 5, ['Buch', 'Ursprung'], ['ホン'], ['もと'], 5),
  k('語', 14, ['Sprache', 'Wort'], ['ゴ'], ['かた.る'], 5),
  k('世', 5, ['Welt', 'Generation'], ['セイ', 'セ'], ['よ'], 4),
  k('界', 9, ['Welt', 'Grenze'], ['カイ'], [], 3),
  k('勉', 10, ['sich anstrengen'], ['ベン'], [], 4),
  k('強', 11, ['stark'], ['キョウ', 'ゴウ'], ['つよ.い'], 4),
  k('猫', 11, ['Katze'], ['ビョウ'], ['ねこ'], 2),
  k('犬', 4, ['Hund'], ['ケン'], ['いぬ'], 5),
  k('学', 8, ['lernen', 'Wissenschaft'], ['ガク'], ['まな.ぶ'], 5),
  k('校', 10, ['Schule'], ['コウ'], [], 5),
  k('生', 5, ['Leben', 'geboren werden'], ['セイ', 'ショウ'], ['い.きる', 'う.まれる', 'なま'], 5),
  k('先', 6, ['vorher', 'Spitze'], ['セン'], ['さき'], 5),
  k('女', 3, ['Frau'], ['ジョ', 'ニョ'], ['おんな'], 5),
  k('子', 3, ['Kind'], ['シ', 'ス'], ['こ'], 5),
  k('禁', 13, ['verbieten'], ['キン'], [], 2),
  k('止', 4, ['anhalten', 'aufhören'], ['シ'], ['と.まる', 'と.める'], 4),
  k('今', 4, ['jetzt'], ['コン', 'キン'], ['いま'], 5),
  k('天', 4, ['Himmel'], ['テン'], ['あま'], 5),
  k('気', 6, ['Geist', 'Luft', 'Stimmung'], ['キ', 'ケ'], [], 5),
  k('新', 13, ['neu'], ['シン'], ['あたら.しい'], 5),
  k('聞', 14, ['hören', 'fragen'], ['ブン', 'モン'], ['き.く'], 5),
  k('人', 2, ['Mensch'], ['ジン', 'ニン'], ['ひと'], 5),
  k('言', 7, ['sagen', 'Wort'], ['ゲン', 'ゴン'], ['い.う', 'こと'], 5),
  k('葉', 12, ['Blatt'], ['ヨウ'], ['は'], 3),
  k('漢', 13, ['China (Han)'], ['カン'], [], 3),
  k('字', 6, ['Schriftzeichen'], ['ジ'], ['あざ'], 4),
  k('電', 13, ['Elektrizität'], ['デン'], [], 5),
  k('車', 7, ['Wagen', 'Auto'], ['シャ'], ['くるま'], 5),
  k('駅', 14, ['Bahnhof'], ['エキ'], [], 5),
  k('東', 8, ['Osten'], ['トウ'], ['ひがし'], 5),
  k('京', 8, ['Hauptstadt'], ['キョウ', 'ケイ'], [], 4),
  k('時', 10, ['Zeit', 'Stunde'], ['ジ'], ['とき'], 5),
  k('間', 12, ['Zwischenraum', 'Dauer'], ['カン', 'ケン'], ['あいだ', 'ま'], 5),
  k('会', 6, ['treffen', 'Versammlung'], ['カイ', 'エ'], ['あ.う'], 5),
  k('社', 7, ['Firma', 'Schrein'], ['シャ'], ['やしろ'], 5),
  k('仕', 5, ['dienen'], ['シ', 'ジ'], ['つか.える'], 4),
  k('事', 8, ['Sache', 'Angelegenheit'], ['ジ', 'ズ'], ['こと'], 4),
  k('毎', 6, ['jeder'], ['マイ'], [], 5),
  k('友', 4, ['Freund'], ['ユウ'], ['とも'], 5),
  k('達', 12, ['erreichen', 'Plural (Personen)'], ['タツ', 'ダ'], [], 4),
  k('水', 4, ['Wasser'], ['スイ'], ['みず'], 5),
  k('読', 14, ['lesen'], ['ドク', 'トク'], ['よ.む'], 5),
  k('食', 9, ['essen'], ['ショク'], ['た.べる', 'く.う'], 5),
  k('見', 7, ['sehen'], ['ケン'], ['み.る'], 5),
  k('行', 6, ['gehen'], ['コウ', 'ギョウ'], ['い.く', 'おこな.う'], 5),
  k('書', 10, ['schreiben'], ['ショ'], ['か.く'], 5),
  k('大', 3, ['groß'], ['ダイ', 'タイ'], ['おお.きい'], 5),
  k('小', 3, ['klein'], ['ショウ'], ['ちい.さい', 'こ'], 5),
];

const byWord = new Map<string, WordEntry[]>();
for (const entry of WORDS) byWord.set(entry.word, [...(byWord.get(entry.word) ?? []), entry]);
const byKanji = new Map(KANJI.map((entry) => [entry.kanji, entry]));

export function kanjiInfo(char: string): KanjiEntry | undefined {
  return byKanji.get(char);
}

export function isKanji(char: string): boolean {
  return /\p{Script=Han}/u.test(char);
}

/** Conjugated ending → dictionary-form ending, with what the form means. Longest endings first. */
const RULES: [string, string, string][] = [
  ['されていた', 'する', 'Passiv, Verlauf, Vergangenheit'],
  ['しています', 'する', 'Verlaufsform, höflich'],
  ['している', 'する', 'Verlaufsform'],
  ['されている', 'する', 'Passiv, Verlauf'],
  ['された', 'する', 'Passiv, Vergangenheit'],
  ['される', 'する', 'Passiv'],
  ['しました', 'する', 'Vergangenheit, höflich'],
  ['します', 'する', 'höflich'],
  ['しない', 'する', 'Verneinung'],
  ['した', 'する', 'Vergangenheit'],
  ['して', 'する', 'て-Form'],
  ['みました', 'む', 'Vergangenheit, höflich'],
  ['みます', 'む', 'höflich'],
  ['んでいる', 'む', 'Verlaufsform'],
  ['んだ', 'む', 'Vergangenheit'],
  ['んで', 'む', 'て-Form'],
  ['まない', 'む', 'Verneinung'],
  ['きました', 'く', 'Vergangenheit, höflich'],
  ['きます', 'く', 'höflich'],
  ['いている', 'く', 'Verlaufsform'],
  ['いた', 'く', 'Vergangenheit'],
  ['いて', 'く', 'て-Form'],
  ['かない', 'く', 'Verneinung'],
  ['いました', 'う', 'Vergangenheit, höflich'],
  ['います', 'う', 'höflich'],
  ['った', 'う', 'Vergangenheit'],
  ['って', 'う', 'て-Form'],
  ['わない', 'う', 'Verneinung'],
  ['ていました', 'る', 'Verlaufsform, Vergangenheit, höflich'],
  ['ています', 'る', 'Verlaufsform, höflich'],
  ['ていた', 'る', 'Verlaufsform, Vergangenheit'],
  ['ている', 'る', 'Verlaufsform'],
  ['ました', 'る', 'Vergangenheit, höflich'],
  ['ません', 'る', 'Verneinung, höflich'],
  ['ます', 'る', 'höflich'],
  ['ない', 'る', 'Verneinung'],
  ['た', 'る', 'Vergangenheit'],
  ['て', 'る', 'て-Form'],
  ['くない', 'い', 'Verneinung'],
  ['かった', 'い', 'Vergangenheit'],
  ['くて', 'い', 'て-Form'],
];

export interface Match {
  /** The text as written, e.g. 読みます. */
  surface: string;
  entries: WordEntry[];
  /** How the surface differs from the dictionary form, when it was conjugated. */
  form?: string;
}

/** Dictionary forms the text could be a conjugation of. */
function deinflect(text: string): { base: string; form: string }[] {
  const found: { base: string; form: string }[] = [];
  for (const [ending, replacement, form] of RULES) {
    if (text.length > ending.length - (replacement === 'する' ? 1 : 0) && text.endsWith(ending)) {
      found.push({ base: text.slice(0, text.length - ending.length) + replacement, form });
    }
  }
  return found;
}

const MAX_WORD = 12;

/**
 * The longest word at the start of `text`: what a tap on a character looks up. `text` is the
 * rest of the block from the tapped character on.
 */
export function longestMatch(text: string): Match | undefined {
  const chars = Array.from(text.replace(/\s+/g, ''));
  for (let length = Math.min(MAX_WORD, chars.length); length > 0; length--) {
    const surface = chars.slice(0, length).join('');
    const exact = byWord.get(surface);
    if (exact) return { surface, entries: exact };
    for (const { base, form } of deinflect(surface)) {
      const entries = byWord.get(base);
      if (entries) return { surface, entries, form };
    }
  }
  return undefined;
}

export interface Token {
  text: string;
  match?: Match;
}

const PUNCTUATION = /^[\p{P}\p{S}\s]$/u;

/** Splits a sentence into known words and the characters in between (greedy longest match). */
export function tokenize(sentence: string): Token[] {
  const tokens: Token[] = [];
  const chars = Array.from(sentence.replace(/\s+/g, ''));
  let i = 0;
  while (i < chars.length) {
    const match = PUNCTUATION.test(chars[i]) ? undefined : longestMatch(chars.slice(i).join(''));
    if (match) {
      tokens.push({ text: match.surface, match });
      i += Array.from(match.surface).length;
      continue;
    }
    // Unknown: glue to the previous unknown piece of the same kind.
    const last = tokens[tokens.length - 1];
    if (last && !last.match && !PUNCTUATION.test(chars[i]) && !PUNCTUATION.test(last.text.slice(-1))) {
      last.text += chars[i];
    } else {
      tokens.push({ text: chars[i] });
    }
    i++;
  }
  return tokens;
}

export interface SearchResult {
  words: WordEntry[];
  kanji: KanjiEntry[];
}

/**
 * Search box: by word (also conjugated), reading, German meaning, or kanji. Returns the words and
 * the kanji they contain.
 */
export function search(query: string): SearchResult {
  const q = query.trim();
  if (!q) return { words: [], kanji: [] };
  const lower = q.toLowerCase();
  const words = new Set<WordEntry>();
  longestMatch(q)?.entries.forEach((e) => words.add(e));
  for (const entry of WORDS) {
    if (entry.word === q || entry.reading === q) words.add(entry);
    else if (/^\p{Script=Latin}/u.test(q) && entry.meanings.some((m) => m.toLowerCase().includes(lower))) words.add(entry);
    else if (Array.from(q).length === 1 && isKanji(q) && entry.word.includes(q)) words.add(entry);
  }
  const kanji = [...new Set(Array.from(q).filter(isKanji))].map(kanjiInfo).filter((e): e is KanjiEntry => !!e);
  return { words: [...words], kanji };
}
