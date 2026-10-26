/**
 * PaddleOCR (PP-OCRv6 small) text detection and recognition in the browser, with ONNX Runtime Web:
 * on the GPU (WebGPU) where the browser offers one, else on the CPU (WebAssembly). The model
 * weights and the runtime are bundled with the plugin and loaded lazily the first time the engine
 * is used, so nothing is fetched from a CDN. Only the runtime that is used gets loaded.
 *
 * This file only works on pixels; turning images, canvases and videos into pixels is done in
 * `image.ts`.
 */
import type * as OrtModule from 'onnxruntime-web';

import type { Pt } from './geometry';
import { convexHull, corners, dist, minAreaRect } from './geometry';
import type { DownloadOptions, ModelFile } from './model-files';
import { downloadFiles } from './model-files';

/** RGBA pixels, like `ImageData`. */
export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface PaddleCandidate {
  text: string;
  /** Probability of this reading, between 0 and 1. */
  confidence: number;
}

export interface PaddleChar {
  text: string;
  confidence: number;
  /** Index of the space-separated word within the line. */
  word: number;
  /** Corners clockwise from the top-left of the character (in reading direction). */
  corners: Pt[];
}

export interface PaddleLine {
  /** Recognized text (best candidate). */
  text: string;
  /** Mean character probability, between 0 and 1. */
  confidence: number;
  /** Up to `candidates` readings, best first. Only filled when `candidates` was requested. */
  candidates: PaddleCandidate[];
  /** Corners clockwise from the top-left of the line (in reading direction), in image pixels. */
  corners: Pt[];
  /** `true` when the line is a vertical column (read top to bottom). */
  vertical: boolean;
  /** Characters with their positions, spaces excluded. */
  chars: PaddleChar[];
}

export interface DetectOptions {
  /** The longer side of the image is scaled down to this before detection. @default 1600 */
  maxSide?: number;
  /** Number of alternative readings per line (CTC beam search). @default 0 */
  candidates?: number;
}

export interface LineOptions {
  /** Number of readings to return. @default 5 */
  candidates?: number;
  /** Only Japanese script can be read (kana, kanji, full-width digits, Japanese punctuation). */
  japaneseOnly?: boolean;
}

/** Where the models run. */
export type PaddleBackend = 'webgpu' | 'wasm';

export interface PaddleEngine {
  /** Finds text lines in the image and reads them. Lines come in detection order. */
  recognize(image: RgbaImage, options?: DetectOptions): Promise<PaddleLine[]>;
  /**
   * Reads the whole image as ONE line of text, without detection (e.g. a word drawn on a canvas).
   * Returns up to `candidates` readings, best first.
   */
  recognizeLine(image: RgbaImage, options?: LineOptions): Promise<PaddleCandidate[]>;
  /** Where the models run, for diagnostics. */
  readonly backend: PaddleBackend;
}

/** Handwriting is Japanese: kana, kanji, full-width digits and Japanese punctuation. Latin letters,
 * digits and symbols are left out: they look like kanji (+ 十, 0 口, _ 一) to the recognizer. */
const JAPANESE = /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー々〆ヶ〇０-９、。「」『』（）・！？…〜]$/u;

export function isJapanese(char: string): boolean {
  return JAPANESE.test(char);
}

// Model settings from PP-OCRv6_small_det / _rec inference.yml.
const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];
const DET_THRESH = 0.2;
const DET_BOX_THRESH = 0.45;
const DET_UNCLIP = 1.4;
const DET_MAX_CANDIDATES = 3000;
const DET_MIN_SIZE = 3;
const REC_HEIGHT = 48;
const REC_MIN_WIDTH = 48;
/** Very long lines are cut down to this tensor width (100 characters at 48 px). */
const REC_MAX_WIDTH = 4800;

type Ort = typeof OrtModule;

let loading: Promise<PaddleEngine> | null = null;

export interface LoadOptions extends DownloadOptions {
  /** `false` keeps the models on the CPU even where WebGPU is available. @default true */
  gpu?: boolean;
}

/**
 * Loads the bundled models and returns the engine. Safe to call repeatedly; the models are only
 * loaded once. Rejects when WebAssembly is not available or the models cannot be loaded.
 */
