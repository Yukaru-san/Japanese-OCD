import type { OcrBlock, OcrFurigana, OcrGeometry, OcrResult, Point, Rect } from './definitions';

/**
 * Smooths live results over several frames, so text and boxes stop jumping around.
 *
 * Every frame the recognizer may read a paragraph a little differently: furigana are sometimes
 * found and sometimes taken as part of the line, a paragraph splits in two, a blurry frame finds
 * nothing. The stabilizer follows each paragraph from frame to frame (by position, corrected for
 * camera movement, and by text) and only shows a new reading of it once it was seen in two frames
 * in a row and at least as often as the old one in the last frames. A paragraph that is missing
 * for a frame or two keeps its last place; small position changes are ignored.
 *
 * `startLiveRecognition()` applies it to `textRecognized` unless `stabilize: false` is passed.
 */
export class LiveStabilizer {
  private tracks: Track[] = [];
  private nextId = 1;

  /** Forgets everything, e.g. after the camera was paused or restarted. */
  reset(): void {
    this.tracks = [];
  }

  /**
   * Takes the result of one frame and returns the stabilized result. Blocks get a `trackId` that
   * stays the same while the paragraph is followed.
   *
   * @param viewport size of the WebView in CSS pixels; blocks whose center is outside it (seen by
   *     the camera but cut off in the preview) are dropped
   */
  push(result: OcrResult, viewport?: { width: number; height: number }): OcrResult {
    const scale = Math.max(result.imageWidth, result.imageHeight, 1);
    const observations: Observation[] = [];
    const unboxed: OcrBlock[] = [];
    result.blocks.forEach((block, index) => {
      if (!block.boundingBox) return unboxed.push(block);
      if (viewport && block.viewBoundingBox && !inside(center(block.viewBoundingBox), viewport)) return;
      const furigana = result.furigana
        .filter((f) => f.block === index)
        .map((f) => {
          const copy = { ...f };
          delete copy.block;
          return copy;
        });
      observations.push({ block, furigana, text: block.text });
    });

    const previous = this.tracks;
    // Camera movement since the last frame, from the paragraphs that clearly match.
    const rough = assign(observations, previous, ZERO).filter((p) => p.reliable);
    const motion = median(rough, (o, t) => delta(t.box, o.block.boundingBox!));
    const viewMotion = median(
      rough.filter((p) => p.track.view && p.observation.block.viewBoundingBox),
      (o, t) => delta(t.view!, o.block.viewBoundingBox!),
    );
    const pairs = assign(observations, previous, motion);

    const matched = new Set<Track>();
    const used = new Set<Observation>();
    const shown: { track: Track; order: number }[] = [];

    for (const { observation, track } of pairs) {
      matched.add(track);
      used.add(observation);
      track.observe(observation);
      if (track.update(scale)) shown.push({ track, order: observations.indexOf(observation) });
    }

    const order = new Map(previous.map((t, i) => [t, i]));
    const kept: Track[] = [];
    for (const track of previous) {
      if (matched.has(track)) {
        kept.push(track);
        continue;
      }
      if (!track.miss(motion, viewMotion)) continue;
      kept.push(track);
      // Placed right after the paragraph it followed last time.
      const before = shown.filter((s) => (order.get(s.track) ?? -1) < (order.get(track) ?? 0));
      const anchor = before.length ? Math.max(...before.map((s) => s.order)) : -1;
      shown.push({ track, order: anchor + 0.5 });
    }

    for (const observation of observations) {
      if (used.has(observation)) continue;
      // A piece of a paragraph that is already shown (it split for one frame): not a new paragraph.
      const box = observation.block.boundingBox!;
      const covered = kept.some((t) => t.confirmed && overlap(box, t.box) > 0.6 * area(box));
      if (covered) continue;
      const track = new Track(this.nextId++, observation);
      kept.push(track);
      if (track.update(scale)) shown.push({ track, order: observations.indexOf(observation) });
    }

    shown.sort((a, b) => a.order - b.order || a.track.id - b.track.id);
    this.tracks = [...shown.map((s) => s.track), ...kept.filter((t) => !shown.some((s) => s.track === t))];

    const blocks: OcrBlock[] = [];
    const furigana: OcrFurigana[] = [];
    for (const { track } of shown) {
      const output = track.output!;
      const index = blocks.length;
      blocks.push({ ...output.block, trackId: track.id });
      for (const f of output.furigana) furigana.push({ ...f, block: index });
    }
    blocks.push(...unboxed);
    furigana.push(...result.furigana.filter((f) => f.block === undefined));

    return { ...result, text: blocks.map((b) => b.text).join('\n'), blocks, furigana };
  }
}

