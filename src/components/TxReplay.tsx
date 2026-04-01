import { useState, useMemo } from "react";
import type { PublicClient, Hex, Address, Log, Abi } from "viem";
import { formatEther, decodeEventLog, decodeFunctionData } from "viem";
import type { DecodedLog } from "../lib/simulate";
import { fetchTrace, fetchStateDiff, type TraceCall, type StateDiff } from "../lib/trace";
import { AddressLabel } from "./AddressLabel";
import type { AddressBook } from "../hooks/useAddressBook";
import { getAbiRegistry } from "../lib/storage";
import { EXPLORER_URL } from "../config/chain";

export type TxData = {
  to: Address;
  from: Address;
  data: Hex;
  value: string;
  blockNumber: string;
  hash: Hex;
};

export type TxReceipt = {
  status: "success" | "reverted";
  gasUsed: bigint;
  blockNumber: bigint;
  logs: DecodedLog[];
  tx: TxData;
  trace: TraceCall | null;
  stateDiff: StateDiff | null;
};

type Props = {
  client: PublicClient;
  onTxLoaded: (tx: TxData, receipt: TxReceipt) => void;
};

export function TxReplay({ client, onTxLoaded }: Props) {
  const [hash, setHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFetch = async () => {
    const trimmed = hash.trim();
    if (!trimmed) return;
    setLoading(true);
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
      };

      const [logs, trace, stateDiff] = await Promise.all([
        decodeReceiptLogs(receipt.logs),
        fetchTrace(client, trimmed as Hex),
        fetchStateDiff(client, trimmed as Hex),
      ]);

      const txReceipt: TxReceipt = {
        status: receipt.status === "success" ? "success" : "reverted",
        gasUsed: receipt.gasUsed,
        blockNumber: receipt.blockNumber,
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
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
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
          className="w-full rounded bg-purple-700 px-4 py-2 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-40 sm:w-auto"
        >
          {loading ? "Loading…" : "Load Tx"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
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

  return (
    <div className="space-y-4 rounded-lg border border-gray-800 bg-gradient-to-b from-gray-900/80 to-gray-950/80 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-100">Transaction Receipt</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            receipt.status === "success"
              ? "bg-green-900/50 text-green-400"
              : "bg-red-900/50 text-red-400"
          }`}
        >
          {receipt.status}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md bg-gray-950/50 px-3 py-2 ring-1 ring-gray-800/50">
          <span className="text-[10px] font-medium uppercase tracking-wider text-gray-600">Tx Hash</span>
          <a
            href={`${EXPLORER_URL}/tx/${tx.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-cyan-400 hover:text-cyan-300"
          >
            {tx.hash.slice(0, 10)}…{tx.hash.slice(-8)}
            <svg className="size-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-3M10 2h4m0 0v4m0-4L7 9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
        <div className="rounded-md bg-gray-950/50 px-3 py-2 ring-1 ring-gray-800/50">
          <span className="text-[10px] font-medium uppercase tracking-wider text-gray-600">Block</span>
          <p className="mt-0.5 font-mono text-xs text-gray-200">{receipt.blockNumber.toString()}</p>
        </div>
      </div>

      <div className="space-y-2 rounded-md bg-gray-950/50 px-3 py-2.5 ring-1 ring-gray-800/50">
        <div className="flex items-center gap-2 text-xs">
          <span className="w-10 shrink-0 text-[10px] font-medium uppercase tracking-wider text-gray-600">From</span>
          <AddressLabel address={tx.from} book={book} />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="w-10 shrink-0 text-[10px] font-medium uppercase tracking-wider text-gray-600">To</span>
          <AddressLabel address={tx.to} book={book} />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {valBigInt > 0n && (
          <div className="rounded-md bg-yellow-950/20 px-3 py-2 ring-1 ring-yellow-900/30">
            <span className="text-[10px] font-medium uppercase tracking-wider text-yellow-600">Value</span>
            <p className="mt-0.5 font-mono text-xs text-yellow-400">{formatEther(valBigInt)} PHRS</p>
          </div>
        )}
        <div className="rounded-md bg-gray-950/50 px-3 py-2 ring-1 ring-gray-800/50">
          <span className="text-[10px] font-medium uppercase tracking-wider text-gray-600">Gas Used</span>
          <p className="mt-0.5 font-mono text-xs text-gray-200">{receipt.gasUsed.toLocaleString()}</p>
        </div>
      </div>

      <InputDataSection data={tx.data} to={tx.to} />

      {receipt.logs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-gray-300">Events</p>
            <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400">
              {receipt.logs.length}
            </span>
          </div>
          {receipt.logs.map((log, i) => (
            <details key={i} className="group rounded-md bg-gray-950/50 ring-1 ring-gray-800/50">
              <summary className="flex cursor-pointer items-center gap-2 overflow-hidden px-3 py-2">
                <span className="shrink-0 rounded bg-violet-900/40 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-violet-400 ring-1 ring-violet-800/30">
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
                        <span className="break-all font-mono text-cyan-300">
                          {formatVal(val)}
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
                            className="block break-all pl-4 font-mono text-[11px] text-gray-500"
                          >
                            [{ti}] {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {log.raw.data && log.raw.data !== "0x" && (
                      <div className="text-xs">
                        <span className="text-gray-500">data: </span>
                        <span className="break-all font-mono text-[11px] text-gray-500">
                          {log.raw.data}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
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

function InputDataSection({ data, to }: { data: Hex; to: Address }) {
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
        <span className="text-[10px] text-gray-600">({byteLen} bytes)</span>
        {decoded && (
          <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-800/30">
            {decoded.functionName}
          </span>
        )}
        {decoded && (
          <button
            onClick={(e) => { e.preventDefault(); setShowRaw((v) => !v); }}
            className="ml-auto rounded bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-200"
          >
            {showRaw ? "Parsed" : "Raw"}
          </button>
        )}
      </summary>
      <div className="border-t border-gray-800/50">
        {decoded && !showRaw ? (
          <div className="space-y-1 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-semibold text-emerald-400">{decoded.functionName}</span>
              <span className="text-[10px] text-gray-600">({decoded.args.length} args)</span>
            </div>
            {decoded.args.length > 0 && (
              <div className="mt-1 space-y-1">
                {Array.from(decoded.args).map((arg, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className="shrink-0 text-gray-600">
                      {decoded.argNames[i] || `[${i}]`}
                      {decoded.argTypes[i] && (
                        <span className="ml-1 text-[10px] text-gray-700">{decoded.argTypes[i]}</span>
                      )}
                    </span>
                    <span className="break-all font-mono text-cyan-300">{formatVal(arg)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <pre className="max-h-32 overflow-auto px-3 py-2 whitespace-pre-wrap break-all font-mono text-[11px] text-gray-500">
            {data}
          </pre>
        )}
      </div>
    </details>
  );
}

function formatVal(val: unknown): string {
  if (val === undefined || val === null) return "void";
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "string") return val;
  if (typeof val === "boolean") return String(val);
  try {
    return JSON.stringify(
      val,
      (_key, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    );
  } catch {
    return String(val);
  }
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