export function loadPaddleEngine(options: LoadOptions = {}): Promise<PaddleEngine> {
  if (!loading) {
    loading = createEngine(options.gpu !== false, options);
    loading.catch(() => (loading = null));
  }
  return loading;
}

async function createEngine(gpu: boolean, download: DownloadOptions): Promise<PaddleEngine> {
  if (typeof WebAssembly !== 'object') throw new Error('WebAssembly is not available in this browser.');
  const backend = await chooseBackend(gpu);
  const [[det, rec, wasm], dict] = await Promise.all([
    downloadFiles(engineFiles(backend), download),
    import('./assets/dict.js').then((m) => m.default),
  ]);
  // blank, the dictionary, then the space character.
  const chars = ['', ...dict, ' '];
  const binary = await gunzip(wasm);

  if (backend === 'webgpu') {
    try {
      return await createSessions('webgpu', det, rec, binary, chars);
    } catch (e) {
      // Drivers and browsers differ a lot: anything that fails on the GPU runs on the CPU instead.
      console.warn('Japanese OCR: WebGPU failed, using WebAssembly.', e);
      const [cpuWasm] = await downloadFiles([wasmFile('wasm')], download);
      return createSessions('wasm', det, rec, await gunzip(cpuWasm), chars);
    }
  }
  return createSessions('wasm', det, rec, binary, chars);
}

/** Where the models will run: on the GPU where the browser offers a WebGPU adapter. */
export async function chooseBackend(gpu: boolean): Promise<PaddleBackend> {
  return gpu && (await hasWebGpu()) ? 'webgpu' : 'wasm';
}

/** The files the engine downloads for a backend: both models and the runtime's WebAssembly. */
export function engineFiles(backend: PaddleBackend): ModelFile[] {
  return [
    { name: 'det.onnx', url: new URL('./assets/det.onnx', import.meta.url) },
    { name: 'rec.onnx', url: new URL('./assets/rec.onnx', import.meta.url) },
    wasmFile(backend),
  ];
}

function wasmFile(backend: PaddleBackend): ModelFile {
  return backend === 'webgpu'
    ? { name: 'ort-wasm-webgpu.bin', url: new URL('./assets/ort-wasm-webgpu.bin', import.meta.url) }
    : { name: 'ort-wasm.bin', url: new URL('./assets/ort-wasm.bin', import.meta.url) };
}

