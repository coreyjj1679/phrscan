import { useState, useEffect } from "react";
import { formatGwei, type PublicClient } from "viem";

type FeePoint = { base: bigint; ratio: number };
type GasData = {
  baseFee: bigint | null;
  gasPrice: bigint;
  priorityFee: bigint | null;
  history: FeePoint[];
};

function gwei(x: bigint): string {
  const n = Number(formatGwei(x));
  if (n === 0) return "0";
  if (n < 0.01) return n.toPrecision(2);
  return String(parseFloat(n.toFixed(4)));
}

export function GasDashboard({ client }: { client: PublicClient }) {
  const [data, setData] = useState<GasData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [, force] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const [block, gasPrice, rpcPriority, history] = await Promise.all([
          client.getBlock(),
          client.getGasPrice().catch(() => 0n),
          client.estimateMaxPriorityFeePerGas().catch(() => null),
          client
            .getFeeHistory({ blockCount: 24, rewardPercentiles: [50] })
            .catch(() => null),
        ]);
        if (cancelled) return;
        const points: FeePoint[] = [];
        if (history) {
          const bases = history.baseFeePerGas ?? [];
          const ratios = history.gasUsedRatio ?? [];
          for (let i = 0; i < ratios.length; i++) {
            points.push({ base: bases[i] ?? 0n, ratio: ratios[i] ?? 0 });
          }
        }
        const baseFee = block.baseFeePerGas ?? null;
        // Some nodes (e.g. Pharos) return eth_maxPriorityFeePerGas = 0 even when
        // the gas price sits far above base fee, making the stats contradict each
        // other. Fall back to the effective tip (gasPrice - baseFee) when larger.
        const effectiveTip =
          baseFee !== null && gasPrice > baseFee ? gasPrice - baseFee : 0n;
        const priorityFee =
          rpcPriority !== null && rpcPriority > effectiveTip
            ? rpcPriority
            : effectiveTip;
        setData({
          baseFee,
          gasPrice,
          priorityFee,
          history: points,
        });
        setError(null);
        setUpdatedAt(Date.now());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    fetchData();
    const poll = setInterval(fetchData, 15000);
    const tick = setInterval(() => force((n) => n + 1), 1000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [client]);

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-surface p-3 text-xs text-red-400 sm:p-4">
        Gas data unavailable: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-lg border border-border bg-surface p-3 text-xs text-gray-500 sm:p-4">
        <span className="animate-pulse">Loading gas &amp; fees…</span>
      </div>
    );
  }

  const ago = updatedAt ? Math.max(0, Math.floor((Date.now() - updatedAt) / 1000)) : 0;
  const avgFull =
    data.history.length > 0
      ? (data.history.reduce((s, p) => s + p.ratio, 0) / data.history.length) * 100
      : 0;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-100">Gas &amp; fees</h3>
        <span className="text-xs text-gray-600">updated {ago}s ago</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Base fee" value={data.baseFee !== null ? gwei(data.baseFee) : "—"} unit="gwei" accent="text-cyan-300" />
        <Stat label="Gas price" value={gwei(data.gasPrice)} unit="gwei" accent="text-amber-300" />
        <Stat
          label="Priority fee"
          value={data.priorityFee !== null ? gwei(data.priorityFee) : "—"}
          unit="gwei"
          accent="text-violet-300"
          title="Effective tip over base fee. Falls back to gasPrice − baseFee when the node reports 0."
        />
      </div>

      {data.history.length > 1 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-inset p-2 ring-1 ring-border/60">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium tracking-wider text-gray-600 uppercase">
                Base fee · last {data.history.length}
              </span>
            </div>
            <Sparkline values={data.history.map((p) => Number(formatGwei(p.base)))} />
          </div>
          <div className="rounded-md bg-inset p-2 ring-1 ring-border/60">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium tracking-wider text-gray-600 uppercase">
                Block fullness
              </span>
              <span className="font-mono text-xs text-gray-500">avg {avgFull.toFixed(2)}%</span>
            </div>
            <Bars ratios={data.history.map((p) => p.ratio)} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  accent,
  title,
}: {
  label: string;
  value: string;
  unit: string;
  accent: string;
  title?: string;
}) {
  return (
    <div className="rounded-md bg-inset px-3 py-2 ring-1 ring-border/60" title={title}>
      <span className="block text-xs font-medium tracking-wider text-gray-600 uppercase">
        {label}
      </span>
      <span className="mt-0.5 block font-mono text-lg leading-tight">
        <span className={accent}>{value}</span>{" "}
        <span className="text-xs text-gray-600">{unit}</span>
      </span>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const W = 240;
  const H = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = max === min;
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = flat ? H / 2 : H - 4 - ((v - min) / span) * (H - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-10 w-full">
      <polyline points={pts} fill="none" stroke="#22d3ee" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Bars({ ratios }: { ratios: number[] }) {
  const H = 40;
  const gap = 2;
  const n = ratios.length;
  const bw = (240 - gap * (n - 1)) / n;
  return (
    <svg viewBox={`0 0 240 ${H}`} preserveAspectRatio="none" className="h-10 w-full">
      {ratios.map((r, i) => {
        const pct = Math.min(1, Math.max(0, r));
        const h = Math.max(pct > 0 ? 1 : 0, pct * (H - 2));
        const x = i * (bw + gap);
        const fill = pct > 0.8 ? "#f87171" : pct > 0.5 ? "#fbbf24" : "#4b5563";
        return <rect key={i} x={x} y={H - h} width={bw} height={h} rx={1} fill={fill} />;
      })}
    </svg>
  );
}
