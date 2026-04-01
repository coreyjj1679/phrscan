import { useState, useMemo, useRef, useEffect } from "react";
import { formatEther, formatUnits } from "viem";
import type { TraceCall } from "../lib/trace";
import type { DecodedLog } from "../lib/simulate";
import type { AddressBook } from "../hooks/useAddressBook";

type Props = {
  trace: TraceCall;
  logs?: DecodedLog[];
  book: AddressBook;
};

type Transfer = {
  from: string;
  to: string;
  amount: bigint;
  symbol: string;
  decimals: number;
  logIndex: number | "trace";
  traceIndex: number;
};

function extractNativeTransfers(trace: TraceCall, transfers: Transfer[], counter: { value: number }) {
  const idx = counter.value++;
  const val = BigInt(trace.value);
  if (val > 0n && trace.type !== "DELEGATECALL") {
    transfers.push({
      from: trace.from.toLowerCase(),
      to: trace.to.toLowerCase(),
      amount: val,
      symbol: "PHRS",
      decimals: 18,
      logIndex: "trace",
      traceIndex: idx,
    });
  }
  if (trace.calls) {
    for (const sub of trace.calls) {
      extractNativeTransfers(sub, transfers, counter);
    }
  }
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function extractErc20Transfers(logs: DecodedLog[], transfers: Transfer[]) {
  logs.forEach((log, i) => {
    if (
      log.eventName === "Transfer" &&
      log.args.from &&
      log.args.to &&
      (log.args.value !== undefined || log.args.amount !== undefined)
    ) {
      const amount = BigInt(String(log.args.value ?? log.args.amount ?? "0"));
      if (amount > 0n) {
        transfers.push({
          from: String(log.args.from).toLowerCase(),
          to: String(log.args.to).toLowerCase(),
          amount,
          symbol: "ERC20",
          decimals: 18,
          logIndex: i,
          traceIndex: -1,
        });
      }
      return;
    }

    const topic0 = log.raw.topics[0];
    if (topic0?.toLowerCase() === TRANSFER_TOPIC && log.raw.topics.length >= 3) {
      const from = "0x" + log.raw.topics[1]?.slice(26);
      const to = "0x" + log.raw.topics[2]?.slice(26);
      let amount = 0n;
      try {
        amount = BigInt(log.raw.data);
      } catch { /* skip */ }
      if (amount > 0n) {
        transfers.push({
          from: from.toLowerCase(),
          to: to.toLowerCase(),
          amount,
          symbol: "ERC20",
          decimals: 18,
          logIndex: i,
          traceIndex: -1,
        });
      }
    }
  });
}

function formatAmount(amount: bigint, decimals: number, symbol: string): string {
  const formatted = decimals === 18
    ? formatEther(amount)
    : formatUnits(amount, decimals);
  const num = parseFloat(formatted);
  const display = num > 1e6
    ? num.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : num > 1
      ? num.toLocaleString(undefined, { maximumFractionDigits: 4 })
      : formatted.length > 10
        ? formatted.slice(0, 10) + "…"
        : formatted;
  return `${display} ${symbol}`;
}

function shortAddr(addr: string): string {
  if (addr.length < 10) return addr;
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

type NodeLayout = {
  id: string;
  x: number;
  y: number;
  label?: string;
};

type EdgeLayout = {
  from: NodeLayout;
  to: NodeLayout;
  transfer: Transfer;
  index: number;
  edgeGroupIndex: number;
  edgeGroupSize: number;
};

const NODE_W = 120;
const NODE_H = 36;
const PADDING_X = 20;
const PADDING_Y = 60;
const GAP_Y = 80;

export function MoneyFlow({ trace, logs, book }: Props) {
  const [useLabels, setUseLabels] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const transfers = useMemo(() => {
    const result: Transfer[] = [];
    const counter = { value: 0 };
    extractNativeTransfers(trace, result, counter);
    if (logs) extractErc20Transfers(logs, result);
    return result;
  }, [trace, logs]);

  const addresses = useMemo(() => {
    const set = new Set<string>();
    for (const t of transfers) {
      set.add(t.from);
      set.add(t.to);
    }
    return [...set];
  }, [transfers]);

  const cols = Math.max(2, Math.min(4, Math.floor((containerWidth - PADDING_X * 2) / (NODE_W + 40))));
  const rows = Math.ceil(Math.max(addresses.length, 1) / cols);
  const colWidth = Math.max(NODE_W + 20, (containerWidth - PADDING_X * 2) / cols);

  const nodes: NodeLayout[] = useMemo(() => {
    return addresses.map((addr, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      return {
        id: addr,
        x: PADDING_X + col * colWidth + colWidth / 2,
        y: PADDING_Y + row * GAP_Y + NODE_H / 2,
        label: book.resolve(addr),
      };
    });
  }, [addresses, cols, colWidth, book]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, NodeLayout>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  const edges: EdgeLayout[] = useMemo(() => {
    const groupKey = (from: string, to: string) => `${from}->${to}`;
    const groups = new Map<string, Transfer[]>();
    for (const t of transfers) {
      const key = groupKey(t.from, t.to);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }

    const result: EdgeLayout[] = [];
    for (const [, group] of groups) {
      group.forEach((t, gi) => {
        const fromNode = nodeMap.get(t.from);
        const toNode = nodeMap.get(t.to);
        if (!fromNode || !toNode) return;
        result.push({
          from: fromNode,
          to: toNode,
          transfer: t,
          index: result.length,
          edgeGroupIndex: gi,
          edgeGroupSize: group.length,
        });
      });
    }
    return result;
  }, [transfers, nodeMap]);

  const svgHeight = PADDING_Y + rows * GAP_Y + 30;

  if (transfers.length === 0) return null;

  return (
    <div className="space-y-2 rounded bg-gray-900/50 p-3 sm:p-4" ref={containerRef}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-200">Money Flow</h3>
        <span className="text-[11px] text-gray-500">{transfers.length} transfers</span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-500 select-none">
          <input
            type="checkbox"
            checked={useLabels}
            onChange={(e) => setUseLabels(e.target.checked)}
            className="size-3 rounded border-gray-600 bg-gray-900 accent-cyan-600"
          />
          Use labels
        </label>
      </div>

      <div className="overflow-x-auto">
        <svg
          width={containerWidth}
          height={svgHeight}
          className="w-full"
          style={{ minWidth: 320 }}
        >
          <defs>
            <marker
              id="arrowhead-yellow"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="#ca8a04" />
            </marker>
            <marker
              id="arrowhead-violet"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="#8b5cf6" />
            </marker>
          </defs>

          {edges.map((edge, i) => (
            <FlowEdge key={i} edge={edge} nodeH={NODE_H} />
          ))}

          {nodes.map((node) => (
            <FlowNode
              key={node.id}
              node={node}
              useLabels={useLabels}
              w={NODE_W}
              h={NODE_H}
            />
          ))}
        </svg>
      </div>

      <TransferTable transfers={transfers} book={book} useLabels={useLabels} />
    </div>
  );
}

function FlowNode({ node, useLabels, w, h }: {
  node: NodeLayout;
  useLabels: boolean;
  w: number;
  h: number;
}) {
  const display = useLabels && node.label
    ? node.label
    : shortAddr(node.id);
  const hasLabel = useLabels && !!node.label;

  return (
    <g>
      <rect
        x={node.x - w / 2}
        y={node.y - h / 2}
        width={w}
        height={h}
        rx={6}
        fill={hasLabel ? "#164e63" : "#1f2937"}
        stroke={hasLabel ? "#22d3ee" : "#374151"}
        strokeWidth={1}
      />
      <text
        x={node.x}
        y={node.y + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fill={hasLabel ? "#67e8f9" : "#9ca3af"}
        fontSize={11}
        fontFamily="monospace"
      >
        {display.length > 14 ? display.slice(0, 12) + "…" : display}
      </text>
    </g>
  );
}

function FlowEdge({ edge, nodeH }: {
  edge: EdgeLayout;
  nodeH: number;
}) {
  const { from, to, transfer, edgeGroupIndex, edgeGroupSize } = edge;
  const isNative = transfer.symbol === "PHRS";
  const color = isNative ? "#ca8a04" : "#8b5cf6";
  const markerId = isNative ? "arrowhead-yellow" : "arrowhead-violet";

  const offset = edgeGroupSize > 1
    ? (edgeGroupIndex - (edgeGroupSize - 1) / 2) * 12
    : 0;

  const amountStr = formatAmount(transfer.amount, transfer.decimals, transfer.symbol);
  const logLabel = transfer.logIndex === "trace"
    ? `T${transfer.traceIndex}`
    : `L${transfer.logIndex}`;

  const isSelf = from.id === to.id;
  if (isSelf) {
    const cy = from.y;
    const r = 20;
    const labelX = from.x + 80;
    const labelY = cy;
    return (
      <g>
        <path
          d={`M ${from.x + 50} ${cy - 8} A ${r} ${r} 0 1 1 ${from.x + 50} ${cy + 8}`}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray={isNative ? undefined : "4 2"}
          markerEnd={`url(#${markerId})`}
          opacity={0.7}
        />
        <rect
          x={labelX - 55}
          y={labelY - 9}
          width={110}
          height={18}
          rx={4}
          fill="#111827"
          fillOpacity={0.9}
          stroke={color}
          strokeWidth={0.5}
          strokeOpacity={0.4}
        />
        <text x={labelX - 46} y={labelY} dominantBaseline="central" fill="#6b7280" fontSize={8} fontFamily="monospace" fontWeight="bold">
          {logLabel}
        </text>
        <text x={labelX - 30} y={labelY} dominantBaseline="central" fill={color} fontSize={9} fontFamily="monospace">
          {amountStr.length > 16 ? amountStr.slice(0, 14) + "…" : amountStr}
        </text>
      </g>
    );
  }

  const sameRow = Math.abs(from.y - to.y) < 5;
  let path: string;

  if (sameRow) {
    const dir = to.x > from.x ? 1 : -1;
    const x1 = from.x + dir * 60;
    const x2 = to.x - dir * 60;
    const midX = (x1 + x2) / 2;
    const curveY = from.y - 30 - Math.abs(offset) * 2 + offset;
    path = `M ${x1} ${from.y} Q ${midX} ${curveY} ${x2} ${to.y}`;
  } else {
    const x1 = from.x + offset;
    const y1 = from.y + nodeH / 2;
    const x2 = to.x + offset;
    const y2 = to.y - nodeH / 2;
    const midY = (y1 + y2) / 2;
    path = `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`;
  }

  const midX = (from.x + to.x) / 2 + offset;
  const midY = sameRow
    ? Math.min(from.y, to.y) - 30 - Math.abs(offset) * 2 + offset
    : (from.y + to.y) / 2;

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={isNative ? undefined : "4 2"}
        markerEnd={`url(#${markerId})`}
        opacity={0.7}
      />
      <rect
        x={midX - 55}
        y={midY - 10 + offset / 2}
        width={110}
        height={18}
        rx={4}
        fill="#111827"
        fillOpacity={0.9}
        stroke={color}
        strokeWidth={0.5}
        strokeOpacity={0.4}
      />
      <text
        x={midX - 46}
        y={midY + offset / 2}
        dominantBaseline="central"
        fill="#6b7280"
        fontSize={8}
        fontFamily="monospace"
        fontWeight="bold"
      >
        {logLabel}
      </text>
      <text
        x={midX - 30}
        y={midY + offset / 2}
        dominantBaseline="central"
        fill={color}
        fontSize={9}
        fontFamily="monospace"
      >
        {amountStr.length > 16 ? amountStr.slice(0, 14) + "…" : amountStr}
      </text>
    </g>
  );
}

function TransferTable({ transfers, book, useLabels }: {
  transfers: Transfer[];
  book: AddressBook;
  useLabels: boolean;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const resolveDisplay = (addr: string) => {
    if (useLabels) {
      const label = book.resolve(addr);
      if (label) return label;
    }
    return shortAddr(addr);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-gray-800 text-left text-gray-500">
            <th className="px-2 py-1 font-medium">Index</th>
            <th className="px-2 py-1 font-medium">From</th>
            <th className="px-2 py-1 font-medium"></th>
            <th className="px-2 py-1 font-medium">To</th>
            <th className="px-2 py-1 font-medium text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {transfers.map((t, i) => {
            const logLabel = t.logIndex === "trace"
              ? `T${t.traceIndex}`
              : `L${t.logIndex}`;
            const isNative = t.symbol === "PHRS";

            return (
              <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="px-2 py-1.5">
                  <span className={`rounded px-1 py-0.5 font-mono text-[10px] font-bold ${
                    isNative
                      ? "bg-yellow-900/40 text-yellow-500"
                      : "bg-violet-900/40 text-violet-400"
                  }`}>
                    {logLabel}
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  <span
                    className={`cursor-pointer font-mono transition-colors ${
                      copied === t.from + i
                        ? "text-green-400"
                        : useLabels && book.resolve(t.from)
                          ? "rounded bg-cyan-900/30 px-1 py-0.5 text-cyan-300"
                          : "text-gray-400 hover:text-gray-200"
                    }`}
                    title={t.from}
                    onClick={() => {
                      navigator.clipboard.writeText(t.from);
                      setCopied(t.from + i);
                      setTimeout(() => setCopied(null), 1200);
                    }}
                  >
                    {copied === t.from + i ? "copied" : resolveDisplay(t.from)}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-gray-600">→</td>
                <td className="px-2 py-1.5">
                  <span
                    className={`cursor-pointer font-mono transition-colors ${
                      copied === t.to + i
                        ? "text-green-400"
                        : useLabels && book.resolve(t.to)
                          ? "rounded bg-cyan-900/30 px-1 py-0.5 text-cyan-300"
                          : "text-gray-400 hover:text-gray-200"
                    }`}
                    title={t.to}
                    onClick={() => {
                      navigator.clipboard.writeText(t.to);
                      setCopied(t.to + i);
                      setTimeout(() => setCopied(null), 1200);
                    }}
                  >
                    {copied === t.to + i ? "copied" : resolveDisplay(t.to)}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className={`font-mono ${isNative ? "text-yellow-400" : "text-violet-400"}`}>
                    {formatAmount(t.amount, t.decimals, t.symbol)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
