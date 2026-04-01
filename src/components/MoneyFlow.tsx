import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { formatEther, formatUnits, type PublicClient, type Address } from "viem";
import type { TraceCall } from "../lib/trace";
import type { DecodedLog } from "../lib/simulate";
import type { AddressBook } from "../hooks/useAddressBook";

type Props = {
  trace: TraceCall;
  logs?: DecodedLog[];
  book: AddressBook;
  client: PublicClient;
};

type Transfer = {
  from: string;
  to: string;
  amount: bigint;
  symbol: string;
  decimals: number;
  /** contract address for ERC-20 tokens, empty for native */
  tokenAddress: string;
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
      tokenAddress: "",
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

function isTransferEvent(name: string): boolean {
  return name === "Transfer" || name.startsWith("Transfer(");
}

function extractErc20Transfers(logs: DecodedLog[], transfers: Transfer[]) {
  logs.forEach((log, i) => {
    if (
      isTransferEvent(log.eventName) &&
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
          tokenAddress: log.address.toLowerCase(),
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
          tokenAddress: log.address.toLowerCase(),
          logIndex: i,
          traceIndex: -1,
        });
      }
    }
  });
}

function formatParsedFull(amount: bigint, decimals: number): string {
  return decimals === 18 ? formatEther(amount) : formatUnits(amount, decimals);
}

function formatParsed(amount: bigint, decimals: number): string {
  const formatted = formatParsedFull(amount, decimals);
  const num = parseFloat(formatted);
  if (num > 0 && num < 0.01) return "< 0.01";
  if (num > 1e6) return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (num > 1) return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return formatted;
}

function formatRaw(amount: bigint): string {
  const s = amount.toString();
  if (s.length > 18) return s.slice(0, 6) + "…" + s.slice(-4);
  return s;
}

function formatAmountShort(amount: bigint, decimals: number, symbol: string): string {
  return `${formatParsed(amount, decimals)} ${symbol}`;
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
  transferIndex: number;
  edgeGroupIndex: number;
  edgeGroupSize: number;
};

const NODE_W = 120;
const NODE_H = 36;
const PADDING_X = 40;
const PADDING_Y = 40;
const LAYER_GAP_X = 180;
const NODE_GAP_Y = 56;