async function hasWebGpu(): Promise<boolean> {
  const gpu = (globalThis.navigator as { gpu?: { requestAdapter(): Promise<unknown> } } | undefined)?.gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function createSessions(
  backend: PaddleBackend,
  det: Uint8Array,
  rec: Uint8Array,
  wasm: Uint8Array<ArrayBuffer>,
  chars: string[],
): Promise<PaddleEngine> {
  const ort = await (backend === 'webgpu'
    ? (import('./assets/ort-webgpu.js') as Promise<Ort>)
    : (import('./assets/ort.js') as Promise<Ort>));
  ort.env.wasm.wasmBinary = wasm;
  // Several threads need SharedArrayBuffer, which browsers only allow on cross-origin isolated
  // pages (COOP/COEP headers). Elsewhere one thread is used.
  ort.env.wasm.numThreads =
    globalThis.crossOriginIsolated && typeof navigator !== 'undefined'
      ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
      : 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = 'error';

  // On the GPU, the few operations WebGPU lacks run on the CPU (no warning about that)
  const options: OrtModule.InferenceSession.SessionOptions = {
    executionProviders: backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
  };
  const detSession = await ort.InferenceSession.create(det, options);
  const recSession = await ort.InferenceSession.create(rec, options);
  const engine = new Engine(ort, detSession, recSession, chars, backend);

  // A GPU that can't run the models fails here already, not on the user's first image.
  if (backend === 'webgpu') await engine.recognize(blankImage(64));
  return engine;
}

function blankImage(size: number): RgbaImage {
  return { data: new Uint8ClampedArray(size * size * 4).fill(255), width: size, height: size };
}

class Engine implements PaddleEngine {
  /** Sessions can't run concurrently: calls are queued. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly ort: Ort,
    private readonly det: OrtModule.InferenceSession,
    private readonly rec: OrtModule.InferenceSession,
    private readonly chars: string[],
    readonly backend: PaddleBackend,
  ) {}

  recognize(image: RgbaImage, options: DetectOptions = {}): Promise<PaddleLine[]> {
    return this.enqueue(async () => {
      const boxes = await this.detect(image, options.maxSide ?? 1600);
      const lines: PaddleLine[] = [];
      for (const box of boxes) {
        const line = await this.read(image, box, options.candidates ?? 0);
        if (line) lines.push(line);
      }
      return lines;
    });
  }

  recognizeLine(image: RgbaImage, options: LineOptions = {}): Promise<PaddleCandidate[]> {
    return this.enqueue(async () => {
      const box: Pt[] = [
        { x: 0, y: 0 },
        { x: image.width, y: 0 },
        { x: image.width, y: image.height },
        { x: 0, y: image.height },
      ];
      const only = options.japaneseOnly ? isJapanese : undefined;
      const line = await this.read(image, box, Math.max(1, options.candidates ?? 5), false, only);
      return line?.candidates ?? [];
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Text detection (DB): returns one quadrilateral per text line, in image pixels. */
  private async detect(image: RgbaImage, maxSide: number): Promise<Pt[][]> {
    const { width, height } = image;
    const scale = Math.max(width, height) > maxSide ? maxSide / Math.max(width, height) : 1;
    const dw = Math.max(32, Math.round((width * scale) / 32) * 32);
    const dh = Math.max(32, Math.round((height * scale) / 32) * 32);

    const input = new Float32Array(3 * dw * dh);
    const plane = dw * dh;
    const sx = width / dw;
    const sy = height / dh;
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const [r, g, b] = sample(image, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5);
        const i = y * dw + x;
        // The models were trained on BGR images.
        input[i] = (b / 255 - DET_MEAN[0]) / DET_STD[0];
        input[plane + i] = (g / 255 - DET_MEAN[1]) / DET_STD[1];
        input[2 * plane + i] = (r / 255 - DET_MEAN[2]) / DET_STD[2];
      }
    }
    const feeds = { [this.det.inputNames[0]]: new this.ort.Tensor('float32', input, [1, 3, dh, dw]) };
    const output = (await this.det.run(feeds))[this.det.outputNames[0]] as OrtModule.Tensor;
    const prob = output.data as Float32Array;
    const [, , ph, pw] = output.dims as number[];
    return boxesFromMap(prob, pw, ph).map((quad) =>
      quad.map((p) => clampPoint(p, width / pw, height / ph, width, height)),
    );
  }

  /** Recognizes the text inside a quadrilateral (corners clockwise from the top-left). */
  private async read(
    image: RgbaImage,
    quad: Pt[],
    candidates: number,
    rotateTall = true,
    only?: (char: string) => boolean,
  ): Promise<PaddleLine | null> {
    const along = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
    const across = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]));
    if (along < 1 || across < 1) return null;
    const vertical = rotateTall && across / along >= 1.5;

    // Origin and axes of the crop in reading direction. Vertical columns are turned a quarter
    // counter-clockwise (top of the column to the left), as PaddleOCR does.
    const o = vertical ? quad[1] : quad[0];
    const u = vertical ? sub(quad[2], quad[1]) : sub(quad[1], quad[0]);
    const v = vertical ? sub(quad[0], quad[1]) : sub(quad[3], quad[0]);
    const length = vertical ? across : along;
    const thickness = vertical ? along : across;

    const resized = Math.min(REC_MAX_WIDTH, Math.max(1, Math.ceil((REC_HEIGHT * length) / thickness)));
    const tensorWidth = Math.max(REC_MIN_WIDTH, resized);
    const input = new Float32Array(3 * REC_HEIGHT * tensorWidth);
    const plane = REC_HEIGHT * tensorWidth;
    for (let y = 0; y < REC_HEIGHT; y++) {
      const fy = (y + 0.5) / REC_HEIGHT;
      for (let x = 0; x < resized; x++) {
        const fx = (x + 0.5) / resized;
        const [r, g, b] = sample(image, o.x + fx * u.x + fy * v.x - 0.5, o.y + fx * u.y + fy * v.y - 0.5);
        const i = y * tensorWidth + x;
        input[i] = (b / 255 - 0.5) / 0.5;
        input[plane + i] = (g / 255 - 0.5) / 0.5;
        input[2 * plane + i] = (r / 255 - 0.5) / 0.5;
      }
    }
    const feeds = { [this.rec.inputNames[0]]: new this.ort.Tensor('float32', input, [1, 3, REC_HEIGHT, tensorWidth]) };
    const output = (await this.rec.run(feeds))[this.rec.outputNames[0]] as OrtModule.Tensor;
    const [, steps, classes] = output.dims as number[];
    const probs = output.data as Float32Array;
    if (only) {
      // Characters that may not be read get no probability.
      const allowed = this.chars.map((c, k) => k === 0 || only(c));
      for (let t = 0; t < steps; t++) {
        for (let c = 1; c < classes; c++) if (!allowed[c]) probs[t * classes + c] = 0;
      }
    }

    const decoded = greedy(probs, steps, classes);
    const at = (fraction: number) => ({ x: o.x + fraction * u.x, y: o.y + fraction * u.y });
    const quadOf = (a: number, b: number): Pt[] => {
      const p0 = at(a);
      const p1 = at(b);
      const p2 = { x: p1.x + v.x, y: p1.y + v.y };
      const p3 = { x: p0.x + v.x, y: p0.y + v.y };
      return vertical ? [p3, p0, p1, p2] : [p0, p1, p2, p3];
    };

    // Character extents along the line: centered on their CTC frames, about one line height wide
    // (half for narrow characters), never overlapping their neighbours.
    const step = tensorWidth / steps;
    const centers = decoded.map((d) => ((d.first + d.last + 1) / 2) * step);
    const chars: PaddleChar[] = [];
    let word = 0;
    decoded.forEach((d, i) => {
      const text = this.chars[d.index] ?? '';
      if (text === ' ') {
        word++;
        return;
      }
      const half = (isNarrow(text) ? 0.3 : 0.5) * REC_HEIGHT;
      const lower = i > 0 ? (centers[i - 1] + centers[i]) / 2 : 0;
      const upper = i < decoded.length - 1 ? (centers[i] + centers[i + 1]) / 2 : resized;
      const a = Math.max(lower, centers[i] - half, 0) / resized;
      const b = Math.min(upper, centers[i] + half, resized) / resized;
      chars.push({
        text,
        confidence: d.confidence,
        word,
        corners: quadOf(Math.min(a, 1), Math.min(Math.max(a, b), 1)),
      });
    });

    const text = decoded.map((d) => this.chars[d.index] ?? '').join('');
    const confidence = decoded.length ? decoded.reduce((s, d) => s + d.confidence, 0) / decoded.length : 0;
    const alternatives =
      candidates > 0
        ? beamSearch(probs, steps, classes, candidates).map((c) => ({
            text: c.indexes.map((k) => this.chars[k] ?? '').join(''),
            confidence: c.probability,
          }))
        : [];
    return { text, confidence, candidates: alternatives, corners: quadOf(0, 1), vertical, chars };
  }
}

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function clampPoint(p: Pt, sx: number, sy: number, width: number, height: number): Pt {
  return { x: Math.min(width, Math.max(0, p.x * sx)), y: Math.min(height, Math.max(0, p.y * sy)) };
}

