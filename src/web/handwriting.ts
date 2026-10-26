/**
 * Handwriting for the web engine: the strokes are drawn as an image, row by row, and read with
 * the PaddleOCR recognizer. Rows and candidate combination work like `InkLines.java`.
 */
import type { HandwritingCandidate, HandwritingResult, InkStroke } from '../handwriting';

import type { PaddleEngine, RgbaImage } from './paddle';

interface Candidate {
  text: string;
  /** Lower is better: -ln(probability). */
  score: number;
}

/** Height in pixels a row is drawn at, before the recognizer scales it to its input size. */
const ROW_PIXELS = 96;

/**
 * Groups strokes into rows written one below the other. Strokes whose vertical extents overlap
 * belong to the same row. Rows are returned top to bottom; each keeps its strokes in drawing order.
 */
export function rows(strokes: InkStroke[]): number[][] {
  const spans = strokes.map((s, stroke) => ({
    stroke,
    top: Math.min(...s.points.map((p) => p.y)),
    bottom: Math.max(...s.points.map((p) => p.y)),
  }));
  spans.sort((a, b) => a.top - b.top);
  const result: number[][] = [];
  let rowBottom = -Infinity;
  let row: number[] | null = null;
  for (const span of spans) {
    if (row == null || span.top > rowBottom) {
      row = [];
      result.push(row);
      rowBottom = span.bottom;
    } else {
      rowBottom = Math.max(rowBottom, span.bottom);
    }
    row.push(span.stroke);
  }
  for (const r of result) r.sort((a, b) => a - b);
  return result;
}

/**
 * Rows made of flat strokes only (like the bars of 三) are parts of the characters above or
 * below them, not rows of their own: they are joined with the neighbouring row.
 */
function mergeFlatRows(strokes: InkStroke[], groups: number[][]): number[][] {
  const extent = (indexes: number[]) => {
    const ys = indexes.flatMap((i) => strokes[i].points.map((p) => p.y));
    return { top: Math.min(...ys), bottom: Math.max(...ys) };
  };
  // Size of a character: the largest stroke in either direction.
  const size = Math.max(
    ...strokes.map((s) => {
      const xs = s.points.map((p) => p.x);
      const ys = s.points.map((p) => p.y);
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    }),
  );
  const result: number[][] = [];
  for (const group of groups) {
    const previous = result[result.length - 1];
    if (previous) {
      const a = extent(previous);
      const b = extent(group);
      const flat = a.bottom - a.top < size / 2 || b.bottom - b.top < size / 2;
      if (flat && b.top - a.bottom < size) {
        previous.push(...group);
        previous.sort((x, y) => x - y);
        continue;
      }
    }
    result.push([...group]);
  }
  return result;
}

/**
 * Draws the strokes of one row as dark ink on white. With `areaHeight` (one row only), the full
 * height of the drawing area is kept, so small kana stay small.
 */
function drawRow(strokes: InkStroke[], areaHeight: number | null): RgbaImage {
  const points = strokes.flatMap((s) => s.points);
  const left = Math.min(...points.map((p) => p.x));
  const right = Math.max(...points.map((p) => p.x));
  let top = Math.min(...points.map((p) => p.y));
  let bottom = Math.max(...points.map((p) => p.y));
  if (areaHeight != null && areaHeight > bottom - top) {
    // Center the ink in a band as high as the drawing area.
    const middle = (top + bottom) / 2;
    top = middle - areaHeight / 2;
    bottom = middle + areaHeight / 2;
  }
  const span = Math.max(bottom - top, right - left > 0 ? (right - left) / 8 : 1, 1);
  const scale = ROW_PIXELS / span;
  const pad = ROW_PIXELS * 0.15;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((right - left) * scale + 2 * pad));
  canvas.height = Math.ceil(ROW_PIXELS + 2 * pad);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, ROW_PIXELS * 0.07);
  const x = (v: number) => (v - left) * scale + pad;
  const y = (v: number) => (v - top) * scale + pad;
  for (const stroke of strokes) {
    const p = stroke.points;
    if (p.length === 1) {
      ctx.beginPath();
      ctx.arc(x(p[0].x), y(p[0].y), ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(x(p[0].x), y(p[0].y));
    for (let i = 1; i < p.length; i++) ctx.lineTo(x(p[i].x), y(p[i].y));
    ctx.stroke();
  }
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: data.data, width: data.width, height: data.height };
}

/** Recognizes handwriting with the PaddleOCR recognizer: up to `limit` candidates, best first. */
export async function recognizeHandwriting(
  engine: PaddleEngine,
  strokes: InkStroke[],
  height: number | null,
  limit: number,
): Promise<HandwritingResult> {
  const used = strokes.filter((s) => s.points.length > 0);
  if (!used.length) return { text: '', candidates: [] };
  const groups = mergeFlatRows(used, rows(used));
  let sofar: Candidate[] = [];
  for (const group of groups) {
    const image = drawRow(
      group.map((i) => used[i]),
      groups.length === 1 ? height : null,
    );
    const found = await engine.recognizeLine(image, { candidates: limit, japaneseOnly: true });
    const next = found
      .map((c) => ({ text: c.text.trim(), score: -Math.log(Math.max(c.confidence, 1e-12)) }))
      .filter((c) => c.text);
    sofar = combine(sofar, next, limit);
  }
  const probabilities = probabilitiesOf(sofar);
  const candidates: HandwritingCandidate[] = sofar.map((c, i) => ({
    text: c.text,
    probability: probabilities[i],
    score: c.score,
  }));
  return { text: candidates[0]?.text ?? '', candidates };
}

/**
 * Combines the candidates of consecutive rows into whole-text candidates: every kept combination
 * is extended with every candidate of the next row, scores add up, the best `limit` survive.
 */
function combine(sofar: Candidate[], next: Candidate[], limit: number): Candidate[] {
  const out: Candidate[] = [];
  const add = (c: Candidate) => {
    const existing = out.findIndex((o) => o.text === c.text);
    if (existing < 0) out.push(c);
    else if (c.score < out[existing].score) out[existing] = c;
  };
  if (!sofar.length) next.forEach(add);
  else for (const a of sofar) for (const b of next) add({ text: join(a.text, b.text), score: a.score + b.score });
  if (!next.length) sofar.forEach(add);
  return out.sort((a, b) => a.score - b.score).slice(0, limit);
}

/** Joins two rows: directly for Japanese, with a space between two Latin letters or digits. */
function join(a: string, b: string): string {
  if (!a || !b) return a + b;
  const latin = (c: string) => /[A-Za-z0-9]/.test(c);
  return latin(a.charAt(a.length - 1)) && latin(b.charAt(0)) ? `${a} ${b}` : a + b;
}

/** Softmax over the negated scores, so the probabilities add up to 1. */
function probabilitiesOf(candidates: Candidate[]): number[] {
  if (!candidates.length) return [];
  const best = Math.min(...candidates.map((c) => c.score));
  const p = candidates.map((c) => Math.exp(best - c.score));
  const sum = p.reduce((a, b) => a + b, 0);
  return p.map((v) => v / sum);
}
