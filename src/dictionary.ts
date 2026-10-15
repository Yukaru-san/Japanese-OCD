/**
 * The app's own glossary. Explanations come from here, not from ML Kit:
 * the plugin only recognizes the characters.
 */
export interface GlossaryEntry {
  reading: string;
  meaning: string;
  note: string;
}

export const glossary: Record<string, GlossaryEntry> = {
  せかい: { reading: 'sekai', meaning: 'Welt', note: 'Kanji: 世界. Bekannt aus こんにちは、せかい („Hallo Welt“).' },
  世界: { reading: 'sekai', meaning: 'Welt', note: 'Hiragana: せかい. 世 = Generation, 界 = Grenze/Bereich.' },
  こんにちは: { reading: 'konnichiwa', meaning: 'Guten Tag / Hallo', note: 'Das は wird hier „wa“ gelesen.' },
  ありがとう: { reading: 'arigatō', meaning: 'Danke', note: 'Höflicher: ありがとうございます.' },
  にほん: { reading: 'nihon', meaning: 'Japan', note: 'Kanji: 日本, wörtlich „Ursprung der Sonne“.' },
  日本: { reading: 'nihon', meaning: 'Japan', note: '日 = Sonne/Tag, 本 = Ursprung/Buch.' },
  ねこ: { reading: 'neko', meaning: 'Katze', note: 'Kanji: 猫.' },
  猫: { reading: 'neko', meaning: 'Katze', note: 'Hiragana: ねこ.' },
  日本語: { reading: 'nihongo', meaning: 'Japanisch (Sprache)', note: '語 = Sprache/Wort.' },
  勉強: { reading: 'benkyō', meaning: 'Lernen', note: 'Oft als 勉強する („lernen“).' },
};

/** Longest keys first, so 日本語 wins over 日本. */
export const glossaryKeys = Object.keys(glossary).sort((a, b) => b.length - a.length);
