import { alphaBounds } from './frameAlignment';

export type SizeMetric = 'longest' | 'width' | 'height' | 'coverage';
export function measureAlpha(data: Uint8ClampedArray, width: number, height: number) {
  const bounds = alphaBounds(data, width, height, 1);
  let mass = 0;
  for (let i = 3; i < data.length; i += 4) mass += data[i] / 255;
  return bounds && mass > 0 ? { ...bounds, mass } : null;
}
export type AlphaMeasure = NonNullable<ReturnType<typeof measureAlpha>>;

/** Source-space calculation: uniform scaling preserves aspect ratio and alpha. */
export function solveMeasuredSize(source: AlphaMeasure, canvasSize: number, baseEdge: number,
  metric: SizeMetric, targetPercent: number, marginPercent: number) {
  if (![canvasSize, baseEdge, targetPercent, marginPercent].every(Number.isFinite) ||
    canvasSize <= 0 || baseEdge <= 0 || targetPercent <= 0 || marginPercent < 0 || marginPercent >= 50) return null;
  const longest = Math.max(source.width, source.height);
  const desired = metric === 'coverage'
    ? Math.sqrt(targetPercent / 100 * canvasSize ** 2 / source.mass) * longest
    : targetPercent / 100 * canvasSize * longest /
      (metric === 'width' ? source.width : metric === 'height' ? source.height : longest);
  const ceiling = Math.min(canvasSize * (1 - 2 * marginPercent / 100), baseEdge * 2);
  if (ceiling < baseEdge * .25) return null;
  const edge = Math.max(baseEdge * .25, Math.min(desired, ceiling));
  const ratio = edge / longest;
  return { scale: edge / baseEdge, width: source.width * ratio, height: source.height * ratio,
    coverage: source.mass * ratio ** 2 / canvasSize ** 2 * 100,
    limited: Math.abs(edge - desired) > .01 };
}
