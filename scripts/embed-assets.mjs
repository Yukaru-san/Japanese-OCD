// Writes the PaddleOCR models, their character list and the ONNX Runtime WebAssembly binary as
// JavaScript modules next to the compiled web engine, so apps get them through their normal
// bundler (no CDN, no extra files to copy). Runs after `tsc` in `npm run build`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

write('det', readFileSync(join(root, 'web-models/ppocrv6_small_det.onnx')).toString('base64'));
write('rec', readFileSync(join(root, 'web-models/ppocrv6_small_rec.onnx')).toString('base64'));
write('dict', readFileSync(join(root, 'web-models/ppocrv6_small_rec_dict.txt'), 'utf8').replace(/\n$/, '').split('\n'));
// ONNX Runtime Web (MIT), copied in so apps don't install the 140 MB onnxruntime-web package. Its
// `new URL('ort-wasm-simd-threaded.wasm', import.meta.url)` is hidden from bundlers, which would
// otherwise copy the 14 MB .wasm into the app although it is never fetched (wasmBinary is set).
const runtime = readFileSync(join(ortDist, 'ort.wasm.bundle.min.mjs'), 'utf8')
  .replace(/\n\/\/# sourceMappingURL=.*\n?$/, '\n')
  .replaceAll('new URL("ort-wasm-simd-threaded.wasm",import.meta.url)', 'new URL("ort-wasm-simd-threaded.wasm",""+import.meta.url)');
if (runtime.includes('"ort-wasm-simd-threaded.wasm",import.meta.url')) throw new Error('Unexpected onnxruntime-web build');
writeFileSync(join(out, 'ort.js'), runtime);
// The wasm compresses to a quarter; it is unpacked with DecompressionStream at load time.
write(
  'ort-wasm',
  gzipSync(readFileSync(join(ortDist, 'ort-wasm-simd-threaded.wasm')), { level: 9 }).toString('base64'),
);
