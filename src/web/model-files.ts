/**
 * Downloads of the web engine (models and WebAssembly runtime): fetched once with progress, kept in
 * Cache Storage so later visits start without network, and deletable. Without Cache Storage
 * (e.g. some private modes) the files are fetched every time, like any other file.
 */
import manifest from './assets/manifest.js';

/** One file to download: its name in the manifest and where the bundler put it. */
export interface ModelFile {
  name: string;
  url: URL;
}

export interface DownloadOptions {
  /** Bytes loaded so far of all files together (stored ones count as loaded). */
  onProgress?: (loadedBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
}

/** Cache Storage name; one cache for all versions, files of other versions are removed on download. */
export const CACHE_NAME = 'japanese-ocr-models';

/** Bytes of a file, from the build's manifest. */
export function sizeOf(name: string): number {
  return manifest.files[name] ?? 0;
}

/** Fetches the files (from Cache Storage when stored), in order, reporting progress over all of them. */
export async function downloadFiles(
  files: ModelFile[],
  options: DownloadOptions = {},
): Promise<Uint8Array<ArrayBuffer>[]> {
  const cache = await openCache();
  const total = files.reduce((sum, file) => sum + sizeOf(file.name), 0);
  let loaded = 0;
  // At most every half percent, the network delivers far smaller pieces
  let reported = -1;
  const report = () => {
    const step = total ? Math.floor((Math.min(loaded, total) / total) * 200) : 200;
    if (step === reported) return;
    reported = step;
    options.onProgress?.(Math.min(loaded, total), total);
  };
  report();

  const result: Uint8Array<ArrayBuffer>[] = [];
  for (const file of files) {
    const stored = await cache?.match(file.url.href);
    if (stored) {
      result.push(new Uint8Array(await stored.arrayBuffer()));
      loaded += sizeOf(file.name);
      report();
      continue;
    }

    const bytes = await fetchWithProgress(file.url, options.signal, (chunk) => {
      loaded += chunk;
      report();
    });
    await cache?.put(file.url.href, new Response(bytes)).catch(() => undefined);
    result.push(bytes);
  }

  // Files of older versions (other URLs) are no longer needed
  if (cache) {
    const current = new Set(files.map((file) => file.url.href));
    const keys = await cache.keys();
    await Promise.all(
      keys
        .filter((request) => !current.has(request.url) && isSameBuild(request.url, files))
        .map((r) => cache.delete(r)),
    );
  }
  return result;
}

/** Bytes of the given files that are stored already. */
export async function storedBytes(files: ModelFile[]): Promise<number> {
  const cache = await openCache();
  if (!cache) return 0;

  const stored = await Promise.all(files.map((file) => cache.match(file.url.href)));
  return files.reduce((sum, file, i) => sum + (stored[i] ? sizeOf(file.name) : 0), 0);
}

/** Deletes every stored download of the engine. */
export async function deleteFiles(): Promise<void> {
  if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME);
}

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

// Only files of the same folder count as an older version (an app could use the cache name too)
function isSameBuild(url: string, files: ModelFile[]): boolean {
  const folder = (href: string) => href.slice(0, href.lastIndexOf('/') + 1);
  return files.some((file) => folder(file.url.href) === folder(url));
}

async function fetchWithProgress(
  url: URL,
  signal: AbortSignal | undefined,
  onChunk: (bytes: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Downloading ${url.pathname} failed (${response.status}).`);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onChunk(bytes.length);
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
    onChunk(value.length);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
