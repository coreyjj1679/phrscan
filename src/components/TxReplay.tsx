import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import type { PublicClient, Hex, Address, Log, Abi } from "viem";
import { formatEther, formatGwei, decodeEventLog, decodeFunctionData } from "viem";
import type { DecodedLog } from "../lib/simulate";
import { fetchTrace, fetchStateDiff, enrichTraceRevert, type TraceCall, type StateDiff } from "../lib/trace";
import { AddressLabel } from "./AddressLabel";
import { ValueView } from "./ValueView";
import type { AddressBook } from "../hooks/useAddressBook";
import { getAbiRegistry } from "../lib/storage";
import { EXPLORER_URL, CURRENCY } from "../config/chain";

export type TxData = {
  to: Address;
  from: Address;
  data: Hex;
  value: string;
  blockNumber: string;
  hash: Hex;
  nonce: number;
  transactionIndex: number;
  gasLimit: string;
};

export type TxReceipt = {
  status: "success" | "reverted";
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  blockNumber: bigint;
  timestamp: bigint;
  logs: DecodedLog[];
  tx: TxData;
  trace: TraceCall | null;
  stateDiff: StateDiff | null;
};

type Props = {
  client: PublicClient;
  onTxLoaded: (tx: TxData, receipt: TxReceipt) => void;
  initialHash?: string;
  onLoadingChange?: (loading: boolean) => void;
  /** Optional control rendered inline at the end of the input row (e.g. history toggle). */
  trailing?: ReactNode;
};

