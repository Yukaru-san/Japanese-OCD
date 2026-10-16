/**
 * Full-screen editor shown before a still image is recognized: the user can rotate the image and
 * draw one or more frames around the text they want. Browser version of `RegionSelector.java`,
 * with the same look, gestures and texts.
 */
import type { Rect } from '../definitions';

import { rotate } from './image';

export interface Selection {
  /** The image, rotated as the user chose. */
  image: HTMLCanvasElement;
  /** Clockwise rotation the user applied, in degrees. */
  rotation: number;
  /** Frames in pixels of `image`, in the order they were drawn; empty for the whole image. */
  regions: Rect[];
}

const TEXTS: Record<string, { hint: string; rotate: string; clear: string; cancel: string; done: string }> = {
  en: {
    hint: 'Drag a frame around the text you want. You can add several frames, or recognize the whole image.',
    rotate: 'Rotate',
    clear: 'Clear',
    cancel: 'Cancel',
    done: 'Recognize',
  },
  de: {
    hint: 'Ziehe einen Rahmen um den gewünschten Text. Mehrere Rahmen sind möglich, ohne Rahmen wird das ganze Bild erkannt.',
    rotate: 'Drehen',
    clear: 'Leeren',
    cancel: 'Abbrechen',
    done: 'Erkennen',
  },
  ja: {
    hint: '読み取りたい文字を枠で囲んでください。枠は複数作成できます。枠がない場合は画像全体を読み取ります。',
    rotate: '回転',
    clear: 'クリア',
    cancel: 'キャンセル',
    done: '読み取る',
  },
};

interface Frame {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Resolves with the selection, or null when the user cancels. */
export function selectRegions(source: HTMLCanvasElement): Promise<Selection | null> {
  return new Promise((resolve) => new Editor(source, resolve));
}

class Editor {
  private rotation = 0;
  /** Frames in pixels of the rotated image. */
  private frames: Frame[] = [];
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private mode: 'none' | 'create' | 'move' | 'resize' = 'none';
  private active: Frame | null = null;
  private corner = 0;
  private down = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  private readonly dpr = window.devicePixelRatio || 1;
  private readonly onResize = () => this.layout();
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.finish(null);
  };

