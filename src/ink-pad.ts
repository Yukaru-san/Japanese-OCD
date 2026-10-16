import type { InkStroke } from 'capacitor-japanese-ocr';

/**
 * A drawing area on a <canvas>: collects the strokes for recognizeHandwriting() and draws them.
 * `onChange` fires shortly after the user lifts the finger, and after undo / clear.
 */
export class InkPad {
  readonly strokes: InkStroke[] = [];
  private readonly ctx: CanvasRenderingContext2D;
  private timer: number | undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onChange: () => void,
    private readonly delayMs = 300,
  ) {
    this.ctx = canvas.getContext('2d')!;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  get width(): number {
    return this.canvas.clientWidth;
  }

  get height(): number {
    return this.canvas.clientHeight;
  }

  undo(): void {
    this.strokes.pop();
    this.redraw();
    this.onChange();
  }

  clear(): void {
    this.strokes.length = 0;
    this.redraw();
    this.onChange();
  }

  private point(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left - this.canvas.clientLeft, y: e.clientY - r.top - this.canvas.clientTop, t: Date.now() };
  }

  private down(e: PointerEvent): void {
    clearTimeout(this.timer);
    this.canvas.setPointerCapture(e.pointerId);
    this.strokes.push({ points: [this.point(e)] });
    this.redraw();
  }

  private move(e: PointerEvent): void {
    if (!this.canvas.hasPointerCapture(e.pointerId)) return;
    const points = this.strokes[this.strokes.length - 1].points;
    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ev of events.length ? events : [e]) points.push(this.point(ev));
    this.redraw();
  }

  private up(e: PointerEvent): void {
    if (!this.canvas.hasPointerCapture(e.pointerId)) return;
    this.canvas.releasePointerCapture(e.pointerId);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(this.onChange, this.delayMs);
  }

  private resize(): void {
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.canvas.clientWidth * ratio);
    this.canvas.height = Math.round(this.canvas.clientHeight * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.redraw();
  }

  private redraw(): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = getComputedStyle(this.canvas).color;
    for (const stroke of this.strokes) {
      const [first, ...rest] = stroke.points;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      if (!rest.length) ctx.lineTo(first.x + 0.1, first.y);
      for (const p of rest) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }
}
