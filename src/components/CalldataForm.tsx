import { useState, useEffect, useRef } from "react";
import type { PublicClient, Address, Hex, Abi } from "viem";
import { isAddress, toFunctionSelector } from "viem";
import { rawCall, tryDecodeResult, type CallResult } from "../lib/simulate";
import { extractFunctions } from "../lib/abi";
import { AddressSuggestInput } from "./AddressSuggestInput";
import { valueToWei, safeValueToWei, type ValueUnit } from "../lib/units";
import { CURRENCY, ACTIVE_NETWORK } from "../config/chain";
import { castCall } from "../lib/cast";
import { buildSimShareUrl, buildTxShareUrl } from "../lib/shareSim";
import { OverridesEditor } from "./OverridesEditor";
import { CopyButton } from "./CopyButton";
import {
  emptyOverrides,
  hasOverrides,
  buildOverrides,
  type SimOverrides,
} from "../lib/overrides";
import type { AddressBook } from "../hooks/useAddressBook";

export type CalldataInitial = {
  to?: string;
  from?: string;
  data?: string;
  value?: string;
  blockNumber?: string;
  unit?: ValueUnit;
  overrides?: SimOverrides;
  /** Run the simulation automatically once on mount (shared links). */
  autoRun?: boolean;
};

type Props = {
  client: PublicClient;
  abi: Abi | null;
  contractAddress: string;
  initial?: CalldataInitial;
  onResult: (result: CallResult | null, error: string | null) => void;
  book?: AddressBook;
  addressBookSuggest?: boolean;
  rpcUrl?: string;
  /**
   * Source transaction hash when this form is a replay re-sim. When the form is
   * still the unmodified original tx, Share emits a compact `?tab=replay&tx=…`
   * link instead of embedding the whole calldata.
   */
  shareTxHash?: string;
};

