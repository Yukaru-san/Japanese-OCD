// Exports of both entries (`capacitor-japanese-ocr` and `capacitor-japanese-ocr/native`) besides the plugin object.
export * from './definitions';
export { findText } from './find-text';
export type { TextMatch } from './find-text';
export { toRubyHtml } from './ruby';
export { LiveStabilizer } from './live-stabilizer';
export { characterAt, getCharacters, getSentences } from './text-index';
export type { CharacterAtOptions, OcrCharacter, OcrSentence } from './text-index';
export { isJapaneseOcrError } from './errors';
