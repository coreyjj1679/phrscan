import { useState } from "react";
import { isAddress, type Address, type Hex, type PublicClient } from "viem";
import { rawCall, type CallResult } from "../lib/simulate";
import { valueToWei, type ValueUnit } from "../lib/units";
import { CURRENCY } from "../config/chain";
import {
  emptyOverrides,
  hasOverrides,
  buildOverrides,
  type SimOverrides,
} from "../lib/overrides";
import type { AddressBook } from "../hooks/useAddressBook";
import { AddressSuggestInput } from "./AddressSuggestInput";
import { OverridesEditor } from "./OverridesEditor";
import { ResultPanel } from "./ResultPanel";
import { CallTrace } from "./CallTrace";
import { MoneyFlow } from "./MoneyFlow";

type Step = { to: string; data: string; value: string };

const emptyStep = (): Step => ({ to: "", data: "", value: "" });

type Props = {
  client: PublicClient;
  book: AddressBook;
  addressBookSuggest?: boolean;
};

export function BundleSimulator({ client, book, addressBookSuggest = false }: Props) {
  const [steps, setSteps] = useState<Step[]>([emptyStep()]);
  const [from, setFrom] = useState("");
  const [valueUnit, setValueUnit] = useState<ValueUnit>("wei");
  const [blockNumber, setBlockNumber] = useState("");
  const [useCustomBlock, setUseCustomBlock] = useState(false);
  const [showOverrides, setShowOverrides] = useState(false);
  const [overrides, setOverrides] = useState<SimOverrides>(() => emptyOverrides());
  const [results, setResults] = useState<(CallResult | null)[]>([]);
  const [running, setRunning] = useState(false);

  const setStep = (i: number, patch: Partial<Step>) =>
    setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const addStep = () => setSteps((prev) => [...prev, emptyStep()]);
  const removeStep = (i: number) =>
    setSteps((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));
  const moveStep = (i: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const run = async () => {
    setRunning(true);
    const built = showOverrides && hasOverrides(overrides) ? buildOverrides(overrides) : undefined;
    const block = useCustomBlock && blockNumber.trim() ? BigInt(blockNumber.trim()) : undefined;
    const fromAddr = from.trim() ? (from.trim() as Address) : undefined;
    const next: (CallResult | null)[] = steps.map(() => null);
    setResults([...next]);

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      try {
        if (!isAddress(s.to.trim())) throw new Error("Invalid target address.");
        const data = s.data.trim();
        if (!/^0x[0-9a-fA-F]*$/.test(data) || data.length < 10) {
          throw new Error("Calldata must be 0x + at least a 4-byte selector.");
        }
        const value = s.value.trim() ? valueToWei(s.value, valueUnit) : undefined;
        next[i] = await rawCall(
          client,
          { to: s.to.trim() as Address, data: data as Hex, from: fromAddr, value, blockNumber: block, overrides: built },
          null,
        );
      } catch (e) {
        next[i] = { decoded: undefined, raw: "0x" as Hex, error: e instanceof Error ? e.message : String(e) };
      }
      setResults([...next]);
    }
    setRunning(false);
  };

  const completed = results.filter((r) => r !== null);
  const succeeded = completed.filter((r) => r && !r.error).length;
  const totalGas = completed.reduce((sum, r) => sum + (r?.gasEstimate ?? 0n), 0n);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">
          Bundle / multi-call scenario
        </h2>
        <p className="text-xs text-gray-600">
          Run a sequence of calls against the same base state, block, and overrides below.
          This RPC can&rsquo;t carry state automatically between steps, so use{" "}
          <span className="text-gray-400">overrides</span> to set up prerequisites (allowances,
          balances, storage) that a later step depends on.
        </p>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-3 sm:p-4">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-gray-400">Sender (from) — shared</label>
          {book ? (
            <AddressSuggestInput
              value={from}
              onChange={setFrom}
              book={book}
              enabled={addressBookSuggest}
              placeholder="0x… (optional)"
              className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
            />
          ) : (
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="0x… (optional)"
              spellCheck={false}
              className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
            />
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-400">Value unit</label>
          <select
            value={valueUnit}
            onChange={(e) => setValueUnit(e.target.value as ValueUnit)}
            className="w-full rounded bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-gray-700 focus:ring-cyan-600"
          >
            <option value="wei">wei</option>
            <option value="gwei">gwei</option>
            <option value="ether">{CURRENCY}</option>
          </select>
        </div>
      </div>

      <div className="space-y-3">
        {steps.map((s, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border bg-surface p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-300">Step {i + 1}</span>
              <div className="flex items-center gap-1">
                <IconBtn label="Move up" onClick={() => moveStep(i, -1)} disabled={i === 0}>
                  ↑
                </IconBtn>
                <IconBtn label="Move down" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}>
                  ↓
                </IconBtn>
                <IconBtn label="Remove step" onClick={() => removeStep(i)} disabled={steps.length === 1}>
                  ✕
                </IconBtn>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-gray-400">To</label>
              {book ? (
                <AddressSuggestInput
                  value={s.to}
                  onChange={(v) => setStep(i, { to: v })}
                  book={book}
                  enabled={addressBookSuggest}
                  placeholder="0x… target contract"
                  className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
                />
              ) : (
                <input
                  value={s.to}
                  onChange={(e) => setStep(i, { to: e.target.value })}
                  placeholder="0x… target contract"
                  spellCheck={false}
                  className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
                />
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs text-gray-400">Calldata</label>
              <textarea
                value={s.data}
                onChange={(e) => setStep(i, { data: e.target.value })}
                placeholder="0x…"
                rows={2}
                spellCheck={false}
                className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
              />
            </div>

            <div className="w-40">
              <label className="mb-1 block text-xs text-gray-400">Value ({valueUnit})</label>
              <input
                value={s.value}
                onChange={(e) => setStep(i, { value: e.target.value })}
                placeholder="0"
                spellCheck={false}
                className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={addStep}
          className="rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-600"
        >
          + Add step
        </button>
        <label className="flex items-center gap-1.5 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={useCustomBlock}
            onChange={(e) => setUseCustomBlock(e.target.checked)}
          />
          Block
        </label>
        {useCustomBlock && (
          <input
            value={blockNumber}
            onChange={(e) => setBlockNumber(e.target.value)}
            placeholder="block number"
            spellCheck={false}
            className="w-32 rounded bg-gray-900 px-2 py-1 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
        )}
        <button
          onClick={() => setShowOverrides((v) => !v)}
          className={`text-xs underline ${showOverrides ? "text-cyan-400" : "text-gray-500 hover:text-gray-300"}`}
        >
          {showOverrides ? "Hide overrides" : "State overrides"}
        </button>
      </div>

      {showOverrides && <OverridesEditor value={overrides} onChange={setOverrides} />}

      <button
        onClick={run}
        disabled={running}
        className="rounded bg-purple-700 px-4 py-2 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-40"
      >
        {running ? "Running…" : `Run ${steps.length} ${steps.length === 1 ? "step" : "steps"}`}
      </button>

      {completed.length > 0 && (
        <div className="rounded-lg border border-border bg-inset px-3 py-2 text-xs ring-1 ring-border/60">
          <span className="text-gray-400">
            {succeeded}/{completed.length} succeeded
          </span>
          <span className="mx-2 text-gray-700">·</span>
          <span className="text-gray-400">
            total gas <span className="font-mono text-gray-200">{totalGas.toLocaleString()}</span>
          </span>
        </div>
      )}

      {results.map((r, i) =>
        r === null ? (
          running ? (
            <div key={i} className="rounded-lg border border-border bg-surface p-3 text-xs text-gray-500">
              Step {i + 1}: <span className="animate-pulse">simulating…</span>
            </div>
          ) : null
        ) : (
          <div key={i} className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-300">Step {i + 1}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                  r.error ? "bg-red-900/50 text-red-400" : "bg-green-900/50 text-green-400"
                }`}
              >
                {r.error ? "reverted" : "success"}
              </span>
              {r.gasEstimate !== undefined && (
                <span className="font-mono text-xs text-gray-500">
                  gas {r.gasEstimate.toLocaleString()}
                </span>
              )}
            </div>
            <ResultPanel result={r.error ? null : r} error={r.error ?? null} />
            {r.trace && <CallTrace trace={r.trace} book={book} />}
            {r.trace && (
              <MoneyFlow trace={r.trace} logs={r.logs} book={book} client={client} />
            )}
          </div>
        ),
      )}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded px-1.5 py-0.5 font-mono text-xs text-gray-500 hover:bg-gray-700 hover:text-gray-200 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
