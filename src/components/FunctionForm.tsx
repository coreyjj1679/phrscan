import { useState, useEffect } from "react";
import type { Abi, PublicClient, Address } from "viem";
import { type AbiFunction, isReadFunction } from "../lib/abi";
import { readOrSimulate, type CallResult } from "../lib/simulate";
import {
  getSavedCalls,
  saveCall,
  deleteCall,
  type SavedCall,
} from "../lib/storage";
import { AddressSuggestInput } from "./AddressSuggestInput";
import type { AddressBook } from "../hooks/useAddressBook";

type Props = {
  fn: AbiFunction;
  abi: Abi;
  address: string;
  client: PublicClient;
  onResult: (result: CallResult | null, error: string | null) => void;
  initialCall?: SavedCall | null;
  book?: AddressBook;
  addressBookSuggest?: boolean;
};

export function FunctionForm({ fn, abi, address, client, onResult, initialCall, book, addressBookSuggest = false }: Props) {
  const [args, setArgs] = useState<string[]>(
    initialCall?.functionName === fn.name && initialCall.args.length === fn.inputs.length
      ? initialCall.args
      : fn.inputs.map(() => ""),
  );
  const [from, setFrom] = useState(initialCall?.from ?? "");
  const [blockNumber, setBlockNumber] = useState(initialCall?.blockNumber ?? "");
  const [useCustomBlock, setUseCustomBlock] = useState(initialCall?.useCustomBlock ?? false);
  const [value, setValue] = useState(initialCall?.value ?? "");
  const [showValue, setShowValue] = useState(!!(initialCall?.value));
  const [loading, setLoading] = useState(false);

  const [savedCalls, setSavedCalls] = useState<SavedCall[]>([]);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");

  const isRead = isReadFunction(fn);

  useEffect(() => {
    setSavedCalls(
      getSavedCalls(address).filter((c) => c.functionName === fn.name),
    );
  }, [address, fn.name]);

  const refreshSaved = () => {
    setSavedCalls(
      getSavedCalls(address).filter((c) => c.functionName === fn.name),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    onResult(null, null);

    try {
      const parsedArgs = fn.inputs.map((input, i) => parseArg(input.type, args[i]));
      const opts: { from?: Address; blockNumber?: bigint; value?: bigint } = {};
      if (!isRead && from.trim()) opts.from = from.trim() as Address;
      if (useCustomBlock && blockNumber.trim()) opts.blockNumber = BigInt(blockNumber.trim());
      if (showValue && value.trim()) opts.value = BigInt(value.trim());

      const result = await readOrSimulate(
        client,
        address as Address,
        abi,
        fn,
        parsedArgs,
        opts,
      );
      onResult(result, result.error ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onResult(null, msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    const label = saveLabel.trim() || `${fn.name}(…)`;
    const call: SavedCall = {
      id: `${address}-${fn.name}-${Date.now()}`,
      label,
      contractAddress: address,
      functionName: fn.name,
      args,
      from,
      value,
      blockNumber,
      useCustomBlock,
      mode: "function",
      savedAt: Date.now(),
    };
    saveCall(call);
    refreshSaved();
    setShowSaveForm(false);
    setSaveLabel("");
  };

  const handleLoadCall = (c: SavedCall) => {
    if (c.args.length === fn.inputs.length) setArgs(c.args);
    setFrom(c.from);
    setValue(c.value);
    setShowValue(!!c.value);
    setBlockNumber(c.blockNumber);
    setUseCustomBlock(c.useCustomBlock);
  };

  const handleDeleteCall = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteCall(id);
    refreshSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded bg-gray-900/50 p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <h3 className="font-mono text-sm font-semibold text-gray-200">{fn.name}</h3>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
            isRead
              ? "bg-green-900/50 text-green-400"
              : "bg-amber-900/50 text-amber-400"
          }`}
        >
          {isRead ? "read" : "write"}
        </span>
      </div>

      {savedCalls.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium text-gray-500">Saved calls</p>
          <div className="flex flex-wrap gap-1.5">
            {savedCalls.map((c) => (
              <div
                key={c.id}
                className="group flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 cursor-pointer"
              >
                <span onClick={() => handleLoadCall(c)} className="truncate max-w-[140px]">
                  {c.label}
                </span>
                <button
                  type="button"
                  onClick={(e) => handleDeleteCall(c.id, e)}
                  className="ml-0.5 hidden text-gray-600 hover:text-red-400 group-hover:inline"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {fn.inputs.map((input, i) => (
        <div key={i}>
          <label className="mb-1 block text-xs text-gray-400">
            {input.name || `arg${i}`}{" "}
            <span className="text-gray-600">({input.type})</span>
          </label>
          {input.type === "address" && book ? (
            <AddressSuggestInput
              value={args[i]}
              onChange={(v) => {
                const next = [...args];
                next[i] = v;
                setArgs(next);
              }}
              book={book}
              enabled={addressBookSuggest}
              placeholder={input.type}
              className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-sm text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
            />
          ) : (
            <input
              type="text"
              value={args[i]}
              onChange={(e) => {
                const next = [...args];
                next[i] = e.target.value;
                setArgs(next);
              }}
              placeholder={input.type}
              spellCheck={false}
              className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-sm text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
            />
          )}
        </div>
      ))}

      {!isRead && (
        <div>
          <label className="mb-1 block text-xs text-gray-400">From (sender)</label>
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
      )}

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
        <input
          type="text"
          value={blockNumber}
          onChange={(e) => setBlockNumber(e.target.value)}
          placeholder="Block number"
          spellCheck={false}
          className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
        />
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

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className={`flex-1 rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${
            isRead
              ? "bg-green-700 hover:bg-green-600"
              : "bg-amber-700 hover:bg-amber-600"
          }`}
        >
          {loading ? "Calling…" : isRead ? "Read" : "Simulate"}
        </button>

        {!showSaveForm && (
          <button
            type="button"
            onClick={() => setShowSaveForm(true)}
            className="rounded bg-gray-700 px-3 py-2 text-xs text-gray-400 hover:bg-gray-600 hover:text-gray-200"
            title="Save this call configuration"
          >
            Save
          </button>
        )}
      </div>

      {showSaveForm && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={saveLabel}
            onChange={(e) => setSaveLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
            placeholder="Call label (optional)"
            className="flex-1 rounded bg-gray-900 px-3 py-1.5 text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 rounded bg-cyan-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-600 sm:flex-none"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowSaveForm(false)}
              className="rounded bg-gray-700 px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function parseArg(type: string, value: string): unknown {
  const trimmed = value.trim();

  if (type === "bool") return trimmed === "true" || trimmed === "1";

  if (type.startsWith("uint") || type.startsWith("int")) {
    return BigInt(trimmed);
  }

  if (type === "address" || type.startsWith("bytes")) return trimmed;

  if (type.endsWith("[]")) {
    try {
      const arr = JSON.parse(trimmed);
      if (!Array.isArray(arr)) throw new Error("Expected array");
      const baseType = type.slice(0, -2);
      return arr.map((item: unknown) => parseArg(baseType, String(item)));
    } catch {
      return trimmed.split(",").map((s) => parseArg(type.slice(0, -2), s.trim()));
    }
  }

  if (type === "tuple" || type.startsWith("(")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}