/** Frames a reading of a paragraph is compared over. */
const WINDOW = 4;
/** Frames in a row a new paragraph must be seen before it is shown. */
const MIN_HITS = 2;
/** Frames a paragraph keeps its place after it was last seen. */
const MAX_MISSES = 2;
/** Moves smaller than this (CSS pixels, or this part of the image size without view boxes) are ignored. */
const DEADBAND_VIEW = 4;
const DEADBAND_IMAGE = 0.008;

interface Observation {
  block: OcrBlock;
  /** The block's furigana, without their `block` index. */
  furigana: OcrFurigana[];
  text: string;
}

interface Offset {
  x: number;
  y: number;
}

const ZERO: Offset = { x: 0, y: 0 };

class Track {
  /** Last known box in image pixels and in CSS pixels. */
  box: Rect;
  view?: Rect;
  /** Texts of the last frames, `null` where the paragraph was missing. */
  private history: (string | null)[] = [];
  /** Latest observation of each reading in `history`. */
  private latest = new Map<string, Observation>();
  /** The reading shown, once the paragraph is confirmed. */
  private reading: string | null = null;
  private hits = 0;
  private misses = 0;
  /** What was shown last frame. */
  output?: Observation;

  constructor(
    readonly id: number,
    first: Observation,
  ) {
    this.box = first.block.boundingBox!;
    this.observe(first);
  }

  get confirmed(): boolean {
    return this.reading !== null;
  }

  observe(observation: Observation): void {
    this.box = observation.block.boundingBox!;
    this.view = observation.block.viewBoundingBox;
    this.record(observation.text);
    this.latest.set(observation.text, observation);
    this.hits++;
    this.misses = 0;
  }

  /** Decides what to show after `observe()`. Returns `false` while the paragraph is not confirmed. */
  update(scale: number): boolean {
    const current = this.history[this.history.length - 1]!;
    if (this.reading === null) {
      if (this.hits < MIN_HITS) return false;
      this.reading = current;
    } else if (current !== this.reading) {
      const lastTwo = this.history.slice(-2);
      const count = (text: string) => this.history.filter((t) => t === text).length;
      if (lastTwo.length === 2 && lastTwo[1] === lastTwo[0] && count(current) >= count(this.reading)) {
        this.reading = current;
      }
    }

    const now = this.latest.get(current)!;
    let next: Observation;
    if (this.reading === current) {
      next = now;
    } else {
      // Keep showing the established reading, moved to where the paragraph is now.
      const old = this.latest.get(this.reading)!;
      next = move(old, delta(old.block.boundingBox!, now.block.boundingBox!), viewDelta(old.block, now.block));
    }
    if (this.output && this.output.text === next.text && still(this.output.block, next.block, scale)) {
      return true;
    }
    this.output = next;
    return true;
  }

  /** The paragraph was not found in this frame. Returns `false` when it should be dropped. */
  miss(motion: Offset, viewMotion: Offset): boolean {
    this.record(null);
    this.hits = 0;
    this.misses++;
    if (!this.output || this.misses > MAX_MISSES) return false;
    this.box = shift(this.box, motion);
    if (this.view) this.view = shift(this.view, viewMotion);
    if (motion.x || motion.y || viewMotion.x || viewMotion.y) {
      this.output = move(this.output, motion, this.output.block.viewBoundingBox ? viewMotion : ZERO);
    }
    return true;
  }

  private record(text: string | null): void {
    this.history.push(text);
    if (this.history.length > WINDOW) this.history.shift();
    for (const key of [...this.latest.keys()]) {
      if (key !== this.reading && key !== text && !this.history.includes(key)) this.latest.delete(key);
    }
  }
}

interface Pair {
  observation: Observation;
  track: Track;
  score: number;
  /** Clearly the same paragraph: good enough to measure camera movement with. */
  reliable: boolean;
}

/**
 * Pairs observations with tracks, best first: by overlap of the boxes (the track's box moved by
 * `motion`) and by similar text.
 */
