import { useState, useEffect, useRef } from "react";
import { formatEther, isAddress, type Address, type Hex, type PublicClient } from "viem";
import type { AddressBook } from "../hooks/useAddressBook";
import { AddressSuggestInput } from "./AddressSuggestInput";
import { AddressLabel } from "./AddressLabel";
import { ValueView } from "./ValueView";
import { CopyButton } from "./CopyButton";
import { ResultPanel } from "./ResultPanel";
import { CallTrace } from "./CallTrace";
import { GasProfiler } from "./GasProfiler";
import { MoneyFlow } from "./MoneyFlow";
import { StateChanges } from "./StateChanges";
import { countCalls, traceCallStateDiff, type StateDiff, type TraceCall } from "../lib/trace";
import { CURRENCY, EXPLORER_URL, SAFE_APP_CHAIN } from "../config/chain";
import {
  fetchOnchainSafeTxByHash,
  fetchOnchainSafeTxs,
  fetchSafeClientTxs,
  fetchSafeInfo,
  isSafeClientSupported,
  safeAppTxUrl,
  sortTxsAsc,
  txTimestampMs,
  type DecodedSafeCall,
  type SafeInfo,
  type SafeMultisigTx,
} from "../lib/safe";
import { rawCall, type CallResult } from "../lib/simulate";
import { getAbiForAddress } from "../lib/storage";
import { humanizeError } from "../lib/errors";
import { classifyQuery } from "../lib/search";

type Props = {
  client: PublicClient;
  book: AddressBook;
  addressBookSuggest: boolean;
  initialAddress: string;
  onAddressChange: (address: string) => void;
};

type Tab = "queue" | "history";

