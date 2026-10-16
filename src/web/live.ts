/**
 * Live camera for the web engine: a `getUserMedia` video fills the window behind the page, like
 * the native preview behind the WebView, and frames are recognized at an interval.
 */
import type { Pt } from './geometry';
import { toCanvas } from './image';

export const LIVE_CLASS = 'japanese-ocr-live';
const STYLE_ID = 'japanese-ocr-live-style';

export class LiveCamera {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  frozen = false;
  /** A capture is in progress. */
  capturing = false;

  constructor(
    private readonly front: boolean,
    private readonly intervalMs: number,
    /** Called with each frame; the next frame waits until the returned promise settles. */
    private readonly onFrame: (frame: HTMLCanvasElement, view: (p: Pt) => Pt) => Promise<void>,
  ) {
    this.video = document.createElement('video');
    this.video.className = 'japanese-ocr-preview';
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
    Object.assign(this.video.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      objectFit: 'cover',
      zIndex: '-2147483647',
      pointerEvents: 'none',
      background: '#000',
    });
  }

  /** Opens the camera. Rejects with the browser's error (NotAllowedError, NotFoundError, ...). */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: this.front ? 'user' : 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    if (this.stopped) {
      this.release();
      return;
    }
    this.video.srcObject = this.stream;
    document.body.appendChild(this.video);
    showBehindPage(true);
    await this.video.play();
    await new Promise<void>((resolve) => {
      if (this.video.videoWidth > 0) resolve();
      else this.video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
    this.schedule(0);
  }

  get running(): boolean {
    return this.stream != null && !this.stopped;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.release();
    this.video.remove();
    showBehindPage(false);
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.analyze(), delay);
  }

  private async analyze(): Promise<void> {
    if (this.stopped) return;
    const started = Date.now();
    // Paused while frozen, while capturing and while the page is in the background.
    if (!this.frozen && !this.capturing && document.visibilityState === 'visible' && this.video.videoWidth > 0) {
      try {
        await this.onFrame(this.frame(), this.viewMapper());
      } catch {
        // Reported by onFrame itself.
      }
    }
    this.schedule(Math.max(0, this.intervalMs - (Date.now() - started)));
  }

  /** The current camera picture at full stream resolution. */
  frame(): HTMLCanvasElement {
    return toCanvas(this.video);
  }

  /** Freezes the preview on the current picture and returns it. */
  freeze(): HTMLCanvasElement {
    const frame = this.frame();
    this.video.pause();
    this.frozen = true;
    return frame;
  }

  resume(): void {
    this.frozen = false;
    void this.video.play();
  }

  /** Maps camera pixels to CSS pixels of the page, for the `object-fit: cover` preview. */
  viewMapper(): (p: Pt) => Pt {
    const vw = this.video.clientWidth || window.innerWidth;
    const vh = this.video.clientHeight || window.innerHeight;
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    const scale = Math.max(vw / w, vh / h);
    const ox = (vw - w * scale) / 2;
    const oy = (vh - h * scale) / 2;
    return (p) => ({ x: p.x * scale + ox, y: p.y * scale + oy });
  }

  private track(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  hasFlash(): boolean {
    const track = this.track();
    if (!track || typeof track.getCapabilities !== 'function') return false;
    return !!(track.getCapabilities() as { torch?: boolean }).torch;
  }

  async setTorch(enabled: boolean): Promise<void> {
    await this.track()?.applyConstraints({ advanced: [{ torch: enabled } as MediaTrackConstraintSet] });
  }
}

/**
 * Makes the page transparent so the preview behind it is visible, like the native plugin does:
 * class `japanese-ocr-live` on `<html>` and a rule that clears the html/body backgrounds.
 */
function showBehindPage(show: boolean): void {
  document.documentElement.classList.toggle(LIVE_CLASS, show);
  let style = document.getElementById(STYLE_ID);
  if (show && !style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `html.${LIVE_CLASS}, html.${LIVE_CLASS} body { background: transparent !important }`;
    document.head.appendChild(style);
  } else if (!show && style) {
    style.remove();
  }
}
