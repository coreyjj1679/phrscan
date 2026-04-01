import { useState } from "react";
import type { PublicClient, Hex, Address, Log } from "viem";
import { formatEther, decodeEventLog } from "viem";
import type { DecodedLog } from "../lib/simulate";
import { fetchTrace, fetchStateDiff, type TraceCall, type StateDiff } from "../lib/trace";
import { AddressLabel } from "./AddressLabel";
import type { AddressBook } from "../hooks/useAddressBook";
import { getAbiRegistry } from "../lib/storage";

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
    <div className="space-y-3 rounded bg-gray-900/50 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-200">Transaction Receipt</h3>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
            receipt.status === "success"
              ? "bg-green-900/50 text-green-400"
              : "bg-red-900/50 text-red-400"
          }`}
        >
          {receipt.status}
        </span>
      </div>

      <div className="space-y-1.5 text-xs">
        <InfoRow label="Block" value={receipt.blockNumber.toString()} />
        <AddrRow label="From" address={tx.from} book={book} />
        <AddrRow label="To" address={tx.to} book={book} />
        {valBigInt > 0n && (
          <InfoRow label="Value" value={`${formatEther(valBigInt)} PHRS`} />
        )}
        <InfoRow label="Gas" value={receipt.gasUsed.toLocaleString()} />
      </div>

      <details className="group">
        <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300">
          Input data ({tx.data.length / 2 - 1} bytes)
        </summary>
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-900 p-2 font-mono text-[11px] text-gray-500 ring-1 ring-gray-800">
          {tx.data}
        </pre>
      </details>

      {receipt.logs.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-gray-400">
            Events ({receipt.logs.length})
          </p>
          {receipt.logs.map((log, i) => (
            <details key={i} className="group rounded bg-gray-900 ring-1 ring-gray-700">
              <summary className="flex cursor-pointer items-center gap-2 overflow-hidden px-3 py-2">
                <span className="shrink-0 rounded bg-violet-900/50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-violet-400">
                  {log.eventName}
                </span>
                <AddressLabel address={log.address} book={book} className="min-w-0" />
              </summary>
              <div className="border-t border-gray-800 px-3 py-2">
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

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-gray-500">{label}</span>
      <span
        className={`break-all text-gray-200 ${mono ? "font-mono text-[11px]" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function AddrRow({
  label,
  address,
  book,
}: {
  label: string;
  address: string;
  book: AddressBook;
}) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-gray-500">{label}</span>
      <AddressLabel address={address} book={book} />
    </div>
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
