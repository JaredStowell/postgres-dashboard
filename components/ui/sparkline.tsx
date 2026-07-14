export function Sparkline({
  values,
  label = "Trend",
}: {
  values: number[];
  label?: string;
}) {
  const width = 100;
  const height = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const points = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width;
    const y = height - ((value - min) / range) * (height - 5) - 2;
    return `${x},${y}`;
  });
  const line = points.join(" ");
  const area = `0,${height} ${line} ${width},${height}`;

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polygon className="area" points={area} />
      <polyline className="line" points={line} />
    </svg>
  );
}

export function TrendChart({
  values,
  label,
}: {
  values: number[];
  label: string;
}) {
  if (values.length < 2) {
    return (
      <div className="empty-state" style={{ minHeight: 130 }}>
        <div>
          <h2>No collected history yet</h2>
          <p>The collector needs at least two usable, reset-aware snapshots.</p>
        </div>
      </div>
    );
  }
  const width = 800;
  const height = 160;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const points = values.map(
    (value, index) =>
      `${(index / Math.max(values.length - 1, 1)) * width},${height - ((value - min) / range) * (height - 20) - 10}`,
  );
  const line = points.join(" ");
  return (
    <div className="trend-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop stopColor="#4de8ff" stopOpacity=".22" />
            <stop offset="1" stopColor="#4de8ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          className="area"
          points={`0,${height} ${line} ${width},${height}`}
        />
        <polyline className="line" points={line} />
      </svg>
    </div>
  );
}