export function SafeTxPage({
  client,
  book,
  addressBookSuggest,
  initialAddress,
  onAddressChange,
}: Props) {
  const [input, setInput] = useState(initialAddress);
  const [info, setInfo] = useState<SafeInfo | null>(null);
  const [queued, setQueued] = useState<SafeMultisigTx[]>([]);
  const [history, setHistory] = useState<SafeMultisigTx[]>([]);
  const [tab, setTab] = useState<Tab>("queue");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cgw, setCgw] = useState(isSafeClientSupported());
  const [hashInput, setHashInput] = useState("");
  const [hashError, setHashError] = useState<string | null>(null);
  const auto = useRef(false);

  const load = async (raw: string) => {
    const trimmed = raw.trim();
    if (!isAddress(trimmed)) {
      setError("Enter a valid Safe address (0x + 40 hex).");
      return;
    }
    setLoading(true);
    setError(null);
    setHashError(null);
    setInfo(null);
    setQueued([]);
    setHistory([]);
    try {
      const safe = await fetchSafeInfo(client, trimmed);
      setInfo(safe);
      onAddressChange(safe.address);
      setInput(safe.address);

      if (isSafeClientSupported()) {
        setCgw(true);
        const txs = await fetchSafeClientTxs(safe.address);
        setQueued(txs.queued);
        setHistory(txs.history);
        setTab(txs.queued.length > 0 ? "queue" : "history");
      } else {
        setCgw(false);
        setTab("history");
        setHistory(await fetchOnchainSafeTxs(safe.address));
      }
    } catch (e) {
      setError(humanizeError(e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (auto.current) return;
    auto.current = true;
    if (isAddress(initialAddress.trim())) load(initialAddress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addHash = async () => {
    if (!info) return;
    const q = hashInput.trim();
    if (classifyQuery(q) !== "tx") {
      setHashError("Enter a transaction hash (0x + 64 hex).");
      return;
    }
    setHashError(null);
    try {
      const tx = await fetchOnchainSafeTxByHash(client, info.address, q as Hex);
      setHistory((prev) => sortTxsAsc([tx, ...prev.filter((t) => t.txHash !== tx.txHash)]));
      setHashInput("");
    } catch (e) {
      setHashError(humanizeError(e instanceof Error ? e.message : String(e)));
    }
  };

  const rows = tab === "queue" ? queued : history;

  return (
    <div className="space-y-5">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          load(input);
        }}
      >
        <div className="min-w-0 flex-1">
          <AddressSuggestInput
            value={input}
            onChange={setInput}
            book={book}
            enabled={addressBookSuggest}
            placeholder="Safe address 0x…"
            className="w-full rounded-lg bg-surface px-3.5 py-2.5 font-mono text-sm text-gray-200 outline-none ring-1 ring-border focus:ring-cyan-600"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-lg bg-cyan-700 px-5 py-2.5 text-sm font-semibold text-on-accent hover:bg-cyan-600 disabled:opacity-40"
        >
          {loading ? "Loading…" : "Load"}
        </button>
      </form>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {info && <SafeHeader info={info} book={book} />}

      {info && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex bg-surface">
            <QueueTab
              active={tab === "queue"}
              onClick={() => setTab("queue")}
              count={queued.length}
              disabled={!cgw}
            >
              Queue
            </QueueTab>
            <QueueTab
              active={tab === "history"}
              onClick={() => setTab("history")}
              count={history.length}
            >
              History
            </QueueTab>
          </div>

          {tab === "queue" && !cgw && (
            <p className="border-t border-border px-4 py-3 text-xs text-gray-500">
              Queued transactions are indexed on Pacific Mainnet only.
            </p>
          )}

          {tab === "history" && !cgw && (
            <div className="space-y-2 border-t border-border px-4 py-3">
              <p className="text-xs text-gray-500">
                No Safe API on this network — on-chain{" "}
                <span className="font-mono">execTransaction</span> calls. Paste a
                hash to decode one.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={hashInput}
                  onChange={(e) => setHashInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addHash();
                  }}
                  placeholder="0x… transaction hash"
                  spellCheck={false}
                  className="w-full rounded-lg bg-inset px-3 py-2 font-mono text-sm text-gray-200 outline-none ring-1 ring-border focus:ring-cyan-600 sm:flex-1"
                />
                <button
                  onClick={addHash}
                  className="rounded-lg bg-elevated px-3 py-2 text-sm text-gray-200 hover:bg-gray-700"
                >
                  Decode hash
                </button>
              </div>
              {hashError && <p className="text-xs text-red-400">{hashError}</p>}
            </div>
          )}

          {loading && (
            <p className="border-t border-border px-4 py-6 text-center text-xs text-gray-500">
              Fetching transactions…
            </p>
          )}

          {!loading && rows.length === 0 && (tab === "history" || cgw) && (
            <p className="border-t border-border px-4 py-10 text-center text-sm text-gray-500">
              {tab === "queue" ? "No queued transactions" : "No transactions yet"}
            </p>
          )}

          {!loading && tab === "queue" && (
            <QueueList
              txs={rows}
              currentNonce={info.nonce}
              book={book}
              safeAddress={info.address}
              client={client}
            />
          )}
          {!loading && tab === "history" && (
            <HistoryList
              txs={rows}
              book={book}
              safeAddress={info.address}
              client={client}
            />
          )}
        </div>
      )}

      {!info && !loading && (
        <p className="text-center text-xs text-gray-600">
          Load a Safe to decode queue and history against your saved ABIs and labels.
          {!SAFE_APP_CHAIN && " Queue requires Pacific Mainnet."}
        </p>
      )}
    </div>
  );
}

function QueueTab({
  active,
  onClick,
  children,
  count,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count: number;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative flex flex-1 items-center justify-center gap-2 py-3 text-sm font-semibold transition disabled:opacity-40 ${
        active ? "text-gray-100" : "text-gray-500 hover:text-gray-300"
      }`}
    >
      {children}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
          active ? "bg-gray-800 text-gray-300" : "bg-gray-900 text-gray-600"
        }`}
      >
        {count}
      </span>
      {active && (
        <span className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-success" />
      )}
    </button>
  );
}

function SafeHeader({ info, book }: { info: SafeInfo; book: AddressBook }) {
  const name = book.resolve(info.address) ?? "Safe";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-surface px-4 py-3">
      <h2 className="text-base font-semibold text-gray-100">{name}</h2>
      <span className="text-xs tabular-nums text-gray-400">
        {info.threshold}/{info.owners.length} owners
      </span>
      <span className="text-xs tabular-nums text-gray-500">nonce {info.nonce}</span>
      {info.version && <span className="text-xs text-gray-600">v{info.version}</span>}
      <span className="sm:ml-auto">
        <AddressLabel address={info.address} book={book} />
      </span>
    </div>
  );
}