function isNarrow(text: string): boolean {
  const code = text.charCodeAt(0);
  return code < 0x2e80 || (code >= 0xff61 && code <= 0xffdc);
}

/** Bilinear sample of an RGBA image; coordinates outside are clamped to the edge. */
function sample(image: RgbaImage, x: number, y: number): [number, number, number] {
  const { data, width, height } = image;
  const cx = Math.min(width - 1, Math.max(0, x));
  const cy = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  return [
    data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11,
    data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11,
    data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11,
  ];
}

/**
 * DB post-processing: thresholds the probability map, takes every connected region, fits a
 * rotated rectangle around it, scores it and grows it by the unclip ratio. Returns quadrilaterals
 * in probability-map pixels, corners clockwise from the top-left.
 */
export function boxesFromMap(prob: Float32Array, width: number, height: number): Pt[][] {
  const label = new Int32Array(width * height);
  const boxes: Pt[][] = [];
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < prob.length && boxes.length < DET_MAX_CANDIDATES; start++) {
    if (label[start] !== 0 || prob[start] <= DET_THRESH) continue;
    next++;
    label[start] = next;
    stack.push(start);
    // Leftmost and rightmost pixel per row are enough for the convex hull.
    const rowMin = new Map<number, number>();
    const rowMax = new Map<number, number>();
    let sum = 0;
    let count = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      sum += prob[i];
      count++;
      if (!rowMin.has(y) || x < rowMin.get(y)!) rowMin.set(y, x);
      if (!rowMax.has(y) || x > rowMax.get(y)!) rowMax.set(y, x);
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (label[j] === 0 && prob[j] > DET_THRESH) {
            label[j] = next;
            stack.push(j);
          }
        }
      }
    }
    const points: Pt[] = [];
    rowMin.forEach((x, y) => points.push({ x, y }));
    rowMax.forEach((x, y) => points.push({ x, y }));
    const rect = minAreaRect(convexHull(points));
    if (Math.min(rect.width, rect.height) < DET_MIN_SIZE) continue;
    if (sum / count < DET_BOX_THRESH) continue;
    // Unclip: grow every side by area * ratio / perimeter.
    const grow = (rect.width * rect.height * DET_UNCLIP) / (2 * (rect.width + rect.height));
    const grown = { ...rect, width: rect.width + 2 * grow, height: rect.height + 2 * grow };
    if (Math.min(grown.width, grown.height) < DET_MIN_SIZE + 2) continue;
    boxes.push(corners(grown));
  }
  return boxes;
}