function computeInitialPositions(
  addresses: string[],
  containerWidth: number,
  book: AddressBook,
  transfers: Transfer[],
): NodeLayout[] {
  if (addresses.length === 0) return [];

  const outEdges = new Map<string, Set<string>>();
  const inEdges = new Map<string, Set<string>>();
  for (const addr of addresses) {
    outEdges.set(addr, new Set());
    inEdges.set(addr, new Set());
  }
  for (const t of transfers) {
    if (t.from !== t.to) {
      outEdges.get(t.from)?.add(t.to);
      inEdges.get(t.to)?.add(t.from);
    }
  }

  // Longest-path layering: assign each node the longest distance from any root
  const layer = new Map<string, number>();
  const roots = addresses.filter((a) => inEdges.get(a)!.size === 0);
  if (roots.length === 0) roots.push(addresses[0]);

  function longestPath(node: string, visited: Set<string>): number {
    if (layer.has(node)) return layer.get(node)!;
    if (visited.has(node)) return 0;
    visited.add(node);
    let maxParent = -1;
    for (const parent of inEdges.get(node) ?? []) {
      maxParent = Math.max(maxParent, longestPath(parent, visited));
    }
    const d = maxParent + 1;
    layer.set(node, d);
    return d;
  }
  for (const addr of addresses) longestPath(addr, new Set());
  for (const addr of addresses) {
    if (!layer.has(addr)) layer.set(addr, 0);
  }

  const maxLayer = Math.max(0, ...layer.values());
  const layerBuckets: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const addr of addresses) {
    layerBuckets[layer.get(addr)!].push(addr);
  }

  // Barycentric ordering: sort nodes within each layer to reduce edge crossings
  for (let pass = 0; pass < 4; pass++) {
    for (let l = 1; l <= maxLayer; l++) {
      const bucket = layerBuckets[l];
      const prevBucket = layerBuckets[l - 1];
      bucket.sort((a, b) => {
        const aParents = [...(inEdges.get(a) ?? [])].filter((p) => prevBucket.includes(p));
        const bParents = [...(inEdges.get(b) ?? [])].filter((p) => prevBucket.includes(p));
        const avgA = aParents.length > 0 ? aParents.reduce((s, p) => s + prevBucket.indexOf(p), 0) / aParents.length : 0;
        const avgB = bParents.length > 0 ? bParents.reduce((s, p) => s + prevBucket.indexOf(p), 0) / bParents.length : 0;
        return avgA - avgB;
      });
    }
    for (let l = maxLayer - 1; l >= 0; l--) {
      const bucket = layerBuckets[l];
      const nextBucket = layerBuckets[l + 1];
      bucket.sort((a, b) => {
        const aChildren = [...(outEdges.get(a) ?? [])].filter((c) => nextBucket.includes(c));
        const bChildren = [...(outEdges.get(b) ?? [])].filter((c) => nextBucket.includes(c));
        const avgA = aChildren.length > 0 ? aChildren.reduce((s, c) => s + nextBucket.indexOf(c), 0) / aChildren.length : 0;
        const avgB = bChildren.length > 0 ? bChildren.reduce((s, c) => s + nextBucket.indexOf(c), 0) / bChildren.length : 0;
        return avgA - avgB;
      });
    }
  }

  const numLayers = maxLayer + 1;
  const leftMargin = PADDING_X + NODE_W / 2;
  const usableWidth = containerWidth - leftMargin - PADDING_X - NODE_W / 2;
  const colWidth = numLayers <= 1 ? 0 : Math.max(LAYER_GAP_X, usableWidth / (numLayers - 1));

  const maxBucketSize = Math.max(...layerBuckets.map((b) => b.length));
  const totalChartH = (maxBucketSize - 1) * NODE_GAP_Y;
  const centerY = PADDING_Y + NODE_H / 2 + totalChartH / 2;

  return addresses.map((addr) => {
    const l = layer.get(addr)!;
    const bucket = layerBuckets[l];
    const posInBucket = bucket.indexOf(addr);
    const bucketSize = bucket.length;
    const bucketH = (bucketSize - 1) * NODE_GAP_Y;
    return {
      id: addr,
      x: leftMargin + l * colWidth,
      y: centerY - bucketH / 2 + posInBucket * NODE_GAP_Y,
      label: book.resolve(addr),
    };
  });
}