type NonceGroup = { nonce: number | null; txs: SafeMultisigTx[] };

function groupByNonce(txs: SafeMultisigTx[]): NonceGroup[] {
  const groups: NonceGroup[] = [];
  for (const tx of txs) {
    const last = groups[groups.length - 1];
    if (last && last.nonce !== null && last.nonce === tx.nonce) last.txs.push(tx);
    else groups.push({ nonce: tx.nonce, txs: [tx] });
  }
  return groups;
}

function QueueList({
  txs,
  currentNonce,
  book,
  safeAddress,
  client,
}: {
  txs: SafeMultisigTx[];
  currentNonce: number;
  book: AddressBook;
  safeAddress: string;
  client: PublicClient;
}) {
  const groups = groupByNonce(txs);
  const next = groups.filter((g) => g.nonce === currentNonce);
  const later = groups.filter((g) => g.nonce !== null && g.nonce > currentNonce);
  const other = groups.filter((g) => g.nonce === null || g.nonce < currentNonce);
  const sections: { title: string; groups: NonceGroup[] }[] = [];
  if (next.length) sections.push({ title: "Next", groups: next });
  if (other.length) sections.push({ title: "Replaced nonce", groups: other });
  if (later.length) sections.push({ title: "Queued", groups: later });
  if (sections.length === 0) return null;
  return (
    <>
      {sections.map((s) => (
        <div key={s.title}>
          <ListHeading>{s.title}</ListHeading>
          {s.groups.map((g) => (
            <NonceBundle
              key={String(g.nonce)}
              group={g}
              book={book}
              safeAddress={safeAddress}
              client={client}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function HistoryList({
  txs,
  book,
  safeAddress,
  client,
}: {
  txs: SafeMultisigTx[];
  book: AddressBook;
  safeAddress: string;
  client: PublicClient;
}) {
  return (
    <>
      {groupByDate(txs).map((g) => (
        <div key={g.label ?? "list"}>
          {g.label && <ListHeading>{g.label}</ListHeading>}
          {groupByNonce(g.txs).map((n) => (
            <NonceBundle
              key={`${g.label}-${String(n.nonce)}-${n.txs[0]?.id}`}
              group={n}
              book={book}
              safeAddress={safeAddress}
              client={client}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function ListHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-border bg-inset/80 px-4 py-1.5 text-[11px] font-medium tracking-wide text-gray-500 uppercase">
      {children}
    </div>
  );
}

function NonceBundle({
  group,
  book,
  safeAddress,
  client,
}: {
  group: NonceGroup;
  book: AddressBook;
  safeAddress: string;
  client: PublicClient;
}) {
  const conflict = group.txs.length > 1;
  return (
    <div>
      {conflict && (
        <div className="border-t border-border border-l-2 border-l-warning bg-amber-900/10 px-4 py-2">
          <p className="text-xs font-medium text-warning">
            {group.txs.length} conflicting transactions
            {group.nonce !== null && (
              <span className="font-normal text-gray-500"> · nonce {group.nonce}</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            Same nonce — executing one invalidates the others.
          </p>
        </div>
      )}
      <div className={conflict ? "border-l-2 border-warning" : ""}>
        {group.txs.map((tx) => (
          <TxRow
            key={tx.id}
            tx={tx}
            book={book}
            safeAddress={safeAddress}
            hideNonce={conflict}
            client={client}
          />
        ))}
      </div>
    </div>
  );
}

function groupByDate(txs: SafeMultisigTx[]): { label: string | null; txs: SafeMultisigTx[] }[] {
  const groups: { label: string | null; txs: SafeMultisigTx[] }[] = [];
  for (const tx of txs) {
    const t = txTimestampMs(tx.timestamp);
    const label = t ? dateLabel(t) : "Unknown date";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.txs.push(tx);
    else groups.push({ label, txs: [tx] });
  }
  return groups;
}

function dateLabel(ms: number): string {
  const d = new Date(ms);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = start(new Date()) - start(d);
  if (diff === 0) return "Today";
  if (diff === 86_400_000) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function timeAgo(ms: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

type TxKind = "ok" | "fail" | "wait" | "ready" | "other";

function txKind(status: string): TxKind {
  const s = status.toUpperCase();
  if (s.includes("SUCCESS") || s === "EXECUTED") return "ok";
  if (s.includes("FAIL")) return "fail";
  if (s.includes("EXECUTION")) return "ready";
  if (s.includes("CONFIRM")) return "wait";
  return "other";
}

function TxRow({
  tx,
  book,
  safeAddress,
  hideNonce,
  client,
}: {
  tx: SafeMultisigTx;
  book: AddressBook;
  safeAddress: string;
  hideNonce?: boolean;
  client: PublicClient;
}) {
  const [open, setOpen] = useState(false);
  const when = txTimestampMs(tx.timestamp);
  const k = txKind(tx.status);
  const title = callTitle(tx.call);
  const toLabel = book.resolve(tx.call.to) ?? tx.call.systemLabel;
  const signed = tx.confirmations.length;
  const need = tx.confirmationsRequired;
  const status =
    k === "ok"
      ? "Success"
      : k === "fail"
        ? "Failed"
        : k === "ready"
          ? "Awaiting execution"
          : k === "wait"
            ? "Awaiting confirmations"
            : null;

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-elevated/50"
      >
        <span
          className={`size-1.5 shrink-0 rounded-full ${
            k === "ok"
              ? "bg-success"
              : k === "fail"
                ? "bg-danger"
                : k === "wait"
                  ? "bg-warning"
                  : k === "ready"
                    ? "bg-success"
                    : "bg-gray-600"
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-gray-100">{title}</div>
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-gray-500">
            {tx.call.inner && tx.call.inner.length > 0 ? (
              <span>{tx.call.inner.length} actions</span>
            ) : (
              <>
                <span>{tx.call.operation === 1 ? "DelegateCall" : "To"}</span>
                <span className="truncate text-gray-400">
                  {toLabel ?? `${tx.call.to.slice(0, 6)}…${tx.call.to.slice(-4)}`}
                </span>
              </>
            )}
            {!hideNonce && tx.nonce !== null && (
              <span className="tabular-nums text-gray-600">· nonce {tx.nonce}</span>
            )}
          </div>
        </div>
        {status && <span className="hidden shrink-0 text-xs text-gray-500 sm:block">{status}</span>}
        {need !== null && (
          <span className="shrink-0 text-xs tabular-nums text-gray-400">
            {signed}/{need}
          </span>
        )}
        {when && (
          <span className="hidden w-16 shrink-0 text-right text-xs text-gray-600 sm:block">
            {timeAgo(when)}
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border/70 bg-inset/40 px-4 py-3">
          <CallView call={tx.call} book={book} />
          <Signers tx={tx} book={book} />
          <TxLinks tx={tx} safeAddress={safeAddress} />
          <SafeSim client={client} book={book} safeAddress={safeAddress} call={tx.call} />
        </div>
      )}
    </div>
  );
}

function callTitle(call: DecodedSafeCall): string {
  const empty = !call.data || call.data === "0x";
  if (empty && call.value > 0n) return `Send ${trimAmount(formatEther(call.value))} ${CURRENCY}`;
  if (empty) return "On-chain rejection";
  if (call.inner && call.inner.length > 1) return "Batch";
  if (call.inner?.length === 1) return callTitle(call.inner[0]);
  return call.decoded?.name ?? "Contract interaction";
}

function trimAmount(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

function Signers({ tx, book }: { tx: SafeMultisigTx; book: AddressBook }) {
  const owners = tx.signers.length > 0 ? tx.signers : tx.confirmations.map((c) => c.signer);
  if (owners.length === 0) return null;
  const signed = new Set(tx.confirmations.map((c) => c.signer.toLowerCase()));
  return (
    <div className="flex flex-wrap gap-1.5">
      {owners.map((o) => {
        const ok = signed.has(o.toLowerCase());
        return (
          <span
            key={o}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ring-1 ${
              ok ? "bg-green-950/40 ring-green-900/40" : "bg-gray-900/40 ring-border"
            }`}
          >
            <span className={`text-[10px] ${ok ? "text-success" : "text-gray-600"}`}>
              {ok ? "✓" : "○"}
            </span>
            <AddressLabel address={o} book={book} />
          </span>
        );
      })}
    </div>
  );
}

function TxLinks({ tx, safeAddress }: { tx: SafeMultisigTx; safeAddress: string }) {
  const appUrl = safeAppTxUrl(safeAddress, tx.id);
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
      {tx.safeTxHash && (
        <span className="inline-flex items-center gap-1">
          <span className="font-mono text-gray-600">
            {tx.safeTxHash.slice(0, 10)}…{tx.safeTxHash.slice(-6)}
          </span>
          <CopyButton text={tx.safeTxHash} />
        </span>
      )}
      {tx.txHash && (
        <a
          href={`${EXPLORER_URL}/tx/${tx.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-cyan-400"
        >
          Explorer
        </a>
      )}
      {appUrl && (
        <a href={appUrl} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-400">
          Open in Safe
        </a>
      )}
    </div>
  );
}

type SimTab = "result" | "trace" | "flow" | "state";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function countSimTransfers(result: CallResult): number {
  let count = 0;

  function walk(t: TraceCall) {
    if (BigInt(t.value) > 0n && t.type !== "DELEGATECALL") count++;
    if (t.calls) for (const c of t.calls) walk(c);
  }
  if (result.trace) walk(result.trace);

  for (const log of result.logs ?? []) {
    const decodedTransfer =
      (log.eventName === "Transfer" || log.eventName.startsWith("Transfer(")) &&
      log.args.from &&
      log.args.to &&
      (log.args.value !== undefined || log.args.amount !== undefined);
    if (decodedTransfer) {
      count++;
      continue;
    }
    const topic0 = log.raw.topics[0];
    if (topic0?.toLowerCase() === TRANSFER_TOPIC && log.raw.topics.length >= 3) {
      try {
        if (BigInt(log.raw.data) > 0n) count++;
      } catch {
        /* skip */
      }
    }
  }
  return count;
}

function SafeSim({
  client,
  book,
  safeAddress,
  call,
}: {
  client: PublicClient;
  book: AddressBook;
  safeAddress: string;
  call: DecodedSafeCall;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stateDiff, setStateDiff] = useState<StateDiff | null>(null);
  const [tab, setTab] = useState<SimTab>("result");

  const run = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    setStateDiff(null);
    setTab("result");
    try {
      const to = call.to as Address;
      const abi = getAbiForAddress(to) ?? null;
      const params = {
        to,
        data: (call.data && call.data !== "0x" ? call.data : "0x") as Hex,
        from: safeAddress as Address,
        value: call.value > 0n ? call.value : undefined,
      };
      const [r, diff] = await Promise.all([
        rawCall(client, params, abi),
        traceCallStateDiff(client, params),
      ]);
      setResult(r);
      setError(r.error ?? null);
      setStateDiff(diff);
    } catch (e) {
      setError(humanizeError(e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  const trace = result?.trace ?? null;
  const stateCount = stateDiff
    ? new Set([...Object.keys(stateDiff.pre), ...Object.keys(stateDiff.post)]).size
    : 0;

  return (
    <div className="space-y-3 border-t border-border/70 pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="rounded bg-cyan-700 px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-cyan-600 disabled:opacity-40"
        >
          {loading ? "Simulating…" : "Simulate"}
        </button>
        <span className="text-xs text-gray-500">
          Calls as the Safe against current chain state
          {call.operation === 1 ? " (delegatecall simulated as a call)" : ""}.
        </span>
      </div>

      {result && (
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-gray-900/80 p-1 ring-1 ring-border">
          <SimTabButton active={tab === "result"} onClick={() => setTab("result")}>
            Result
          </SimTabButton>
          {trace && (
            <SimTabButton
              active={tab === "trace"}
              onClick={() => setTab("trace")}
              badge={countCalls(trace)}
            >
              Trace
            </SimTabButton>
          )}
          {trace && (
            <SimTabButton
              active={tab === "flow"}
              onClick={() => setTab("flow")}
              badge={countSimTransfers(result) || undefined}
            >
              Flow
            </SimTabButton>
          )}
          {stateDiff && (
            <SimTabButton
              active={tab === "state"}
              onClick={() => setTab("state")}
              badge={stateCount}
            >
              State
            </SimTabButton>
          )}
        </div>
      )}

      {(tab === "result" || !result) && <ResultPanel result={result} error={error} />}

      {tab === "trace" && trace && (
        <>
          <CallTrace trace={trace} book={book} />
          <GasProfiler trace={trace} book={book} />
        </>
      )}

      {tab === "flow" && trace && (
        <MoneyFlow trace={trace} logs={result?.logs} book={book} client={client} />
      )}

      {tab === "state" && stateDiff && <StateChanges diff={stateDiff} book={book} />}
    </div>
  );
}

function SimTabButton({
  active,
  onClick,
  children,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number | string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
        active
          ? "bg-gray-800 text-cyan-400 shadow-sm shadow-cyan-500/10"
          : "text-gray-500 hover:bg-gray-800/50 hover:text-gray-300"
      }`}
    >
      {children}
      {badge !== undefined && badge !== 0 && (
        <span
          className={`ml-1 rounded-full px-1.5 py-0.5 text-xs ${
            active ? "bg-cyan-900/40 text-cyan-400" : "bg-gray-800 text-gray-500"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function CallView({
  call,
  book,
  nested,
}: {
  call: DecodedSafeCall;
  book: AddressBook;
  nested?: boolean;
}) {
  const native = (!call.data || call.data === "0x") && call.value > 0n;
  const empty = !call.data || call.data === "0x";
  const title = native
    ? `Send ${trimAmount(formatEther(call.value))} ${CURRENCY}`
    : empty
      ? "On-chain rejection"
      : call.decoded?.name ?? "Unknown call";

  return (
    <div className={nested ? "border-l border-border pl-3" : ""}>
      <div className="flex flex-wrap items-center gap-2">
        {call.operation === 1 && (
          <span className="rounded-full bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium text-warning">
            DelegateCall
          </span>
        )}
        <span className="text-sm font-medium text-gray-100">{title}</span>
        {call.decoded?.name && call.decoded.source !== "none" && (
          <span className="text-[10px] text-gray-600">
            {call.decoded.source === "abi" ? "saved ABI" : "4byte"}
          </span>
        )}
        {call.systemLabel && (
          <span className="rounded-full bg-violet-900/40 px-1.5 py-0.5 text-[10px] text-violet-300">
            {call.systemLabel}
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1">
          to
          <AddressLabel address={call.to} book={book} />
        </span>
        {call.value > 0n && !native && (
          <span className="tabular-nums">
            {trimAmount(formatEther(call.value))} {CURRENCY}
          </span>
        )}
        {call.data && call.data !== "0x" && <CopyButton text={call.data} label="data" />}
      </div>

      {call.decoded?.name && call.decoded.args.length > 0 && !call.inner && (
        <ArgTable decoded={call.decoded} book={book} />
      )}

      {call.inner && call.inner.length > 0 && (
        <div className="mt-2.5 space-y-2.5">
          {call.inner.map((c, i) => (
            <CallView key={i} call={c} book={book} nested />
          ))}
        </div>
      )}
    </div>
  );
}

function ArgTable({
  decoded,
  book,
}: {
  decoded: NonNullable<DecodedSafeCall["decoded"]>;
  book: AddressBook;
}) {
  return (
    <div className="mt-2 overflow-x-auto rounded-lg ring-1 ring-border">
      <table className="w-full border-collapse text-xs">
        <tbody>
          {decoded.args.map((arg, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0">
              <td className="px-2.5 py-1.5 font-mono whitespace-nowrap text-gray-500">
                {arg.name || `arg${i}`}
              </td>
              <td className="px-2.5 py-1.5 font-mono text-gray-600">{arg.type || "—"}</td>
              <td className="px-2.5 py-1.5 font-mono">
                <ValueView value={arg.value} book={book} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