export function TxReplay({ client, onTxLoaded, initialHash, onLoadingChange, trailing }: Props) {
  const [hash, setHash] = useState(initialHash ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoFetched = useRef(false);

  const runFetch = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setLoading(true);
    onLoadingChange?.(true);
    setError(null);

    try {
      const [tx, receipt] = await Promise.all([
        client.getTransaction({ hash: trimmed as Hex }),
        client.getTransactionReceipt({ hash: trimmed as Hex }),
      ]);

      if (!tx.to) {
        setError("Contract creation transactions cannot be replayed");
        return;
      }

      const txData: TxData = {
        to: tx.to,
        from: tx.from,
        data: tx.input,
        value: tx.value.toString(),
        blockNumber: tx.blockNumber?.toString() ?? "",
        hash: tx.hash,
        nonce: tx.nonce,
        transactionIndex: tx.transactionIndex ?? receipt.transactionIndex ?? 0,
        gasLimit: tx.gas.toString(),
      };

      const [logs, trace, stateDiff, block] = await Promise.all([
        decodeReceiptLogs(receipt.logs),
        fetchTrace(client, trimmed as Hex),
        fetchStateDiff(client, trimmed as Hex),
        client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null),
      ]);

      // The node's callTracer omits revert bytes; for a failed tx, recover and
      // decode the reason by replaying it as an eth_call at its block.
      if (trace && receipt.status !== "success") {
        await enrichTraceRevert(client, trace, {
          tx: { from: tx.from, to: tx.to, data: tx.input, value: tx.value },
          blockNumber: receipt.blockNumber,
          recover: true,
        }).catch(() => {});
      }

      const txReceipt: TxReceipt = {
        status: receipt.status === "success" ? "success" : "reverted",
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice ?? tx.gasPrice ?? 0n,
        blockNumber: receipt.blockNumber,
        timestamp: block?.timestamp ?? 0n,
        logs,
        tx: txData,
        trace,
        stateDiff,
      };

      onTxLoaded(txData, txReceipt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction not found");
    } finally {
      setLoading(false);
      onLoadingChange?.(false);
    }
  };

  const handleFetch = () => runFetch(hash);

  useEffect(() => {
    if (autoFetched.current) return;
    if (initialHash && initialHash.trim()) {
      autoFetched.current = true;
      runFetch(initialHash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={hash}
          onChange={(e) => setHash(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hash.trim() && !loading) handleFetch();
          }}
          placeholder="Transaction hash (0x…)"
          spellCheck={false}
          className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-sm text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600 sm:flex-1"
        />
        <button
          onClick={handleFetch}
          disabled={loading || !hash.trim()}
          className="w-full rounded bg-purple-700 px-4 py-2 text-sm font-medium text-white ring-1 ring-purple-700 hover:bg-purple-600 hover:ring-purple-600 disabled:opacity-40 sm:w-auto"
        >
          {loading ? "Loading…" : "Load Tx"}
        </button>
        {trailing}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function TxSummaryBar({
  receipt,
  book,
}: {
  receipt: TxReceipt;
  book: AddressBook;
}) {
  const { tx } = receipt;
  const val = BigInt(tx.value);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2.5">
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
          receipt.status === "success"
            ? "bg-green-900/50 text-green-400"
            : "bg-red-900/50 text-red-400"
        }`}
      >
        {receipt.status}
      </span>
      <SummaryField label="Block" value={receipt.blockNumber.toString()} />
      <SummaryField label="Gas" value={receipt.gasUsed.toLocaleString()} />
      {val > 0n && (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-xs font-medium tracking-wider text-gray-600 uppercase">Value</span>
          <span className="font-mono text-yellow-400">{formatEther(val)} {CURRENCY}</span>
        </div>
      )}
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        <span className="text-xs font-medium tracking-wider text-gray-600 uppercase">From</span>
        <AddressLabel address={tx.from} book={book} className="min-w-0" />
      </div>
      <span className="text-gray-600">&rarr;</span>
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        <span className="text-xs font-medium tracking-wider text-gray-600 uppercase">To</span>
        <AddressLabel address={tx.to} book={book} className="min-w-0" />
      </div>
      <a
        href={`${EXPLORER_URL}/tx/${tx.hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto flex items-center gap-1 font-mono text-xs text-cyan-400 hover:text-cyan-300"
      >
        {tx.hash.slice(0, 8)}…{tx.hash.slice(-6)}
        <svg className="size-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-3M10 2h4m0 0v4m0-4L7 9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-xs font-medium tracking-wider text-gray-600 uppercase">{label}</span>
      <span className="font-mono text-gray-200">{value}</span>
    </div>
  );
}

function ReceiptField({
  label,
  accent,
  children,
}: {
  label: string;
  accent?: "yellow";
  children: ReactNode;
}) {
  const yellow = accent === "yellow";
  return (
    <div
      className={`rounded-md px-3 py-2 ring-1 ${
        yellow ? "bg-yellow-950/20 ring-yellow-900/30" : "bg-gray-950/50 ring-gray-800/50"
      }`}
    >
      <span
        className={`text-xs font-medium uppercase tracking-wider ${
          yellow ? "text-yellow-600" : "text-gray-600"
        }`}
      >
        {label}
      </span>
      <div
        className={`mt-0.5 break-all font-mono text-xs ${
          yellow ? "text-yellow-400" : "text-gray-200"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** Strip trailing zeros (and a dangling dot) from a decimal string for display. */
function trimDecimal(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}

function formatTimestamp(ts: bigint): { absolute: string; relative: string } {
  const ms = Number(ts) * 1000;
  const date = new Date(ms);
  const absolute = date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  return { absolute, relative: formatRelative(diffSec) };
}

function formatRelative(seconds: number): string {
  const abs = Math.abs(seconds);
  const suffix = seconds >= 0 ? "ago" : "from now";
  if (abs < 60) return `${abs}s ${suffix}`;
  const mins = Math.floor(abs / 60);
  if (mins < 60) return `${mins}m ${suffix}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${suffix}`;
  const days = Math.floor(hours / 24);
  return `${days}d ${suffix}`;
}

export function TxReceiptPanel({
  receipt,
  book,
}: {
  receipt: TxReceipt;
  book: AddressBook;
}) {
  const { tx } = receipt;
  const valBigInt = BigInt(tx.value);
  const gasLimit = BigInt(tx.gasLimit);
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  const gasUsedPct =
    gasLimit > 0n ? (Number(receipt.gasUsed) / Number(gasLimit)) * 100 : 0;
  const ts = receipt.timestamp > 0n ? formatTimestamp(receipt.timestamp) : null;
  const gasPriceGwei = trimDecimal(formatGwei(receipt.effectiveGasPrice));

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-100">Transaction Receipt</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
            receipt.status === "success"
              ? "bg-green-900/50 text-green-400"
              : "bg-red-900/50 text-red-400"
          }`}
        >
          {receipt.status}
        </span>
      </div>

      <ReceiptField label="Tx Hash">
        <a
          href={`${EXPLORER_URL}/tx/${tx.hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
        >
          <span className="min-w-0 break-all">{tx.hash}</span>
          <svg className="size-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-3M10 2h4m0 0v4m0-4L7 9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </ReceiptField>

      <div className="space-y-2 rounded-md bg-gray-950/50 px-3 py-2.5 ring-1 ring-gray-800/50">
        <div className="flex items-center gap-2 text-xs">
          <span className="w-10 shrink-0 text-xs font-medium uppercase tracking-wider text-gray-600">From</span>
          <AddressLabel address={tx.from} book={book} full />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="w-10 shrink-0 text-xs font-medium uppercase tracking-wider text-gray-600">To</span>
          <AddressLabel address={tx.to} book={book} full />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <ReceiptField label="Block">
          <a
            href={`${EXPLORER_URL}/block/${receipt.blockNumber.toString()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:text-cyan-300"
          >
            {receipt.blockNumber.toString()}
          </a>
        </ReceiptField>
        <ReceiptField label="Timestamp">
          {ts ? (
            <>
              <span className="text-gray-200">{ts.relative}</span>
              <span className="ml-1 text-gray-500">({ts.absolute})</span>
            </>
          ) : (
            <span className="text-gray-500">Unknown</span>
          )}
        </ReceiptField>

        <ReceiptField label="Value" accent={valBigInt > 0n ? "yellow" : undefined}>
          {trimDecimal(formatEther(valBigInt))} {CURRENCY}
        </ReceiptField>
        <ReceiptField label="Transaction Fee">
          {trimDecimal(formatEther(fee))} {CURRENCY}
        </ReceiptField>

        <ReceiptField label="Gas Price">
          {gasPriceGwei} Gwei
        </ReceiptField>
        <ReceiptField label="Gas Limit & Usage">
          <span className="text-gray-200">{gasLimit.toLocaleString()}</span>
          <span className="text-gray-600"> | </span>
          <span className="text-gray-200">{receipt.gasUsed.toLocaleString()}</span>
          <span className="text-gray-500">
            {" "}
            ({gasUsedPct.toLocaleString(undefined, { maximumFractionDigits: 2 })}%)
          </span>
        </ReceiptField>

        <ReceiptField label="Nonce">{tx.nonce.toLocaleString()}</ReceiptField>
        <ReceiptField label="Position In Block">{tx.transactionIndex}</ReceiptField>
      </div>

      <InputDataSection data={tx.data} to={tx.to} book={book} />

      {receipt.logs.length > 0 && <EventsPanel logs={receipt.logs} book={book} />}
    </div>
  );
}

/** Flatten a decoded arg value to a searchable string (handles bigint/nesting). */
function deepString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(deepString).join(" ");
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k} ${deepString(val)}`)
      .join(" ");
  }
  return String(v);
}

/** Lowercased haystack for filtering: name, address, label, args, topics, data. */
function logHaystack(log: DecodedLog, book: AddressBook): string {
  const parts: string[] = [log.eventName, log.address];
  const label = book.resolve(log.address);
  if (label) parts.push(label);
  for (const [k, v] of Object.entries(log.args)) parts.push(k, deepString(v));
  for (const t of log.raw.topics) parts.push(t);
  if (log.raw.data) parts.push(log.raw.data);
  return parts.join(" ").toLowerCase();
}

function EventsPanel({ logs, book }: { logs: DecodedLog[]; book: AddressBook }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const indexed = useMemo(() => logs.map((log, i) => ({ log, i })), [logs]);
  const filtered = query
    ? indexed.filter(({ log }) => logHaystack(log, book).includes(query))
    : indexed;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-gray-300">Events</p>
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
          {query ? `${filtered.length}/${logs.length}` : logs.length}
        </span>
        <div className="relative ml-auto w-full sm:w-52">
          <svg
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-gray-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name, address, value…"
            spellCheck={false}
            className="w-full rounded bg-gray-900 py-1 pr-6 pl-7 text-xs text-gray-300 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear filter"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 text-gray-600 hover:text-gray-300"
            >
              <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="px-1 py-2 text-xs text-gray-600">No events match the filter.</p>
      ) : (
        filtered.map(({ log, i }) => (
          <details key={i} className="group rounded-md bg-gray-950/50 ring-1 ring-gray-800/50">
            <summary className="flex cursor-pointer items-center gap-2 overflow-hidden px-3 py-2">
              <span className="shrink-0 rounded bg-violet-900/40 px-1.5 py-0.5 font-mono text-xs font-semibold text-violet-400 ring-1 ring-violet-800/30">
                {log.eventName}
              </span>
              <AddressLabel address={log.address} book={book} className="min-w-0" />
            </summary>
            <div className="border-t border-gray-800/50 px-3 py-2">
              {Object.keys(log.args).length > 0 ? (
                <div className="space-y-1">
                  {Object.entries(log.args).map(([key, val]) => (
                    <div key={key} className="flex gap-2 text-xs">
                      <span className="shrink-0 text-gray-500">{key}:</span>
                      <span className="min-w-0 break-all font-mono">
                        <ValueView value={val} book={book} />
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {log.raw.topics.length > 0 && (
                    <div className="text-xs">
                      <span className="text-gray-500">topics: </span>
                      {log.raw.topics.map((t, ti) => (
                        <span
                          key={ti}
                          className="block break-all pl-4 font-mono text-xs text-gray-500"
                        >
                          [{ti}] {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {log.raw.data && log.raw.data !== "0x" && (
                    <div className="text-xs">
                      <span className="text-gray-500">data: </span>
                      <span className="break-all font-mono text-xs text-gray-500">
                        {log.raw.data}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </details>
        ))
      )}
    </div>
  );
}

type DecodedInput = {
  functionName: string;
  args: readonly unknown[];
  argNames: string[];
  argTypes: string[];
};

function tryDecodeInput(data: Hex, to: Address): DecodedInput | null {
  if (!data || data === "0x" || data.length < 10) return null;

  const abiMap = getAbiRegistry();
  const abisToTry: Abi[] = [];

  const contractAbi = abiMap.get(to.toLowerCase());
  if (contractAbi) abisToTry.push(contractAbi);
  for (const [addr, abi] of abiMap) {
    if (addr !== to.toLowerCase()) abisToTry.push(abi);
  }

  for (const abi of abisToTry) {
    try {
      const decoded = decodeFunctionData({ abi, data });
      const fnAbi = (abi as readonly Record<string, unknown>[]).find(
        (item) =>
          item.type === "function" && item.name === decoded.functionName,
      ) as { inputs?: { name?: string; type: string }[] } | undefined;

      const argNames = fnAbi?.inputs?.map((inp) => inp.name ?? "") ?? [];
      const argTypes = fnAbi?.inputs?.map((inp) => inp.type) ?? [];

      return {
        functionName: decoded.functionName,
        args: decoded.args ?? [],
        argNames,
        argTypes,
      };
    } catch {
      // ABI didn't match
    }
  }
  return null;
}

function InputDataSection({ data, to, book }: { data: Hex; to: Address; book: AddressBook }) {
  const [showRaw, setShowRaw] = useState(false);
  const decoded = useMemo(() => tryDecodeInput(data, to), [data, to]);
  const byteLen = data.length > 2 ? (data.length - 2) / 2 : 0;

  if (!data || data === "0x") {
    return (
      <div className="rounded-md bg-gray-950/50 px-3 py-2 ring-1 ring-gray-800/50">
        <span className="text-xs text-gray-500">No input data</span>
      </div>
    );
  }

  return (
    <details className="group rounded-md bg-gray-950/50 ring-1 ring-gray-800/50" open>
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-gray-300">
        <span>Input data</span>
        <span className="text-xs text-gray-600">({byteLen} bytes)</span>
        {decoded && (
          <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 font-mono text-xs font-semibold text-emerald-400 ring-1 ring-emerald-800/30">
            {decoded.functionName}
          </span>
        )}
        {decoded && (
          <button
            onClick={(e) => { e.preventDefault(); setShowRaw((v) => !v); }}
            className="ml-auto rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
          >
            {showRaw ? "Parsed" : "Raw"}
          </button>
        )}
      </summary>
      <div className="border-t border-gray-800/50">
        {decoded && !showRaw ? (
          <div className="space-y-2 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-semibold text-emerald-400">{decoded.functionName}</span>
              <span className="text-xs text-gray-600">({decoded.args.length} args)</span>
            </div>
            {decoded.args.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-gray-800 text-left text-gray-600">
                      <th className="py-1 pr-2 font-medium">#</th>
                      <th className="py-1 pr-3 font-medium">Param</th>
                      <th className="py-1 pr-3 font-medium">Type</th>
                      <th className="py-1 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(decoded.args).map((arg, i) => (
                      <tr key={i} className="border-b border-gray-800/50 align-top last:border-0">
                        <td className="py-1.5 pr-2 tabular-nums text-gray-600">{i}</td>
                        <td className="py-1.5 pr-3 font-mono text-gray-300">
                          {decoded.argNames[i] || `arg${i}`}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-gray-500">
                          {decoded.argTypes[i] || "—"}
                        </td>
                        <td className="py-1.5 font-mono">
                          <ValueView value={arg} book={book} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-gray-600">No parameters</p>
            )}
          </div>
        ) : (
          <pre className="max-h-72 overflow-y-auto px-3 py-2 whitespace-pre-wrap break-all font-mono text-xs text-gray-500">
            {data}
          </pre>
        )}
      </div>
    </details>
  );
}


const OPENCHAIN_API =
  "https://api.openchain.xyz/signature-database/v1/lookup";

async function decodeReceiptLogs(logs: Log[]): Promise<DecodedLog[]> {
  const abiMap = getAbiRegistry();

  const undecoded: { index: number; topic0: string }[] = [];

  const results: DecodedLog[] = logs.map((log, i) => {
    const raw = {
      topics: (log.topics ?? []) as Hex[],
      data: (log.data ?? "0x") as Hex,
    };

    const contractAbi = abiMap.get(log.address.toLowerCase());
    if (contractAbi) {
      try {
        const decoded = decodeEventLog({
          abi: contractAbi,
          data: log.data,
          topics: log.topics,
        });
        return {
          eventName: decoded.eventName ?? "Unknown",
          args: (decoded.args ?? {}) as Record<string, unknown>,
          address: log.address,
          raw,
        };
      } catch {
        // ABI didn't match this event, fall through
      }
    }

    // Try all saved ABIs (the event might come from a proxy/library)
    if (!contractAbi) {
      for (const [, abi] of abiMap) {
        try {
          const decoded = decodeEventLog({
            abi,
            data: log.data,
            topics: log.topics,
          });
          return {
            eventName: decoded.eventName ?? "Unknown",
            args: (decoded.args ?? {}) as Record<string, unknown>,
            address: log.address,
            raw,
          };
        } catch {
          // keep trying
        }
      }
    }

    const topic0 = raw.topics[0];
    if (topic0) undecoded.push({ index: i, topic0 });

    return {
      eventName: topic0?.slice(0, 10) ?? "Unknown",
      args: {} as Record<string, unknown>,
      address: log.address,
      raw,
    };
  });

  if (undecoded.length > 0) {
    const topicSet = new Set(undecoded.map((u) => u.topic0));
    try {
      const url = `${OPENCHAIN_API}?event=${[...topicSet].join(",")}&filter=true`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const events = json?.result?.event ?? {};
        const sigMap = new Map<string, string>();
        for (const [hash, matches] of Object.entries(events)) {
          if (Array.isArray(matches) && matches.length > 0) {
            sigMap.set(hash, (matches[0] as { name: string }).name);
          }
        }
        for (const { index, topic0 } of undecoded) {
          const sigName = sigMap.get(topic0);
          if (sigName) {
            const evMatch = sigName.match(/^(\w+)\(([^)]*)\)$/);
            if (evMatch) {
              results[index] = {
                ...results[index],
                eventName: evMatch[0],
              };
            }
          }
        }
      }
    } catch {
      // openchain unavailable
    }
  }

  return results;
}
