/** Small geometry helpers for the text detector's post-processing. No DOM, no dependencies. */

export interface Pt {
  x: number;
  y: number;
}

/** Convex hull (Andrew's monotone chain), counter-clockwise, without collinear points. */
export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** A rotated rectangle: center, size and the unit vector of its `width` side. */
export interface RotatedRect {
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Direction of the width side. */
  ux: number;
  uy: number;
}

/** Minimum-area enclosing rectangle of a convex hull (rotating calipers over the hull edges). */
export function minAreaRect(hull: Pt[]): RotatedRect {
  let best: RotatedRect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = { cx: cu * ux - cv * uy, cy: cu * uy + cv * ux, width: maxU - minU, height: maxV - minV, ux, uy };
    }
  }
  return best ?? { cx: hull[0].x, cy: hull[0].y, width: 0, height: 0, ux: 1, uy: 0 };
}

/**
 * Corners of a rotated rectangle as top-left, top-right, bottom-right, bottom-left, oriented so
 * that the top edge is the side closest to horizontal.
 */
export function corners(rect: RotatedRect): Pt[] {
  let { ux, uy, width, height } = rect;
  // Make the "width" axis the one closer to horizontal, pointing right.
  if (Math.abs(ux) < Math.abs(uy)) {
    [ux, uy] = [-uy, ux];
    [width, height] = [height, width];
  }
  if (ux < 0) {
    ux = -ux;
    uy = -uy;
  }
  // Down vector, perpendicular to the width axis.
  const vx = -uy;
  const vy = ux;
  const hw = width / 2;
  const hh = height / 2;
  const { cx, cy } = rect;
  return [
    { x: cx - ux * hw - vx * hh, y: cy - uy * hw - vy * hh },
    { x: cx + ux * hw - vx * hh, y: cy + uy * hw - vy * hh },
    { x: cx + ux * hw + vx * hh, y: cy + uy * hw + vy * hh },
    { x: cx - ux * hw + vx * hh, y: cy - uy * hw + vy * hh },
  ];
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
