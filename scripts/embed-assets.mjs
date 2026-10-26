// Puts the PaddleOCR models, their character list and ONNX Runtime next to the compiled web engine,
// so apps get them through their normal bundler (no CDN, no extra files to copy). The models and
// the WebAssembly binaries are plain files the engine fetches (`new URL('./assets/…', import.meta.url)`,
// which bundlers copy), so it can report progress and keep them in Cache Storage. Runs after `tsc`
// in `npm run build`.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist/esm/web/assets');
mkdirSync(out, { recursive: true });

const require = createRequire(import.meta.url);
const ortDist = dirname(require.resolve('onnxruntime-web'));

const write = (name, value) => writeFileSync(join(out, `${name}.js`), `export default ${JSON.stringify(value)};\n`);
const files = {};
// Binary files; `.bin` so no server sends them with Content-Encoding (the wasm is gzipped by us)
const writeFile = (name, bytes) => {
  writeFileSync(join(out, name), bytes);
  files[name] = bytes.length;
};

writeFile('det.onnx', readFileSync(join(root, 'web-models/ppocrv6_small_det.onnx')));
writeFile('rec.onnx', readFileSync(join(root, 'web-models/ppocrv6_small_rec.onnx')));
write('dict', readFileSync(join(root, 'web-models/ppocrv6_small_rec_dict.txt'), 'utf8').replace(/\n$/, '').split('\n'));
// ONNX Runtime Web (MIT), copied in so apps don't install the 140 MB onnxruntime-web package. Its
// `new URL('ort-wasm-simd-threaded.wasm', import.meta.url)` is hidden from bundlers, which would
// otherwise copy the 14 MB .wasm into the app although it is never fetched (wasmBinary is set).
const runtime = readFileSync(join(ortDist, 'ort.wasm.bundle.min.mjs'), 'utf8')
  .replace(/\n\/\/# sourceMappingURL=.*\n?$/, '\n')
  .replaceAll(
    'new URL("ort-wasm-simd-threaded.wasm",import.meta.url)',
    'new URL("ort-wasm-simd-threaded.wasm",""+import.meta.url)',
  );
if (runtime.includes('"ort-wasm-simd-threaded.wasm",import.meta.url'))
  throw new Error('Unexpected onnxruntime-web build');
writeFileSync(join(out, 'ort.js'), runtime);
// The wasm compresses to a quarter; it is unpacked with DecompressionStream at load time.
writeFile('ort-wasm.bin', gzipSync(readFileSync(join(ortDist, 'ort-wasm-simd-threaded.wasm')), { level: 9 }));

// The WebGPU build of ONNX Runtime and its own (asyncify) wasm, loaded instead of the two above
// when the browser has a GPU adapter. Same treatment of the wasm URL.
const webgpuRuntime = readFileSync(join(ortDist, 'ort.webgpu.bundle.min.mjs'), 'utf8')
  .replace(/\n\/\/# sourceMappingURL=.*\n?$/, '\n')
  .replaceAll(
    'new URL("ort-wasm-simd-threaded.asyncify.wasm",import.meta.url)',
    'new URL("ort-wasm-simd-threaded.asyncify.wasm",""+import.meta.url)',
  );
if (webgpuRuntime.includes('"ort-wasm-simd-threaded.asyncify.wasm",import.meta.url')) {
  throw new Error('Unexpected onnxruntime-web WebGPU build');
}
writeFileSync(join(out, 'ort-webgpu.js'), webgpuRuntime);
writeFile(
  'ort-wasm-webgpu.bin',
  gzipSync(readFileSync(join(ortDist, 'ort-wasm-simd-threaded.asyncify.wasm')), { level: 9 }),
);

// Sizes of the downloads, so apps can tell users before they start one
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
write('manifest', { version, files });

// The CommonJS and script-tag builds (rollup, next) resolve `./assets/…` from their own folders
for (const dir of ['dist/assets', 'dist/cjs/assets']) {
  mkdirSync(join(root, dir), { recursive: true });
  for (const name of Object.keys(files)) copyFileSync(join(out, name), join(root, dir, name));
}