  constructor(
    private readonly source: HTMLCanvasElement,
    private readonly done: (selection: Selection | null) => void,
  ) {
    const lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
    const t = TEXTS[lang] ?? TEXTS.en;

    this.root = document.createElement('div');
    this.root.className = 'japanese-ocr-select';
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      background: '#000',
      display: 'flex',
      flexDirection: 'column',
      color: '#fff',
      font: '15px system-ui, sans-serif',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
      touchAction: 'none',
      userSelect: 'none',
    });

    const hint = document.createElement('div');
    hint.textContent = t.hint;
    Object.assign(hint.style, { padding: '12px', textAlign: 'center' });

    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, { flex: '1', minHeight: '0', width: '100%', touchAction: 'none' });

    const bar = document.createElement('div');
    Object.assign(bar.style, { display: 'flex', gap: '6px', padding: '6px' });
    const button = (label: string, action: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      Object.assign(b.style, {
        flex: '1',
        padding: '12px 4px',
        font: 'inherit',
        color: '#fff',
        background: '#333',
        border: '0',
        borderRadius: '6px',
      });
      b.addEventListener('click', action);
      bar.appendChild(b);
      return b;
    };
    button(t.rotate, () => this.rotate());
    button(t.clear, () => {
      this.frames = [];
      this.draw();
    });
    button(t.cancel, () => this.finish(null));
    button(t.done, () =>
      this.finish({
        image: rotate(this.source, this.rotation),
        rotation: this.rotation,
        regions: this.frames.map((f) => ({
          left: Math.round(f.left),
          top: Math.round(f.top),
          right: Math.round(f.right),
          bottom: Math.round(f.bottom),
        })),
      }),
    );

    this.root.append(hint, this.canvas, bar);
    document.body.appendChild(this.root);

    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      const p = this.point(e);
      this.down = p;
      this.last = p;
      this.start(p.x, p.y);
      this.draw();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.mode === 'none') return;
      const p = this.point(e);
      this.drag(p.x, p.y);
      this.last = p;
      this.draw();
    });
    const up = () => {
      this.end();
      this.draw();
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    this.layout();
  }

  private finish(selection: Selection | null): void {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
    this.done(selection);
  }

  private point(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private imageWidth(): number {
    return this.rotation % 180 === 0 ? this.source.width : this.source.height;
  }

  private imageHeight(): number {
    return this.rotation % 180 === 0 ? this.source.height : this.source.width;
  }

  private rotate(): void {
    // Rotate the frames with the image, clockwise.
    const oldHeight = this.imageHeight();
    this.frames = this.frames.map((f) => ({
      left: oldHeight - f.bottom,
      top: f.left,
      right: oldHeight - f.top,
      bottom: f.right,
    }));
    this.rotation = (this.rotation + 90) % 360;
    this.layout();
  }

  /** Image (rotated) pixels → CSS pixels of the canvas, fitted and centered. */
  private layout(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.round(width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(height * this.dpr));
    const margin = 12;
    const w = Math.max(1, width - 2 * margin);
    const h = Math.max(1, height - 2 * margin);
    this.scale = Math.min(w / this.imageWidth(), h / this.imageHeight());
    this.offsetX = (width - this.imageWidth() * this.scale) / 2;
    this.offsetY = (height - this.imageHeight() * this.scale) / 2;
    this.draw();
  }

  private toView(f: Frame): Frame {
    return {
      left: f.left * this.scale + this.offsetX,
      top: f.top * this.scale + this.offsetY,
      right: f.right * this.scale + this.offsetX,
      bottom: f.bottom * this.scale + this.offsetY,
    };
  }

  private toImage(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.offsetX) / this.scale, y: (y - this.offsetY) / this.scale };
  }

  private imageBounds(): Frame {
    return this.toView({ left: 0, top: 0, right: this.imageWidth(), bottom: this.imageHeight() });
  }

  private deleteBadge(v: Frame): { x: number; y: number } {
    return { x: (v.left + v.right) / 2, y: v.top - 16 < 0 ? v.top + 16 : v.top - 16 };
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    // Draw the source rotated into the rotated image space.
    ctx.translate(this.imageWidth() / 2, this.imageHeight() / 2);
    ctx.rotate((this.rotation * Math.PI) / 180);
    ctx.drawImage(this.source, -this.source.width / 2, -this.source.height / 2);
    ctx.restore();

    if (!this.frames.length) return;
    const bounds = this.imageBounds();
    const views = this.frames.map((f) => this.toView(f));
    ctx.save();
    ctx.beginPath();
    ctx.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
    for (const v of views) ctx.rect(v.right, v.top, v.left - v.right, v.bottom - v.top); // reversed: a hole
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fill('evenodd');
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.font = '14px system-ui, sans-serif';
    views.forEach((v, i) => {
      ctx.strokeStyle = '#4FC3F7';
      ctx.lineWidth = 2;
      ctx.strokeRect(v.left, v.top, v.right - v.left, v.bottom - v.top);
      ctx.fillStyle = '#4FC3F7';
      for (const [x, y] of [
        [v.left, v.top],
        [v.right, v.top],
        [v.left, v.bottom],
        [v.right, v.bottom],
      ]) {
        circle(ctx, x, y, 6);
      }
      // Number in the order of selection, delete badge at the top center.
      circle(ctx, v.left + 14, v.top + 14, 10);
      ctx.fillStyle = '#fff';
      ctx.fillText(String(i + 1), v.left + 14, v.top + 19);
      const b = this.deleteBadge(v);
      ctx.fillStyle = '#E53935';
      circle(ctx, b.x, b.y, 11);
      ctx.fillStyle = '#fff';
      ctx.fillText('×', b.x, b.y + 5);
    });
  }

  private start(x: number, y: number): void {
    const touch = 24;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const v = this.toView(this.frames[i]);
      const b = this.deleteBadge(v);
      if (Math.hypot(x - b.x, y - b.y) < touch) {
        this.frames.splice(i, 1);
        this.mode = 'none';
        return;
      }
      const corners = [
        [v.left, v.top],
        [v.right, v.top],
        [v.left, v.bottom],
        [v.right, v.bottom],
      ];
      for (let c = 0; c < 4; c++) {
        if (Math.hypot(x - corners[c][0], y - corners[c][1]) < touch) {
          this.mode = 'resize';
          this.active = this.frames[i];
          this.corner = c;
          return;
        }
      }
      if (x >= v.left && x <= v.right && y >= v.top && y <= v.bottom) {
        this.mode = 'move';
        this.active = this.frames[i];
        return;
      }
    }
    const bounds = this.imageBounds();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) {
      this.mode = 'none';
      return;
    }
    const p = this.toImage(x, y);
    this.active = { left: p.x, top: p.y, right: p.x, bottom: p.y };
    this.frames.push(this.active);
    this.mode = 'create';
  }

  private drag(x: number, y: number): void {
    const active = this.active;
    if (this.mode === 'none' || !active) return;
    const w = this.imageWidth();
    const h = this.imageHeight();
    const raw = this.toImage(x, y);
    const p = { x: Math.max(0, Math.min(w, raw.x)), y: Math.max(0, Math.min(h, raw.y)) };
    if (this.mode === 'create') {
      const d = this.toImage(this.down.x, this.down.y);
      Object.assign(active, {
        left: Math.min(d.x, p.x),
        top: Math.min(d.y, p.y),
        right: Math.max(d.x, p.x),
        bottom: Math.max(d.y, p.y),
      });
    } else if (this.mode === 'move') {
      const last = this.toImage(this.last.x, this.last.y);
      const dx = Math.max(-active.left, Math.min(w - active.right, raw.x - last.x));
      const dy = Math.max(-active.top, Math.min(h - active.bottom, raw.y - last.y));
      active.left += dx;
      active.right += dx;
      active.top += dy;
      active.bottom += dy;
    } else {
      const left = this.corner === 0 || this.corner === 2;
      const top = this.corner === 0 || this.corner === 1;
      if (left) active.left = p.x;
      else active.right = p.x;
      if (top) active.top = p.y;
      else active.bottom = p.y;
      Object.assign(active, {
        left: Math.min(active.left, active.right),
        right: Math.max(active.left, active.right),
        top: Math.min(active.top, active.bottom),
        bottom: Math.max(active.top, active.bottom),
      });
    }
  }

  private end(): void {
    if (this.mode === 'create' && this.active) {
      const v = this.toView(this.active);
      if (v.right - v.left < 16 || v.bottom - v.top < 16) this.frames.splice(this.frames.indexOf(this.active), 1);
    }
    this.mode = 'none';
    this.active = null;
  }
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
