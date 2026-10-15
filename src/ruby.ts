import type { OcrBlock, OcrResult } from './definitions';

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

/**
 * Renders recognized text as HTML with furigana in `<ruby>` tags, e.g.
 * `<ruby>日本<rt>にほん</rt></ruby>の…`. Text is escaped; blocks are separated by `<br>`.
 */
export function toRubyHtml(source: OcrResult | OcrBlock): string {
  const blocks = 'blocks' in source ? source.blocks : [source];
  return blocks
    .map((block) =>
      (block.segments ?? [{ text: block.text }])
        .map((s) => (s.reading ? `<ruby>${escape(s.text)}<rt>${escape(s.reading)}</rt></ruby>` : escape(s.text)))
        .join(''),
    )
    .join('<br>');
}
