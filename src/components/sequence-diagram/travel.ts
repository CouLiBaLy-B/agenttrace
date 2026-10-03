export interface Pt { x: number; y: number }

/** Points along a cubic Bézier, at `steps` equal parameter steps (steps + 1 points). */
export function sampleCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, steps: number): Pt[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    const u = 1 - t
    const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
    return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y }
  })
}

/** Keyframes (offsets from the first point) for a marker riding the tip of a
 * line drawn along `points` with pathLength and `ease`: at each of `steps`
 * equal time steps it sits at the eased share of the polyline's length. Play
 * them with a linear ease. */
export function travelKeyframes(points: Pt[], ease: (t: number) => number, steps = 12): { x: number[]; y: number[] } {
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
  }
  const total = cumulative.at(-1)!
  const x: number[] = []
  const y: number[] = []
  for (let k = 0; k <= steps; k++) {
    const d = ease(k / steps) * total
    let i = 1
    while (i < points.length - 1 && cumulative[i] < d) i++
    const span = cumulative[i] - cumulative[i - 1]
    const f = span > 0 ? (d - cumulative[i - 1]) / span : 0
    x.push(points[i - 1].x + (points[i].x - points[i - 1].x) * f - points[0].x)
    y.push(points[i - 1].y + (points[i].y - points[i - 1].y) * f - points[0].y)
  }
  return { x, y }
}