function assign(observations: Observation[], tracks: Track[], motion: Offset): Pair[] {
  const candidates: Pair[] = [];
  for (const observation of observations) {
    const box = observation.block.boundingBox!;
    for (const track of tracks) {
      const moved = shift(track.box, motion);
      const iou = overlap(box, moved) / (area(box) + area(moved) - overlap(box, moved) || 1);
      const similarity = textSimilarity(observation.text, track.output?.text ?? observation.text);
      const near = distance(center(box), center(moved)) < Math.max(diagonal(moved), diagonal(box));
      if (iou < 0.2 && !(similarity >= 0.6 && near)) continue;
      candidates.push({ observation, track, score: iou + 0.5 * similarity, reliable: iou > 0.5 || similarity === 1 });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const pairs: typeof candidates = [];
  const usedObservations = new Set<Observation>();
  const usedTracks = new Set<Track>();
  for (const c of candidates) {
    if (usedObservations.has(c.observation) || usedTracks.has(c.track)) continue;
    usedObservations.add(c.observation);
    usedTracks.add(c.track);
    pairs.push(c);
  }
  return pairs;
}

function median(pairs: Pair[], offset: (o: Observation, t: Track) => Offset): Offset {
  if (!pairs.length) return ZERO;
  const offsets = pairs.map((p) => offset(p.observation, p.track));
  const mid = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const m = sorted.length >> 1;
    return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  };
  return { x: mid(offsets.map((o) => o.x)), y: mid(offsets.map((o) => o.y)) };
}

/** Dice coefficient of the character bigrams (single characters for one-character texts). */
export function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const grams = (text: string) => {
    const chars = Array.from(text);
    if (chars.length < 2) return chars;
    return chars.slice(1).map((c, i) => chars[i] + c);
  };
  const x = grams(a);
  const y = grams(b);
  if (!x.length || !y.length) return 0;
  const pool = new Map<string, number>();
  for (const g of y) pool.set(g, (pool.get(g) ?? 0) + 1);
  let common = 0;
  for (const g of x) {
    const n = pool.get(g) ?? 0;
    if (n > 0) {
      common++;
      pool.set(g, n - 1);
    }
  }
  return (2 * common) / (x.length + y.length);
}

/** `true` when `b` lies within the dead band of `a`, so `a` can stay where it is. */
function still(a: OcrBlock, b: OcrBlock, scale: number): boolean {
  const close = (p: Rect, q: Rect, limit: number) =>
    Math.abs(p.left - q.left) <= limit &&
    Math.abs(p.top - q.top) <= limit &&
    Math.abs(p.right - q.right) <= limit &&
    Math.abs(p.bottom - q.bottom) <= limit;
  if (a.viewBoundingBox && b.viewBoundingBox) return close(a.viewBoundingBox, b.viewBoundingBox, DEADBAND_VIEW);
  if (a.viewBoundingBox || b.viewBoundingBox) return false;
  return close(a.boundingBox!, b.boundingBox!, DEADBAND_IMAGE * scale);
}

function viewDelta(from: OcrBlock, to: OcrBlock): Offset {
  return from.viewBoundingBox && to.viewBoundingBox ? delta(from.viewBoundingBox, to.viewBoundingBox) : ZERO;
}

/** Copy of an observation with all boxes and points moved. */
function move(observation: Observation, image: Offset, view: Offset): Observation {
  const block = moveGeometry(observation.block, image, view);
  block.lines = observation.block.lines.map((line) => {
    const l = moveGeometry(line, image, view);
    l.elements = line.elements.map((element) => {
      const e = moveGeometry(element, image, view);
      e.symbols = element.symbols.map((symbol) => moveGeometry(symbol, image, view));
      return e;
    });
    return l;
  });
  return { ...observation, block, furigana: observation.furigana.map((f) => moveGeometry(f, image, view)) };
}

function moveGeometry<T extends OcrGeometry>(item: T, image: Offset, view: Offset): T {
  const copy = { ...item };
  if (item.boundingBox) copy.boundingBox = shift(item.boundingBox, image);
  if (item.cornerPoints) copy.cornerPoints = item.cornerPoints.map((p) => shiftPoint(p, image));
  if (item.viewBoundingBox) copy.viewBoundingBox = shift(item.viewBoundingBox, view);
  if (item.viewCornerPoints) copy.viewCornerPoints = item.viewCornerPoints.map((p) => shiftPoint(p, view));
  return copy;
}

const shift = (r: Rect, o: Offset): Rect => ({
  left: r.left + o.x,
  top: r.top + o.y,
  right: r.right + o.x,
  bottom: r.bottom + o.y,
});
const shiftPoint = (p: Point, o: Offset): Point => ({ x: p.x + o.x, y: p.y + o.y });
const center = (r: Rect): Point => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
const delta = (from: Rect, to: Rect): Offset => {
  const a = center(from);
  const b = center(to);
  return { x: b.x - a.x, y: b.y - a.y };
};
const area = (r: Rect) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const diagonal = (r: Rect) => Math.hypot(r.right - r.left, r.bottom - r.top);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (p: Point, size: { width: number; height: number }) =>
  p.x >= 0 && p.y >= 0 && p.x <= size.width && p.y <= size.height;
