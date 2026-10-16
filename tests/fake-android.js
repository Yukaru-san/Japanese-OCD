// Simulated Android side for the bridge test. Injected before the app loads.
// It answers plugin calls through the same JSON protocol the Capacitor Android bridge uses
// (androidBridge.postMessage → Capacitor.fromNative) and returns data in the shape the
// Java plugin builds in OcrEngine.toResult(). It knows nothing about the app's glossary.
(() => {
  const state = { inkModel: false, permission: 'prompt', running: false, frozen: false, clipboard: '', torch: false };
  const listeners = {};

  // A camera frame that shows two lines of text. Each line: text, left, top in CSS px of the WebView.
  const LINES = [
    ['こんにちは、せかい', 40, 160],
    ['日本語を勉強する', 40, 230],
  ];
  const CHAR = 34; // CSS px per character in the preview
  const SCALE = 3; // image px per CSS px

  const left2 = () => LINES[1][1];
  const rect = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b });
  const corners = (b) => [
    { x: b.left, y: b.top },
    { x: b.right, y: b.top },
    { x: b.right, y: b.bottom },
    { x: b.left, y: b.bottom },
  ];
  const geometry = (view) => {
    const image = rect(view.left * SCALE, view.top * SCALE, view.right * SCALE, view.bottom * SCALE);
    return { boundingBox: image, cornerPoints: corners(image), viewBoundingBox: view, viewCornerPoints: corners(view) };
  };

  function frame(withView) {
    const blocks = LINES.map(([text, left, top]) => {
      const chars = Array.from(text);
      // ML Kit splits Japanese lines into elements at punctuation; one element per chunk here.
      const chunks = text.split(/(?<=、)/);
      let offset = 0;
      const elements = chunks.map((chunk) => {
        const symbols = Array.from(chunk).map((c, k) => {
          const x = left + (offset + k) * CHAR;
          const g = geometry(rect(x, top, x + CHAR, top + CHAR));
          if (!withView) { delete g.viewBoundingBox; delete g.viewCornerPoints; }
          return { text: c, confidence: 0.93, ...g };
        });
        const x = left + offset * CHAR;
        offset += Array.from(chunk).length;
        const g = geometry(rect(x, top, left + offset * CHAR, top + CHAR));
        if (!withView) { delete g.viewBoundingBox; delete g.viewCornerPoints; }
        return { text: chunk, confidence: 0.92, symbols, ...g };
      });
      const g = geometry(rect(left, top, left + chars.length * CHAR, top + CHAR));
      if (!withView) { delete g.viewBoundingBox; delete g.viewCornerPoints; }
      const line = { text, confidence: 0.92, recognizedLanguage: 'ja', elements, ...g };
      const segments = text.startsWith('日本語')
        ? [{ text: '日本語', reading: 'にほんご' }, { text: text.slice(3) }]
        : [{ text }];
      const block = { text, recognizedLanguage: 'ja', lines: [line], segments, ...g };
      return block;
    });
    const furigana = [{ text: 'にほんご', base: '日本語', block: 1, start: 0, end: 3, ...geometry(rect(left2(), 210, left2() + 3 * CHAR, 226)) }];
    if (!withView) furigana.forEach((f) => { delete f.viewBoundingBox; delete f.viewCornerPoints; });
    return { text: blocks.map((b) => b.text).join('\n'), blocks, furigana, vertical: false, imageWidth: 1170, imageHeight: 2532 };
  }

  const reply = (callbackId, pluginId, methodName, data, error, save) =>
    setTimeout(() =>
      window.Capacitor.fromNative({ callbackId, pluginId, methodName, success: !error, data, error, save }), 5);
  const reject = (message, code) => ({ message, code });

  let frameTimer = null;
  function startFrames() {
    frameTimer = setInterval(() => {
      if (!state.running || state.frozen) return;
      for (const id of listeners.textRecognized || []) reply(id, 'JapaneseOcr', 'addListener', frame(true), null, true);
    }, 300);
  }

  const ocr = {
    isDeviceSupported: () => ({ supported: true, liveCamera: true, handwriting: true }),
    isHandwritingReady: () => ({ ready: state.inkModel }),
    prepareHandwriting: () => { state.inkModel = true; },
    recognizeHandwriting: (o) => {
      if (!Array.isArray(o.strokes)) throw reject('strokes is missing', 'INVALID_ARGUMENT');
      state.inkModel = true;
      state.lastInk = o;
      if (!o.strokes.length) return { text: '', candidates: [] };
      // Same shape as JapaneseOcrPlugin.candidatesResult(); probabilities are softmax of -score.
      const texts = ['日本', '日木', '曰本', '目本', '日太'].slice(0, o.maxResults || 5);
      const scores = texts.map((_, i) => 1 + i * 0.8);
      const exp = scores.map((s) => Math.exp(scores[0] - s));
      const sum = exp.reduce((a, b) => a + b, 0);
      const candidates = texts.map((text, i) => ({ text, score: scores[i], probability: exp[i] / sum }));
      return { text: texts[0], candidates };
    },
    isOcrReady: () => ({ ready: true }),
    checkPermissions: () => ({ camera: state.permission }),
    requestPermissions: () => { state.permission = 'granted'; return { camera: 'granted' }; },
    startLiveRecognition: () => {
      if (state.running) throw reject('Live recognition is already running.', 'ALREADY_RUNNING');
      state.permission = 'granted';
      state.running = true;
      startFrames();
    },
    stopLiveRecognition: () => { state.running = false; state.frozen = false; clearInterval(frameTimer); },
    captureFrame: (o) => {
      if (!state.running) throw reject('Live recognition is not running.', 'NOT_RUNNING');
      state.frozen = true;
      const r = frame(true);
      if (o.saveImage) r.imagePath = 'file:///data/user/0/com.yukarusan.japaneseocr.testapp/cache/japanese-ocr/capture-1.jpg';
      return r;
    },
    resumeLiveRecognition: () => {
      if (!state.running) throw reject('Live recognition is not running.', 'NOT_RUNNING');
      state.frozen = false;
    },
    getLiveState: () => ({ running: state.running, frozen: state.frozen }),
    setTorch: (o) => { if (!state.running) throw reject('Live recognition is not running.', 'NOT_RUNNING'); state.torch = o.enabled; },
    recognizeImage: (o) => {
      if (!o.path && !o.base64) throw reject('Either path or base64 is required.', 'INVALID_ARGUMENT');
      return frame(false);
    },
    recognizeFromGallery: (o) => {
      state.lastGallery = o;
      if (state.pickerCancels) throw reject('No image was selected.', 'CANCELLED');
      const r = frame(false);
      r.imagePath = 'content://media/picker/0/com.android.providers.media.photopicker/media/1000000033';
      return r;
    },
  };
  const clipboard = {
    write: (o) => { state.clipboard = o.string; },
    read: () => ({ value: state.clipboard, type: 'text/plain' }),
  };
  const plugins = { JapaneseOcr: ocr, Clipboard: clipboard };

  window.__fakeAndroid = state;
  window.androidBridge = {
    postMessage(json) {
      const call = JSON.parse(json);
      const { callbackId, pluginId, methodName, options } = call;
      if (methodName === 'addListener') {
        (listeners[options.eventName] = listeners[options.eventName] || []).push(callbackId);
        return;
      }
      if (methodName === 'removeAllListeners') {
        for (const k of Object.keys(listeners)) delete listeners[k];
        return reply(callbackId, pluginId, methodName, {});
      }
      const plugin = plugins[pluginId];
      if (!plugin || !plugin[methodName]) return; // Console, App, etc.
      try {
        reply(callbackId, pluginId, methodName, plugin[methodName](options || {}) || {});
      } catch (e) {
        reply(callbackId, pluginId, methodName, undefined, e);
      }
    },
  };

  // Paint the "camera image" behind the transparent WebView, at the same place the boxes point to.
  window.addEventListener('DOMContentLoaded', () => {
    const cam = document.createElement('div');
    cam.id = '__fake-camera';
    Object.assign(cam.style, { position: 'fixed', inset: '0', zIndex: '-1', background: '#3b3b3b', display: 'none' });
    for (const [text, left, top] of LINES) {
      const el = document.createElement('div');
      el.textContent = text;
      Object.assign(el.style, { position: 'absolute', left: left + 'px', top: top + 'px', font: `${CHAR}px/1 sans-serif`, color: '#111', background: '#f5f0e1', letterSpacing: '0', whiteSpace: 'nowrap' });
      cam.appendChild(el);
    }
    document.documentElement.appendChild(cam);
    setInterval(() => { cam.style.display = state.running ? 'block' : 'none'; }, 50);
  });
})();
