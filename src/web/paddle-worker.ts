/**
 * Entry of the Web Worker that runs the models (`capacitor-japanese-ocr/web-worker`), see
 * `configureWebEngine({ worker })`. Talks to `paddle-remote.ts` on the page.
 */
import type { DetectOptions, LineOptions, PaddleEngine, RgbaImage } from './paddle';
import { loadPaddleEngine } from './paddle';
import type { WorkerRequest, WorkerResponse } from './paddle-remote';

let engine: Promise<PaddleEngine> | null = null;

const post = (message: WorkerResponse) => (self as unknown as Worker).postMessage(message);

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type === 'load') {
    engine = loadPaddleEngine({ gpu: request.gpu });
    try {
      post({ type: 'loaded', backend: (await engine).backend });
    } catch (e) {
      post({ type: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  try {
    const ready = await engine!;
    const image: RgbaImage = request.image;
    const result =
      request.method === 'recognize'
        ? await ready.recognize(image, request.options as DetectOptions)
        : await ready.recognizeLine(image, request.options as LineOptions);
    post({ type: 'result', id: request.id, result });
  } catch (e) {
    post({ type: 'error', id: request.id, message: e instanceof Error ? e.message : String(e) });
  }
});
