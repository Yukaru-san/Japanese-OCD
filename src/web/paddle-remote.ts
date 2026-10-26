import type {
  DetectOptions,
  LineOptions,
  PaddleBackend,
  PaddleCandidate,
  PaddleEngine,
  PaddleLine,
  RgbaImage,
} from './paddle';

export type WorkerRequest =
  | { type: 'load'; gpu: boolean }
  | {
      type: 'run';
      id: number;
      method: 'recognize' | 'recognizeLine';
      image: RgbaImage;
      options?: DetectOptions | LineOptions;
    };

export type WorkerResponse =
  | { type: 'loaded'; backend: PaddleBackend }
  | { type: 'failed'; message: string }
  | { type: 'result'; id: number; result: PaddleLine[] | PaddleCandidate[] }
  | { type: 'error'; id: number; message: string };

/**
 * The engine in a Web Worker (`paddle-worker.ts`), behind the same interface as on the page.
 * Rejects when the worker can't start or can't load the models; the caller then loads them on the
 * page instead.
 */
export function connectPaddleWorker(worker: Worker, gpu: boolean): Promise<PaddleEngine> {
  const pending = new Map<number, { resolve: (result: never) => void; reject: (e: Error) => void }>();
  let nextId = 0;

  return new Promise((resolve, reject) => {
    const fail = (message: string) => {
      worker.terminate();
      const error = new Error(message);
      pending.forEach((call) => call.reject(error));
      pending.clear();
      reject(error);
    };

    worker.addEventListener('error', (event) => fail(event.message || 'The OCR worker failed.'));
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.type === 'failed') return fail(response.message);
      if (response.type === 'loaded') return resolve(remoteEngine(response.backend));

      const call = pending.get(response.id);
      pending.delete(response.id);
      if (response.type === 'result') call?.resolve(response.result as never);
      else call?.reject(new Error(response.message));
    });

    worker.postMessage({ type: 'load', gpu } satisfies WorkerRequest);
  });

  function remoteEngine(backend: PaddleBackend): PaddleEngine {
    const run = <T>(method: 'recognize' | 'recognizeLine', image: RgbaImage, options?: DetectOptions | LineOptions) =>
      new Promise<T>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve: resolve as (result: never) => void, reject });
        // A copy moves to the worker, the caller keeps its pixels
        const data = new Uint8ClampedArray(image.data);
        const request: WorkerRequest = { type: 'run', id, method, image: { ...image, data }, options };
        worker.postMessage(request, [data.buffer]);
      });

    return {
      backend,
      recognize: (image, options) => run<PaddleLine[]>('recognize', image, options),
      recognizeLine: (image, options) => run<PaddleCandidate[]>('recognizeLine', image, options),
    };
  }
}