function buildEdges(transfers: Transfer[], nodeMap: Map<string, NodeLayout>): EdgeLayout[] {
  const groups = new Map<string, { transfer: Transfer; originalIndex: number }[]>();
  transfers.forEach((t, ti) => {
    const key = `${t.from}->${t.to}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ transfer: t, originalIndex: ti });
  });
  const result: EdgeLayout[] = [];
  for (const [, group] of groups) {
    group.forEach(({ transfer, originalIndex }, gi) => {
      const fromNode = nodeMap.get(transfer.from);
      const toNode = nodeMap.get(transfer.to);
      if (!fromNode || !toNode) return;
      result.push({
        from: fromNode,
        to: toNode,
        transfer,
        index: result.length,
        transferIndex: originalIndex,
        edgeGroupIndex: gi,
        edgeGroupSize: group.length,
      });
    });
  }
  return result;
}

type TokenMeta = { symbol: string; decimals: number };

const erc20Abi = [
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
] as const;

function useTokenMeta(client: PublicClient, tokenAddresses: string[]) {
  const [meta, setMeta] = useState<Map<string, TokenMeta>>(new Map());
  const fetchedRef = useRef(new Set<string>());

  useEffect(() => {
    const toFetch = tokenAddresses.filter((a) => a && !fetchedRef.current.has(a));
    if (toFetch.length === 0) return;
    for (const addr of toFetch) fetchedRef.current.add(addr);

    let cancelled = false;
    (async () => {
      const results = new Map<string, TokenMeta>();
      await Promise.all(
        toFetch.map(async (addr) => {
          try {
            const [symbol, decimals] = await Promise.all([
              client.readContract({ address: addr as Address, abi: erc20Abi, functionName: "symbol" }),
              client.readContract({ address: addr as Address, abi: erc20Abi, functionName: "decimals" }),
            ]);
            results.set(addr, { symbol: symbol as string, decimals: Number(decimals) });
          } catch {
            results.set(addr, { symbol: shortAddr(addr), decimals: 18 });
          }
        }),
      );
      if (!cancelled) {
        setMeta((prev) => {
          const next = new Map(prev);
          for (const [k, v] of results) next.set(k, v);
          return next;
        });
      }
    })();
    return () => { cancelled = true; };
  }, [client, tokenAddresses]);

  return meta;
}

export function MoneyFlow({ trace, logs, book, client }: Props) {
  const [useLabels, setUseLabels] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

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

  const rawTransfers = useMemo(() => {
    const result: Transfer[] = [];
    const counter = { value: 0 };
    extractNativeTransfers(trace, result, counter);
    if (logs) extractErc20Transfers(logs, result);
    return result;
  }, [trace, logs]);

  const tokenAddresses = useMemo(() => {
    const set = new Set<string>();
    for (const t of rawTransfers) {
      if (t.tokenAddress) set.add(t.tokenAddress);
    }
    return [...set];
  }, [rawTransfers]);

  const tokenMeta = useTokenMeta(client, tokenAddresses);

  const transfers = useMemo(() => {
    return rawTransfers.map((t) => {
      if (!t.tokenAddress) return t;
      const m = tokenMeta.get(t.tokenAddress);
      if (!m) return t;
      return { ...t, symbol: m.symbol, decimals: m.decimals };
    });
  }, [rawTransfers, tokenMeta]);

  const addresses = useMemo(() => {
    const firstSeen = new Map<string, number>();
    for (const t of transfers) {
      const idx = t.logIndex === "trace" ? t.traceIndex : t.logIndex;
      for (const addr of [t.from, t.to]) {
        if (!firstSeen.has(addr)) firstSeen.set(addr, idx);
      }
    }
    return [...firstSeen.keys()].sort((a, b) => firstSeen.get(a)! - firstSeen.get(b)!);
  }, [transfers]);

  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const positionsInitialized = useRef(false);

  useEffect(() => {
    if (addresses.length === 0) return;
    if (positionsInitialized.current) return;
    const initial = computeInitialPositions(addresses, containerWidth, book, transfers);
    const map = new Map<string, { x: number; y: number }>();
    for (const n of initial) map.set(n.id, { x: n.x, y: n.y });
    setNodePositions(map);
    positionsInitialized.current = true;
  }, [addresses, containerWidth, book, transfers]);

  const handleReset = useCallback(() => {
    const initial = computeInitialPositions(addresses, containerWidth, book, transfers);
    const map = new Map<string, { x: number; y: number }>();
    for (const n of initial) map.set(n.id, { x: n.x, y: n.y });
    setNodePositions(map);
  }, [addresses, containerWidth, book, transfers]);

  const nodes: NodeLayout[] = useMemo(() => {
    return addresses.map((addr) => {
      const pos = nodePositions.get(addr);
      return {
        id: addr,
        x: pos?.x ?? 0,
        y: pos?.y ?? 0,
        label: book.resolve(addr),
      };
    });
  }, [addresses, nodePositions, book]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, NodeLayout>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  const edges = useMemo(() => buildEdges(transfers, nodeMap), [transfers, nodeMap]);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragState = useRef<{ nodeId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent, nodeId: string) => {
    e.preventDefault();
    (e.target as SVGElement).setPointerCapture(e.pointerId);
    const pos = nodePositions.get(nodeId);
    if (!pos) return;
    dragState.current = {
      nodeId,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
    setDraggingId(nodeId);
  }, [nodePositions]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragState.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setNodePositions((prev) => {
      const next = new Map(prev);
      next.set(drag.nodeId, { x: drag.origX + dx, y: drag.origY + dy });
      return next;
    });
  }, []);

  const handlePointerUp = useCallback(() => {
    dragState.current = null;
    setDraggingId(null);
  }, []);

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const maxX = xs.length > 0 ? Math.max(...xs) : PADDING_X;
  const maxY = ys.length > 0 ? Math.max(...ys) : PADDING_Y;
  const svgWidth = Math.max(containerWidth, maxX + NODE_W / 2 + PADDING_X + 80);
  const svgHeight = Math.max(120, maxY + NODE_H / 2 + PADDING_Y);

  if (transfers.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gradient-to-b from-gray-900/80 to-gray-950/80 p-3 sm:p-4" ref={containerRef}>
        <h3 className="text-sm font-semibold text-gray-100">Money Flow</h3>
        <p className="mt-2 text-xs text-gray-500">No value transfers detected in this transaction.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-800 bg-gradient-to-b from-gray-900/80 to-gray-950/80 p-3 sm:p-4" ref={containerRef}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-100">Money Flow</h3>
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-400">{transfers.length} transfers</span>
        <button
          onClick={handleReset}
          className="rounded-md bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
        >
          Reset layout
        </button>
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

      <div className="overflow-auto rounded-md border border-gray-800/40" style={{ maxHeight: 420 }}>
        <svg
          ref={svgRef}
          width={svgWidth}
          height={svgHeight}
          style={{ minWidth: 320, display: "block" }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
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
            <marker
              id="arrowhead-highlight"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="#22d3ee" />
            </marker>
          </defs>

          {edges.map((edge, i) => (
            <FlowEdge key={i} edge={edge} highlighted={hoveredIdx === edge.transferIndex} dimmed={hoveredIdx !== null && hoveredIdx !== edge.transferIndex} />
          ))}

          {nodes.map((node) => (
            <FlowNode
              key={node.id}
              node={node}
              useLabels={useLabels}
              w={NODE_W}
              h={NODE_H}
              onPointerDown={handlePointerDown}
              isDragging={draggingId === node.id}
            />
          ))}
        </svg>
      </div>

      <TransferTable transfers={transfers} book={book} useLabels={useLabels} hoveredIdx={hoveredIdx} onHover={setHoveredIdx} />
    </div>
  );
}

function FlowNode({ node, useLabels, w, h, onPointerDown, isDragging }: {
  node: NodeLayout;
  useLabels: boolean;
  w: number;
  h: number;
  onPointerDown: (e: React.PointerEvent, nodeId: string) => void;
  isDragging: boolean;
}) {
  const display = useLabels && node.label
    ? node.label
    : shortAddr(node.id);
  const hasLabel = useLabels && !!node.label;

  return (
    <g
      style={{ cursor: isDragging ? "grabbing" : "grab" }}
      onPointerDown={(e) => onPointerDown(e, node.id)}
    >
      <rect
        x={node.x - w / 2}
        y={node.y - h / 2}
        width={w}
        height={h}
        rx={6}
        fill={hasLabel ? "#164e63" : "#1f2937"}
        stroke={isDragging ? "#60a5fa" : hasLabel ? "#22d3ee" : "#374151"}
        strokeWidth={isDragging ? 2 : 1}
      />
      <text
        x={node.x}
        y={node.y + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fill={hasLabel ? "#67e8f9" : "#9ca3af"}
        fontSize={11}
        fontFamily="monospace"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {display.length > 14 ? display.slice(0, 12) + "…" : display}
      </text>
    </g>
  );
}

function FlowEdge({ edge, highlighted, dimmed }: {
  edge: EdgeLayout;
  highlighted: boolean;
  dimmed: boolean;
}) {
  const { from, to, transfer, edgeGroupIndex, edgeGroupSize } = edge;
  const isNative = transfer.symbol === "PHRS";
  const baseColor = isNative ? "#ca8a04" : "#8b5cf6";
  const color = highlighted ? "#22d3ee" : baseColor;
  const markerId = highlighted ? "arrowhead-highlight" : isNative ? "arrowhead-yellow" : "arrowhead-violet";
  const edgeOpacity = dimmed ? 0.15 : highlighted ? 1 : 0.7;
  const strokeW = highlighted ? 2.5 : 1.5;

  const offset = edgeGroupSize > 1
    ? (edgeGroupIndex - (edgeGroupSize - 1) / 2) * 12
    : 0;

  const amountStr = formatAmountShort(transfer.amount, transfer.decimals, transfer.symbol);
  const logLabel = transfer.logIndex === "trace"
    ? `T${transfer.traceIndex}`
    : `L${transfer.logIndex}`;

  const halfW = NODE_W / 2;
  const isSelf = from.id === to.id;

  if (isSelf) {
    const r = 22;
    const labelX = from.x + halfW + r + 55;
    const labelY = from.y;
    return (
      <g opacity={edgeOpacity}>
        <path
          d={`M ${from.x + halfW} ${from.y - 8} A ${r} ${r} 0 1 1 ${from.x + halfW} ${from.y + 8}`}
          fill="none"
          stroke={color}
          strokeWidth={strokeW}
          strokeDasharray={isNative ? undefined : "4 2"}
          markerEnd={`url(#${markerId})`}
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

  const goesRight = to.x > from.x;
  const x1 = goesRight ? from.x + halfW : from.x - halfW;
  const y1 = from.y + offset;
  const x2 = goesRight ? to.x - halfW : to.x + halfW;
  const y2 = to.y + offset;

  const dx = Math.abs(x2 - x1);
  const cpOffset = Math.max(40, dx * 0.4);
  const cp1x = goesRight ? x1 + cpOffset : x1 - cpOffset;
  const cp2x = goesRight ? x2 - cpOffset : x2 + cpOffset;
  const path = `M ${x1} ${y1} C ${cp1x} ${y1} ${cp2x} ${y2} ${x2} ${y2}`;

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  return (
    <g opacity={edgeOpacity}>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeW}
        strokeDasharray={isNative ? undefined : "4 2"}
        markerEnd={`url(#${markerId})`}
      />
      <rect
        x={midX - 55}
        y={midY - 10}
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
        y={midY}
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
        y={midY}
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

function TransferTable({ transfers, book, useLabels, hoveredIdx, onHover }: {
  transfers: Transfer[];
  book: AddressBook;
  useLabels: boolean;
  hoveredIdx: number | null;
  onHover: (idx: number | null) => void;
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
            <th className="px-2 py-1 font-medium">Token</th>
            <th className="px-2 py-1 font-medium text-right">Parsed</th>
            <th className="px-2 py-1 font-medium text-right">Raw</th>
          </tr>
        </thead>
        <tbody>
          {transfers.map((t, i) => {
            const logLabel = t.logIndex === "trace"
              ? `T${t.traceIndex}`
              : `L${t.logIndex}`;
            const isNative = t.symbol === "PHRS";

            return (
              <tr
                key={i}
                className={`border-b border-gray-800/50 transition-colors ${hoveredIdx === i ? "bg-cyan-900/20" : "hover:bg-gray-800/30"}`}
                onMouseEnter={() => onHover(i)}
                onMouseLeave={() => onHover(null)}
              >
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
                <td className="px-2 py-1.5">
                  {isNative ? (
                    <span className="font-mono text-yellow-400">{t.symbol}</span>
                  ) : (
                    <span
                      className="cursor-pointer font-mono text-violet-400 hover:text-violet-300"
                      title={t.tokenAddress}
                      onClick={() => {
                        navigator.clipboard.writeText(t.tokenAddress);
                        setCopied("tok" + i);
                        setTimeout(() => setCopied(null), 1200);
                      }}
                    >
                      {copied === "tok" + i ? "copied" : t.symbol}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span
                    className={`font-mono ${isNative ? "text-yellow-400" : "text-violet-400"}`}
                    title={formatParsedFull(t.amount, t.decimals)}
                  >
                    {formatParsed(t.amount, t.decimals)}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span
                    className="cursor-pointer font-mono text-gray-500 hover:text-gray-300"
                    title={t.amount.toString()}
                    onClick={() => {
                      navigator.clipboard.writeText(t.amount.toString());
                      setCopied("raw" + i);
                      setTimeout(() => setCopied(null), 1200);
                    }}
                  >
                    {copied === "raw" + i ? "copied" : formatRaw(t.amount)}
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
