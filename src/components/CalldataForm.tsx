import { useState } from "react";
import type { PublicClient, Address, Hex, Abi } from "viem";
import { toFunctionSelector } from "viem";
import { rawCall, tryDecodeResult, type CallResult } from "../lib/simulate";
import { extractFunctions } from "../lib/abi";
import { AddressSuggestInput } from "./AddressSuggestInput";
import type { AddressBook } from "../hooks/useAddressBook";

export type CalldataInitial = {
  to?: string;
  from?: string;
  data?: string;
  value?: string;
  blockNumber?: string;
};

type Props = {
  client: PublicClient;
  abi: Abi | null;
  contractAddress: string;
  initial?: CalldataInitial;
  onResult: (result: CallResult | null, error: string | null) => void;
  book?: AddressBook;
  addressBookSuggest?: boolean;
};

export function CalldataForm({ client, abi, contractAddress, initial, onResult, book, addressBookSuggest = false }: Props) {
  const [to, setTo] = useState(initial?.to ?? contractAddress);
  const [data, setData] = useState(initial?.data ?? "");
  const [from, setFrom] = useState(initial?.from ?? "");
  const [value, setValue] = useState(initial?.value ?? "");
  const [blockNumber, setBlockNumber] = useState(initial?.blockNumber ?? "");
  const [loading, setLoading] = useState(false);

  const hasInitialValue = !!(initial?.value);
  const [showValue, setShowValue] = useState(hasInitialValue);
  const [useCustomBlock, setUseCustomBlock] = useState(!!(initial?.blockNumber));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.trim() || !data.trim()) return;
    setLoading(true);
    onResult(null, null);

    try {
      const opts = {
        to: to.trim() as Address,
        data: data.trim() as Hex,
        from: from.trim() ? (from.trim() as Address) : undefined,
        value: showValue && value.trim() ? BigInt(value.trim()) : undefined,
        blockNumber: useCustomBlock && blockNumber.trim() ? BigInt(blockNumber.trim()) : undefined,
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

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded bg-gray-900/50 p-3 sm:p-4">
      <h3 className="text-sm font-semibold text-gray-200">Raw Calldata Simulation</h3>

      <div>
        <label className="mb-1 block text-xs text-gray-400">To (target address)</label>
        {book ? (
          <AddressSuggestInput
            value={to}
            onChange={setTo}
            book={book}
            enabled={addressBookSuggest}
            placeholder="0x…"
            className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
        ) : (
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs text-gray-400">Calldata (hex)</label>
        <textarea
          value={data}
          onChange={(e) => setData(e.target.value)}
          placeholder="0x…"
          rows={3}
          spellCheck={false}
          className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-gray-400">From</label>
        {book ? (
          <AddressSuggestInput
            value={from}
            onChange={setFrom}
            book={book}
            enabled={addressBookSuggest}
            placeholder="0x…"
            className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
        ) : (
          <input
            type="text"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
        )}
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
          <label className="mb-1 block text-xs text-gray-400">Value (wei)</label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0"
            spellCheck={false}
            className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !to.trim() || !data.trim()}
        className="w-full rounded bg-purple-700 px-4 py-2 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-40"
      >
        {loading ? "Simulating…" : "Simulate Call"}
      </button>
    </form>
  );
}
