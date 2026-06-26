import { useState, useEffect } from "react";
import { formatEther, type PublicClient, type Address, type Hex } from "viem";
import { AddressLabel } from "./AddressLabel";
import { CopyButton } from "./CopyButton";
import { GasDashboard } from "./GasDashboard";
import { useAddressMenu } from "../hooks/useAddressMenu";
import type { AddressBook } from "../hooks/useAddressBook";
import { EXPLORER_URL, CURRENCY } from "../config/chain";
import { classifyQuery } from "../lib/search";
import { humanizeError } from "../lib/errors";

export type ExploreTarget =
  | { type: "feed" }
  | { type: "address"; value: string }
  | { type: "block"; value: string };

type Props = {
  client: PublicClient;
  book: AddressBook;
  initialTarget: ExploreTarget;
  onOpenTx: (hash: string) => void;
  onOpenContract: (address: string) => void;
};

export function Explore({ client, book, initialTarget, onOpenTx, onOpenContract }: Props) {
  const [target, setTarget] = useState<ExploreTarget>(initialTarget);
  const [query, setQuery] = useState("");

  const submit = () => {
    const kind = classifyQuery(query);
    if (kind === "tx") onOpenTx(query.trim());
    else if (kind === "address") setTarget({ type: "address", value: query.trim() });
    else if (kind === "block") setTarget({ type: "block", value: query.trim() });
  };

  const queryInvalid = query.trim().length > 0 && classifyQuery(query) === "unknown";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !queryInvalid) submit();
          }}
          placeholder="Search address, tx hash, or block number"
          spellCheck={false}
          className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-sm text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600 sm:flex-1"
        />
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={queryInvalid || !query.trim()}
            className="flex-1 rounded bg-cyan-700 px-4 py-2 text-sm font-medium text-on-accent hover:bg-cyan-600 disabled:opacity-40 sm:flex-none"
          >
            Search
          </button>
          {target.type !== "feed" && (
            <button
              onClick={() => setTarget({ type: "feed" })}
              className="rounded bg-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-600"
            >
              Latest
            </button>
          )}
        </div>
      </div>
      {queryInvalid && (
        <p className="text-xs text-amber-400">
          Not a valid address (0x + 40 hex), tx hash (0x + 64 hex), or block number.
        </p>
      )}

      {target.type === "feed" && (
        <>
          <GasDashboard client={client} />
          <LatestBlocks
            client={client}
            onOpenBlock={(n) => setTarget({ type: "block", value: n })}
          />
        </>
      )}
      {target.type === "block" && (
        <BlockView
          key={target.value}
          client={client}
          book={book}
          value={target.value}
          onOpenTx={onOpenTx}
          onOpenAddress={(a) => setTarget({ type: "address", value: a })}
        />
      )}
      {target.type === "address" && (
        <AddressView
          key={target.value}
          client={client}
          book={book}
          value={target.value}
          onOpenContract={onOpenContract}
        />
      )}
    </div>
  );
}

function timeAgo(ts: bigint): string {
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - Number(ts));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
      {children}
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <Panel>
      <p className="animate-pulse text-xs text-gray-500">{label}</p>
    </Panel>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <Panel>
      <p className="text-xs text-red-400">{message}</p>
    </Panel>
  );
}

type BlockRow = {
  number: bigint;
  timestamp: bigint;
  txCount: number;
  gasUsed: bigint;
  gasLimit: bigint;
};

