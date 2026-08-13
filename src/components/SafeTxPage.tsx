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
import { countCalls, type TraceCall } from "../lib/trace";
import { ACTIVE_NETWORK, CURRENCY, EXPLORER_URL, SAFE_APP_CHAIN } from "../config/chain";
import {
  startSafeBundle,
  type BundleHandle,
  type BundleProgress,
  type BundleResult,
  type BundleTxResult,
} from "../lib/safeBundle";
import {
  fetchOnchainSafeTxByHash,
  fetchOnchainSafeTxs,
  fetchSafeClientTxs,
  fetchSafeInfo,
  isSafeClientSupported,
  safeAppTxUrl,
  safeErrorText,
  simulateExecTransaction,
  sortTxsAsc,
  txTimestampMs,
  type DecodedSafeCall,
  type SafeExecVerdict,
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
  rpcUrl: string;
};

type Tab = "queue" | "history";

export function SafeTxPage({
  client,
  book,
  addressBookSuggest,
  initialAddress,
  onAddressChange,
  rpcUrl,
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
  const [bundle, setBundle] = useState<BundleResult | null>(null);
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
    setBundle(null);
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

          {!loading && tab === "queue" && rows.length > 0 && (
            <QueueSim
              txs={rows}
              safe={info}
              rpcUrl={rpcUrl}
              results={bundle}
              onResults={setBundle}
            />
          )}

          {!loading && tab === "queue" && (
            <QueueList
              txs={rows}
              currentNonce={info.nonce}
              book={book}
              safe={info}
              client={client}
              bundle={bundle}
            />
          )}
          {!loading && tab === "history" && (
            <HistoryList txs={rows} book={book} safe={info} client={client} />
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

/**
 * Runs the queue in nonce order in a local EVM, so a transaction that only
 * works after an earlier one lands simulates correctly. Conflicting txs sharing
 * a nonce can't all execute, so only the first of each nonce joins the bundle.
 */
function QueueSim({
  txs,
  safe,
  rpcUrl,
  results,
  onResults,
}: {
  txs: SafeMultisigTx[];
  safe: SafeInfo;
  rpcUrl: string;
  results: BundleResult | null;
  onResults: (r: BundleResult | null) => void;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BundleProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<BundleHandle | null>(null);

  useEffect(() => () => handle.current?.cancel(), []);

  const executable: SafeMultisigTx[] = [];
  const seenNonce = new Set<number>();
  let skippedConflicts = 0;
  for (const tx of txs) {
    if (tx.nonce === null || tx.nonce < safe.nonce) continue;
    if (seenNonce.has(tx.nonce)) {
      skippedConflicts++;
      continue;
    }
    seenNonce.add(tx.nonce);
    executable.push(tx);
  }

  const run = async () => {
    setRunning(true);
    setError(null);
    onResults(null);
    setProgress({ done: 0, total: executable.length, rpcCalls: 0 });
    const h = startSafeBundle(
      {
        rpcUrl,
        chainId: ACTIVE_NETWORK.chainId,
        blockTag: "latest",
        safe: safe.address,
        owner: safe.owners[0],
        txs: executable.map((tx) => ({
          id: tx.id,
          nonce: tx.nonce,
          to: tx.call.to,
          value: tx.call.value.toString(),
          data: tx.call.data || "0x",
          operation: tx.call.operation,
          safeTxGas: tx.execParams.safeTxGas.toString(),
          baseGas: tx.execParams.baseGas.toString(),
          gasPrice: tx.execParams.gasPrice.toString(),
          gasToken: tx.execParams.gasToken,
          refundReceiver: tx.execParams.refundReceiver,
        })),
      },
      setProgress,
    );
    handle.current = h;
    try {
      onResults(await h.promise);
    } catch (e) {
      setError(humanizeError(e instanceof Error ? e.message : String(e)));
    } finally {
      handle.current = null;
      setRunning(false);
    }
  };

  if (executable.length === 0 || !safe.owners[0]) return null;

  const failed = results?.results.filter((r) => r.status !== "success").length ?? 0;

  return (
    <div className="space-y-2 border-t border-border bg-inset/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="rounded bg-cyan-700 px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-cyan-600 disabled:opacity-40"
        >
          {running ? "Simulating queue…" : `Simulate queue (${executable.length})`}
        </button>
        <span className="text-xs text-gray-500">
          Runs nonce {executable[0].nonce} onward in order, each transaction seeing
          the previous one's effects.
        </span>
      </div>

      {running && progress && (
        <p className="text-xs text-gray-500 tabular-nums">
          {progress.done}/{progress.total} simulated · {progress.rpcCalls} RPC calls
        </p>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {results && (
        <div className="space-y-1">
          <p className="text-xs text-gray-400">
            {failed === 0
              ? `All ${results.results.length} would execute in order.`
              : `${failed} of ${results.results.length} would not go through.`}
            {results.finalNonce !== null && (
              <span className="text-gray-600">
                {" "}
                Safe nonce ends at {results.finalNonce}.
              </span>
            )}
          </p>
          {skippedConflicts > 0 && (
            <p className="text-xs text-gray-600">
              {skippedConflicts} conflicting transaction
              {skippedConflicts === 1 ? "" : "s"} skipped — only one per nonce can
              execute.
            </p>
          )}
          <p className="text-xs text-gray-600">
            Local EVM at the latest block, threshold set to 1. Block timestamp is
            not applied, so time-dependent contracts may differ.
          </p>
        </div>
      )}
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
  safe,
  client,
  bundle,
}: {
  txs: SafeMultisigTx[];
  currentNonce: number;
  book: AddressBook;
  safe: SafeInfo;
  client: PublicClient;
  bundle: BundleResult | null;
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
              safe={safe}
              client={client}
              bundle={bundle}
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
  safe,
  client,
}: {
  txs: SafeMultisigTx[];
  book: AddressBook;
  safe: SafeInfo;
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
              safe={safe}
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
  safe,
  client,
  bundle,
}: {
  group: NonceGroup;
  book: AddressBook;
  safe: SafeInfo;
  client: PublicClient;
  bundle?: BundleResult | null;
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
            safe={safe}
            hideNonce={conflict}
            client={client}
            bundleResult={bundle?.results.find((r) => r.id === tx.id) ?? null}
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
  safe,
  hideNonce,
  client,
  bundleResult,
}: {
  tx: SafeMultisigTx;
  book: AddressBook;
  safe: SafeInfo;
  hideNonce?: boolean;
  client: PublicClient;
  bundleResult?: BundleTxResult | null;
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
        {bundleResult && <BundleBadge result={bundleResult} />}
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
          <TxLinks tx={tx} safeAddress={safe.address} />
          {bundleResult && bundleResult.status !== "success" && (
            <p className="text-xs text-gray-400">
              In queue order this{" "}
              {bundleResult.status === "reverted"
                ? "reverts"
                : "executes but its inner call fails"}
              {bundleResult.reason && (
                <span className="font-mono text-gray-300">
                  {" "}
                  · {safeErrorText(bundleResult.reason)}
                </span>
              )}
              .
            </p>
          )}
          <SafeSim client={client} book={book} safe={safe} tx={tx} />
        </div>
      )}
    </div>
  );
}

function BundleBadge({ result }: { result: BundleTxResult }) {
  const label =
    result.status === "success"
      ? "sim ok"
      : result.status === "inner-failed"
        ? "sim fails"
        : "sim reverts";
  const tone =
    result.status === "success"
      ? "bg-green-950/40 text-success"
      : result.status === "inner-failed"
        ? "bg-amber-900/25 text-warning"
        : "bg-red-950/40 text-danger";
  return (
    <span
      title={result.reason ? safeErrorText(result.reason) : undefined}
      className={`hidden shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium sm:block ${tone}`}
    >
      {label}
    </span>
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

type SimTab = "result" | "trace" | "flow";

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

type ActionRun = { result: CallResult | null; error: string | null };

/** The individual calls a Safe tx performs — MultiSend batches expand to many. */
function leafCalls(call: DecodedSafeCall): DecodedSafeCall[] {
  if (!call.inner || call.inner.length === 0) return [call];
  return call.inner.flatMap(leafCalls);
}

/**
 * Two-layer simulation. The verdict replays the real `execTransaction` with the
 * threshold overridden, so delegatecall, guards and refunds all run for real.
 * The tabs below it call each action directly from the Safe to get a trace,
 * because this node ignores state overrides on debug_traceCall — and it has no
 * prestateTracer for debug_traceCall either, hence no State tab.
 */
function SafeSim({
  client,
  book,
  safe,
  tx,
}: {
  client: PublicClient;
  book: AddressBook;
  safe: SafeInfo;
  tx: SafeMultisigTx;
}) {
  const [loading, setLoading] = useState(false);
  const [verdict, setVerdict] = useState<SafeExecVerdict | null>(null);
  const [runs, setRuns] = useState<Record<number, ActionRun>>({});
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<number | null>(null);
  const [tab, setTab] = useState<SimTab>("result");

  const targets = leafCalls(tx.call);
  const batch = targets.length > 1;

  const callAction = async (i: number): Promise<ActionRun> => {
    const target = targets[i];
    try {
      const to = target.to as Address;
      const abi = getAbiForAddress(to) ?? null;
      const r = await rawCall(
        client,
        {
          to,
          data: (target.data && target.data !== "0x" ? target.data : "0x") as Hex,
          from: safe.address,
          value: target.value > 0n ? target.value : undefined,
        },
        abi,
      );
      return { result: r, error: r.error ?? null };
    } catch (e) {
      return {
        result: null,
        error: humanizeError(e instanceof Error ? e.message : String(e)),
      };
    }
  };

  const run = async () => {
    setLoading(true);
    setRuns({});
    setVerdict(null);
    setActive(0);
    setTab("result");
    const [v, first] = await Promise.all([
      simulateExecTransaction(client, safe, tx).catch(
        (e): SafeExecVerdict => ({
          status: "unavailable",
          reason: humanizeError(e instanceof Error ? e.message : String(e)),
        }),
      ),
      callAction(0),
    ]);
    setVerdict(v);
    setRuns({ 0: first });
    setLoading(false);
  };

  const selectAction = async (i: number) => {
    setActive(i);
    if (runs[i] || pending !== null) return;
    setPending(i);
    const r = await callAction(i);
    setRuns((prev) => ({ ...prev, [i]: r }));
    setPending(null);
  };

  const current = runs[active];
  const result = current?.result ?? null;
  const trace = result?.trace ?? null;

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
          Replays execTransaction against current chain state.
        </span>
      </div>

      {verdict && <VerdictBanner verdict={verdict} book={book} />}

      {batch && verdict && (
        <div>
          <p className="mb-1.5 text-xs text-gray-500">
            Traces below run each action on its own as a call from the Safe, so they
            can drift from the batch.
          </p>
          <div className="flex flex-wrap gap-1">
            {targets.map((t, i) => {
              const actionRun = runs[i];
              const ok = actionRun ? !actionRun.error : null;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectAction(i)}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
                    i === active
                      ? "bg-gray-800 text-gray-100"
                      : "text-gray-500 hover:bg-gray-800/50 hover:text-gray-300"
                  }`}
                >
                  <span
                    className={`size-1.5 rounded-full ${
                      pending === i
                        ? "bg-gray-500"
                        : ok === null
                          ? "bg-gray-700"
                          : ok
                            ? "bg-success"
                            : "bg-danger"
                    }`}
                  />
                  <span className="tabular-nums text-gray-600">{i + 1}</span>
                  <span className="max-w-40 truncate">{callTitle(t)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {pending !== null && !current && (
        <p className="text-xs text-gray-500">Simulating…</p>
      )}

      {current && (
        <>
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
            {trace && result && (
              <SimTabButton
                active={tab === "flow"}
                onClick={() => setTab("flow")}
                badge={countSimTransfers(result) || undefined}
              >
                Flow
              </SimTabButton>
            )}
          </div>

          {tab === "result" && (
            <>
              <ResultPanel result={result} error={current.error} />
              {result?.gasEstimate !== undefined && (
                <p className="text-xs text-gray-600">
                  Gas covers this action only — it excludes execTransaction overhead
                  and any refund.
                </p>
              )}
            </>
          )}

          {tab === "trace" && trace && (
            <>
              <CallTrace trace={trace} book={book} />
              <GasProfiler trace={trace} book={book} />
            </>
          )}

          {tab === "flow" && trace && (
            <MoneyFlow trace={trace} logs={result?.logs} book={book} client={client} />
          )}
        </>
      )}
    </div>
  );
}

function VerdictBanner({
  verdict,
  book,
}: {
  verdict: SafeExecVerdict;
  book: AddressBook;
}) {
  if (verdict.status === "unavailable") {
    return (
      <div className="rounded-lg bg-gray-900/60 px-3 py-2 ring-1 ring-border">
        <p className="text-xs text-gray-400">execTransaction could not be replayed</p>
        <p className="mt-0.5 text-xs text-gray-500">{verdict.reason}</p>
      </div>
    );
  }

  const tone =
    verdict.status === "success"
      ? { ring: "ring-green-900/50", bg: "bg-green-950/30", text: "text-success" }
      : verdict.status === "inner-failed"
        ? { ring: "ring-amber-900/50", bg: "bg-amber-900/15", text: "text-warning" }
        : { ring: "ring-red-900/50", bg: "bg-red-950/30", text: "text-danger" };

  const title =
    verdict.status === "success"
      ? "Would execute successfully"
      : verdict.status === "inner-failed"
        ? "Would execute, but the inner call fails"
        : "Would revert";

  return (
    <div className={`rounded-lg px-3 py-2 ring-1 ${tone.bg} ${tone.ring}`}>
      <p className={`text-xs font-medium ${tone.text}`}>{title}</p>
      {verdict.status === "reverted" && (
        <p className="mt-0.5 font-mono text-xs break-all text-gray-300">
          {verdict.reason}
        </p>
      )}
      {verdict.status === "inner-failed" && (
        <p className="mt-0.5 text-xs text-gray-400">
          execTransaction returns false and emits ExecutionFailure — the Safe still
          consumes the nonce.
        </p>
      )}
      <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-500">
        Real execTransaction as
        <AddressLabel address={verdict.owner} book={book} />
        with threshold overridden to 1, so only signature checks are skipped.
      </p>
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