export function CalldataForm({ client, abi, contractAddress, initial, onResult, book, addressBookSuggest = false, rpcUrl = ACTIVE_NETWORK.rpc, shareTxHash }: Props) {
  const [to, setTo] = useState(initial?.to ?? contractAddress);
  const [data, setData] = useState(initial?.data ?? "");
  const [from, setFrom] = useState(initial?.from ?? "");
  const [value, setValue] = useState(initial?.value ?? "");
  const [blockNumber, setBlockNumber] = useState(initial?.blockNumber ?? "");
  const [loading, setLoading] = useState(false);
  const [toError, setToError] = useState<string | null>(null);
  const [fromError, setFromError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);

  const hasInitialValue = !!(initial?.value);
  const [showValue, setShowValue] = useState(hasInitialValue);
  const [valueUnit, setValueUnit] = useState<ValueUnit>(initial?.unit ?? "wei");
  const [useCustomBlock, setUseCustomBlock] = useState(!!(initial?.blockNumber));
  const [showOverrides, setShowOverrides] = useState(
    !!(initial?.overrides && hasOverrides(initial.overrides)),
  );
  const [overrides, setOverrides] = useState<SimOverrides>(
    () => initial?.overrides ?? emptyOverrides(),
  );

  const runSim = async () => {
    const newToError = !to.trim() ? "Address is required" : !isAddress(to.trim()) ? "Invalid address" : null;
    const newFromError = from.trim() ? (!isAddress(from.trim()) ? "Invalid address" : null) : null;
    const newDataError = !data.trim() ? "Calldata is required" : !/^0x[0-9a-fA-F]*$/.test(data.trim()) ? "Invalid hex (expected 0x…)" : null;
    setToError(newToError);
    setFromError(newFromError);
    setDataError(newDataError);
    if (newToError || newFromError || newDataError) return;

    setLoading(true);
    onResult(null, null);

    try {
      const opts = {
        to: to.trim() as Address,
        data: data.trim() as Hex,
        from: from.trim() ? (from.trim() as Address) : undefined,
        value: showValue && value.trim() ? valueToWei(value, valueUnit) : undefined,
        blockNumber: useCustomBlock && blockNumber.trim() ? BigInt(blockNumber.trim()) : undefined,
        overrides:
          showOverrides && hasOverrides(overrides) ? buildOverrides(overrides) : undefined,
      };

      const result = await rawCall(client, opts, abi);

      if (abi && result.raw && result.raw !== "0x") {
        const selector = data.trim().slice(0, 10).toLowerCase();
        const fns = extractFunctions(abi);
        for (const fn of fns) {
          try {
            const fnSelector = toFunctionSelector(fn).toLowerCase();
            if (selector === fnSelector) {
              result.decoded = tryDecodeResult(abi, fn.name, result.raw);
              break;
            }
          } catch {
            // selector mismatch, try next
          }
        }
      }

      onResult(result, result.error ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onResult(null, msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSim();
  };

  const autoRan = useRef(false);
  useEffect(() => {
    if (initial?.autoRun && !autoRan.current && to.trim() && data.trim()) {
      autoRan.current = true;
      runSim();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A replay re-sim that still matches the original tx can be shared as a short
  // `?tab=replay&tx=…` link. Once any field is edited, fall back to the full
  // `?sim=…` link so the edits are actually captured.
  const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();
  const replayUnchanged =
    !!shareTxHash &&
    norm(to) === norm(initial?.to) &&
    norm(data) === norm(initial?.data) &&
    norm(from) === norm(initial?.from) &&
    (showValue && value.trim() ? value.trim() : "") === (initial?.value ?? "") &&
    valueUnit === (initial?.unit ?? "wei") &&
    (useCustomBlock && blockNumber.trim() ? blockNumber.trim() : "") === (initial?.blockNumber ?? "") &&
    !(showOverrides && hasOverrides(overrides));

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded bg-gray-900/50 p-3 sm:p-4">
      <h3 className="text-sm font-semibold text-gray-200">Raw Calldata Simulation</h3>

      <div>
        <label className="mb-1 block text-xs text-gray-400">To (target address)</label>
        {book ? (
          <AddressSuggestInput
            value={to}
            onChange={(v) => { setTo(v); if (toError) setToError(null); }}
            book={book}
            enabled={addressBookSuggest}
            placeholder="0x…"
            className={`w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ${toError ? "ring-red-500" : "ring-gray-700"} focus:ring-cyan-600`}
          />
        ) : (
          <input
            type="text"
            value={to}
            onChange={(e) => { setTo(e.target.value); if (toError) setToError(null); }}
            placeholder="0x…"
            spellCheck={false}
            className={`w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ${toError ? "ring-red-500" : "ring-gray-700"} focus:ring-cyan-600`}
          />
        )}
        {toError && <p className="mt-1 text-xs text-red-400">{toError}</p>}
      </div>

      <div>
        <label className="mb-1 block text-xs text-gray-400">Calldata (hex)</label>
        <textarea
          value={data}
          onChange={(e) => { setData(e.target.value); if (dataError) setDataError(null); }}
          placeholder="0x…"
          rows={3}
          spellCheck={false}
          className={`w-full rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-200 outline-none ring-1 ${dataError ? "ring-red-500" : "ring-gray-700"} focus:ring-cyan-600`}
        />
        {dataError && <p className="mt-1 text-xs text-red-400">{dataError}</p>}
      </div>

      <div>
        <label className="mb-1 block text-xs text-gray-400">From</label>
        {book ? (
          <AddressSuggestInput
            value={from}
            onChange={(v) => { setFrom(v); if (fromError) setFromError(null); }}
            book={book}
            enabled={addressBookSuggest}
            placeholder="0x…"
            className={`w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ${fromError ? "ring-red-500" : "ring-gray-700"} focus:ring-cyan-600`}
          />
        ) : (
          <input
            type="text"
            value={from}
            onChange={(e) => { setFrom(e.target.value); if (fromError) setFromError(null); }}
            placeholder="0x…"
            spellCheck={false}
            className={`w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ${fromError ? "ring-red-500" : "ring-gray-700"} focus:ring-cyan-600`}
          />
        )}
        {fromError && <p className="mt-1 text-xs text-red-400">{fromError}</p>}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={useCustomBlock}
            onChange={(e) => {
              setUseCustomBlock(e.target.checked);
              if (!e.target.checked) setBlockNumber("");
            }}
            className="size-3.5 rounded border-gray-600 bg-gray-900"
          />
          Custom block number
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={showValue}
            onChange={(e) => {
              setShowValue(e.target.checked);
              if (!e.target.checked) setValue("");
            }}
            className="size-3.5 rounded border-gray-600 bg-gray-900"
          />
          Send value
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={showOverrides}
            onChange={(e) => setShowOverrides(e.target.checked)}
            className="size-3.5 rounded border-gray-600 bg-gray-900"
          />
          State overrides
        </label>
      </div>

      {useCustomBlock && (
        <div>
          <label className="mb-1 block text-xs text-gray-400">Block #</label>
          <input
            type="text"
            value={blockNumber}
            onChange={(e) => setBlockNumber(e.target.value)}
            placeholder="latest"
            spellCheck={false}
            className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
        </div>
      )}

      {showValue && (
        <div>
          <label className="mb-1 block text-xs text-gray-400">Value</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0"
              spellCheck={false}
              className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
            />
            <select
              value={valueUnit}
              onChange={(e) => setValueUnit(e.target.value as ValueUnit)}
              aria-label="Value unit"
              className="shrink-0 rounded bg-gray-900 px-2 py-1.5 text-xs text-gray-300 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
            >
              <option value="wei">wei</option>
              <option value="gwei">gwei</option>
              <option value="ether">{CURRENCY}</option>
            </select>
          </div>
        </div>
      )}

      {showOverrides && <OverridesEditor value={overrides} onChange={setOverrides} />}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={loading || !to.trim() || !data.trim()}
          className="flex-1 rounded bg-purple-700 px-4 py-2 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-40"
        >
          {loading ? "Simulating…" : "Simulate Call"}
        </button>
        {to.trim() && data.trim() && (
          <CopyButton
            text={castCall({
              to: to.trim(),
              data: data.trim(),
              from: from.trim() || undefined,
              value:
                showValue && value.trim() ? safeValueToWei(value, valueUnit) : undefined,
              block: useCustomBlock && blockNumber.trim() ? blockNumber.trim() : undefined,
              rpc: rpcUrl,
            })}
            label="Copy as cast"
            className="ml-1"
          />
        )}
        {to.trim() && data.trim() && (
          <CopyButton
            text={
              shareTxHash && replayUnchanged
                ? buildTxShareUrl(shareTxHash)
                : buildSimShareUrl({
                    to: to.trim(),
                    from: from.trim() || undefined,
                    data: data.trim(),
                    value: showValue && value.trim() ? value.trim() : undefined,
                    unit: showValue ? valueUnit : undefined,
                    block: useCustomBlock && blockNumber.trim() ? blockNumber.trim() : undefined,
                    overrides: showOverrides && hasOverrides(overrides) ? overrides : undefined,
                  })
            }
            label={shareTxHash && replayUnchanged ? "Share replay" : "Share"}
            className="ml-1"
          />
        )}
      </div>
    </form>
  );
}