function LatestBlocks({
  client,
  onOpenBlock,
}: {
  client: PublicClient;
  onOpenBlock: (n: string) => void;
}) {
  const [blocks, setBlocks] = useState<BlockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const latest = await client.getBlockNumber();
        const nums: bigint[] = [];
        for (let i = 0; i < 10 && latest - BigInt(i) >= 0n; i++) {
          nums.push(latest - BigInt(i));
        }
        const blks = await Promise.all(
          nums.map((n) => client.getBlock({ blockNumber: n })),
        );
        if (cancelled) return;
        setBlocks(
          blks.map((b) => ({
            number: b.number ?? 0n,
            timestamp: b.timestamp,
            txCount: b.transactions.length,
            gasUsed: b.gasUsed,
            gasLimit: b.gasLimit,
          })),
        );
      } catch (e) {
        if (!cancelled) setError(humanizeError(e instanceof Error ? e.message : String(e)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (error) return <ErrorNote message={error} />;
  if (!blocks) return <Loading label="Loading latest blocks…" />;

  return (
    <Panel>
      <h3 className="text-sm font-semibold text-gray-100">Latest blocks</h3>
      <div className="space-y-1">
        {blocks.map((b) => {
          const pct = b.gasLimit > 0n ? Number((b.gasUsed * 100n) / b.gasLimit) : 0;
          return (
            <button
              key={b.number.toString()}
              onClick={() => onOpenBlock(b.number.toString())}
              className="flex w-full items-center gap-3 rounded-md bg-inset px-3 py-2 text-left ring-1 ring-border/60 transition-colors hover:bg-elevated"
            >
              <span className="font-mono text-sm text-cyan-300">#{b.number.toString()}</span>
              <span className="text-xs text-gray-500">{timeAgo(b.timestamp)}</span>
              <span className="ml-auto text-xs text-gray-400">
                {b.txCount} {b.txCount === 1 ? "tx" : "txs"}
              </span>
              <span className="w-16 text-right font-mono text-xs text-gray-500">{pct}% gas</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

type BlockTx = { hash: Hex; from: Address; to: Address | null; value: bigint };

function BlockView({
  client,
  book,
  value,
  onOpenTx,
  onOpenAddress,
}: {
  client: PublicClient;
  book: AddressBook;
  value: string;
  onOpenTx: (hash: string) => void;
  onOpenAddress: (address: string) => void;
}) {
  const [meta, setMeta] = useState<{
    number: bigint;
    timestamp: bigint;
    gasUsed: bigint;
    gasLimit: bigint;
    miner: string;
    txs: BlockTx[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, boolean | null> | null>(null);
  const [failedOnly, setFailedOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await client.getBlock({
          blockNumber: BigInt(value),
          includeTransactions: true,
        });
        if (cancelled) return;
        const txs = (b.transactions as unknown as {
          hash: Hex;
          from: Address;
          to: Address | null;
          value: bigint;
        }[]).map((t) => ({ hash: t.hash, from: t.from, to: t.to, value: t.value }));
        setMeta({
          number: b.number ?? 0n,
          timestamp: b.timestamp,
          gasUsed: b.gasUsed,
          gasLimit: b.gasLimit,
          miner: b.miner,
          txs,
        });
      } catch (e) {
        if (!cancelled) setError(humanizeError(e instanceof Error ? e.message : String(e)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, value]);

  // Fetch receipt status for the shown txs so we can flag/filter reverts.
  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    setStatuses(null);
    const targets = meta.txs.slice(0, 50);
    (async () => {
      const entries = await Promise.all(
        targets.map(async (t) => {
          try {
            const r = await client.getTransactionReceipt({ hash: t.hash });
            return [t.hash, r.status === "success"] as const;
          } catch {
            return [t.hash, null] as const;
          }
        }),
      );
      if (cancelled) return;
      const m: Record<string, boolean | null> = {};
      for (const [h, s] of entries) m[h] = s;
      setStatuses(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [meta, client]);

  if (error) return <ErrorNote message={error} />;
  if (!meta) return <Loading label={`Loading block ${value}…`} />;

  const capped = meta.txs.slice(0, 50);
  const failedCount = statuses
    ? Object.values(statuses).filter((s) => s === false).length
    : 0;
  const shown =
    failedOnly && statuses ? capped.filter((t) => statuses[t.hash] === false) : capped;

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-100">Block #{meta.number.toString()}</h3>
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-400">
          {meta.txs.length} {meta.txs.length === 1 ? "tx" : "txs"}
        </span>
        <span className="text-xs text-gray-500">{timeAgo(meta.timestamp)}</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Gas used">
          <span className="font-mono text-xs text-gray-200">
            {meta.gasUsed.toLocaleString()}{" "}
            <span className="text-gray-500">
              ({meta.gasLimit > 0n ? Number((meta.gasUsed * 100n) / meta.gasLimit) : 0}%)
            </span>
          </span>
        </Field>
        <Field label="Miner">
          <AddressLabel address={meta.miner} book={book} />
        </Field>
      </div>

      {meta.txs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {statuses === null ? (
            <span className="animate-pulse text-xs text-gray-600">checking statuses…</span>
          ) : failedCount > 0 ? (
            <>
              <span className="rounded-full bg-red-900/40 px-2 py-0.5 text-xs font-medium text-red-400">
                {failedCount} failed
              </span>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500 select-none">
                <input
                  type="checkbox"
                  checked={failedOnly}
                  onChange={(e) => setFailedOnly(e.target.checked)}
                  className="size-3 rounded border-gray-600 bg-gray-900 accent-cyan-600"
                />
                Failed only
              </label>
            </>
          ) : (
            <span className="rounded-full bg-green-900/40 px-2 py-0.5 text-xs font-medium text-green-400">
              all succeeded
            </span>
          )}
          {meta.txs.length > 50 && (
            <span className="text-xs text-gray-600">(first 50)</span>
          )}
        </div>
      )}

      {shown.length > 0 ? (
        <div className="space-y-1">
          {shown.map((t) => (
            <div
              key={t.hash}
              className="flex flex-wrap items-center gap-2 rounded-md bg-inset px-3 py-2 text-xs ring-1 ring-border/60"
            >
              <TxStatusDot status={statuses ? statuses[t.hash] : undefined} />
              <button
                onClick={() => onOpenTx(t.hash)}
                className="font-mono text-cyan-400 hover:text-cyan-300"
                title="Replay transaction"
              >
                {t.hash.slice(0, 10)}…{t.hash.slice(-6)}
              </button>
              <span className="text-gray-600">·</span>
              <ClickableAddress address={t.from} book={book} onClick={onOpenAddress} />
              <span className="text-gray-600">→</span>
              {t.to ? (
                <ClickableAddress address={t.to} book={book} onClick={onOpenAddress} />
              ) : (
                <span className="rounded bg-green-900/50 px-1.5 py-0.5 text-xs text-green-400">
                  contract creation
                </span>
              )}
              {t.value > 0n && (
                <span className="ml-auto font-mono text-yellow-400">
                  {formatEther(t.value)} {CURRENCY}
                </span>
              )}
            </div>
          ))}
          {!failedOnly && meta.txs.length > capped.length && (
            <p className="px-1 pt-1 text-xs text-gray-500">
              and {meta.txs.length - capped.length} more…
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-500">
          {failedOnly ? "No failed transactions shown." : "No transactions in this block."}
        </p>
      )}
    </Panel>
  );
}

function AddressView({
  client,
  book,
  value,
  onOpenContract,
}: {
  client: PublicClient;
  book: AddressBook;
  value: string;
  onOpenContract: (address: string) => void;
}) {
  const [data, setData] = useState<{
    balance: bigint;
    nonce: number;
    codeSize: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const address = value as Address;
        const [balance, nonce, code] = await Promise.all([
          client.getBalance({ address }),
          client.getTransactionCount({ address }),
          client.getCode({ address }),
        ]);
        if (cancelled) return;
        const codeSize = code && code !== "0x" ? (code.length - 2) / 2 : 0;
        setData({ balance, nonce, codeSize });
      } catch (e) {
        if (!cancelled) setError(humanizeError(e instanceof Error ? e.message : String(e)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, value]);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading label="Loading account…" />;

  const isContract = data.codeSize > 0;

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
            isContract ? "bg-violet-900/40 text-violet-400" : "bg-blue-900/50 text-blue-400"
          }`}
        >
          {isContract ? "Contract" : "Account"}
        </span>
        <AddressLabel address={value} book={book} />
        <CopyButton text={value} />
        <a
          href={`${EXPLORER_URL}/address/${value}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-500 hover:text-cyan-400"
        >
          PharosScan ↗
        </a>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Balance">
          <span className="font-mono text-xs text-gray-200">{formatEther(data.balance)} {CURRENCY}</span>
        </Field>
        <Field label="Nonce">
          <span className="font-mono text-xs text-gray-200">{data.nonce}</span>
        </Field>
        <Field label="Code size">
          <span className="font-mono text-xs text-gray-200">
            {isContract ? `${data.codeSize} bytes` : "—"}
          </span>
        </Field>
      </div>

      {isContract && (
        <button
          onClick={() => onOpenContract(value)}
          className="rounded bg-cyan-700 px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-cyan-600"
        >
          Open in Contract tab
        </button>
      )}
    </Panel>
  );
}

function TxStatusDot({ status }: { status: boolean | null | undefined }) {
  const cls =
    status === true ? "bg-success" : status === false ? "bg-danger" : "bg-gray-600";
  const title =
    status === true ? "Success" : status === false ? "Reverted" : "Status unknown";
  return <span className={`size-1.5 shrink-0 rounded-full ${cls}`} title={title} />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-inset px-3 py-2 ring-1 ring-border/60">
      <span className="block text-xs font-medium tracking-wider text-gray-600 uppercase">
        {label}
      </span>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function ClickableAddress({
  address,
  book,
  onClick,
}: {
  address: string;
  book: AddressBook;
  onClick: (address: string) => void;
}) {
  const { open } = useAddressMenu();
  const label = book.resolve(address);
  const short = address.slice(0, 6) + "…" + address.slice(-4);
  return (
    <button
      onClick={() => onClick(address)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        open(address, e.clientX, e.clientY);
      }}
      title={address}
      className={`font-mono ${label ? "text-cyan-300" : "text-gray-400 hover:text-gray-200"}`}
    >
      {label ?? short}
    </button>
  );
}