interface Decoded {
  index: number;
  first: number;
  last: number;
  confidence: number;
}

/** Greedy CTC decoding that remembers which output steps produced each character. */
function greedy(probs: Float32Array, steps: number, classes: number): Decoded[] {
  const result: (Decoded & { sum: number; count: number })[] = [];
  let previous = 0;
  let current: (Decoded & { sum: number; count: number }) | null = null;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let bestP = -1;
    const row = t * classes;
    for (let c = 0; c < classes; c++) {
      const p = probs[row + c];
      if (p > bestP) {
        bestP = p;
        best = c;
      }
    }
    if (best !== 0 && best === previous && current) {
      current.last = t;
      current.sum += bestP;
      current.count++;
    } else if (best !== 0) {
      current = { index: best, first: t, last: t, confidence: 0, sum: bestP, count: 1 };
      result.push(current);
    } else {
      current = null;
    }
    previous = best;
  }
  return result.map(({ index, first, last, sum, count }) => ({ index, first, last, confidence: sum / count }));
}

/** CTC prefix beam search: the `count` most probable readings with their probabilities. */
function beamSearch(
  probs: Float32Array,
  steps: number,
  classes: number,
  count: number,
): { indexes: number[]; probability: number }[] {
  interface Beam {
    indexes: number[];
    blank: number;
    other: number;
  }
  const width = Math.max(16, count * 4);
  let beams = new Map<string, Beam>([['', { indexes: [], blank: 1, other: 0 }]]);
  for (let t = 0; t < steps; t++) {
    const row = t * classes;
    // Only characters with a real chance at this step.
    const options: number[] = [];
    for (let c = 1; c < classes; c++) if (probs[row + c] > 0.001) options.push(c);
    options.sort((a, b) => probs[row + b] - probs[row + a]);
    options.length = Math.min(options.length, 10);

    const nextBeams = new Map<string, Beam>();
    const get = (indexes: number[]): Beam => {
      const key = indexes.join(',');
      let beam = nextBeams.get(key);
      if (!beam) {
        beam = { indexes, blank: 0, other: 0 };
        nextBeams.set(key, beam);
      }
      return beam;
    };
    const blank = probs[row];
    for (const beam of beams.values()) {
      const total = beam.blank + beam.other;
      get(beam.indexes).blank += total * blank;
      const last = beam.indexes[beam.indexes.length - 1];
      for (const c of options) {
        const p = probs[row + c];
        const extended = get([...beam.indexes, c]);
        if (c === last) {
          extended.other += beam.blank * p;
          get(beam.indexes).other += beam.other * p;
        } else {
          extended.other += total * p;
        }
      }
    }
    beams = new Map(
      [...nextBeams.entries()].sort((a, b) => b[1].blank + b[1].other - (a[1].blank + a[1].other)).slice(0, width),
    );
  }
  return [...beams.values()]
    .map((b) => ({ indexes: b.indexes, probability: b.blank + b.other }))
    .filter((b) => b.indexes.length > 0)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, count);
}

// The WebAssembly comes gzipped (unless a server already unpacked it on the way)
async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  if (typeof DecompressionStream !== 'function')
    throw new Error('DecompressionStream is not available in this browser.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
