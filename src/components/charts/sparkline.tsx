/** Mini-courbe SVG (sans dépendance, rendue côté serveur). */
export function Sparkline({
  values,
  color,
  width = 72,
  height = 24,
  fill = false,
  className,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
  fill?: boolean;
  className?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 2;
  const points = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    pad + (1 - (v - min) / range) * (height - pad * 2),
  ]);
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x!.toFixed(1)},${y!.toFixed(1)}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      preserveAspectRatio="none"
      aria-hidden
    >
      {fill && <path d={`${line} L${width},${height} L0,${height} Z`} fill={color} opacity={0.12} />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
