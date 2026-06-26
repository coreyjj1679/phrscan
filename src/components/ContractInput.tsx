import { useState, useEffect, useRef } from "react";
import type { Abi } from "viem";
import { getSavedContracts, deleteContract, type SavedContract } from "../lib/storage";
import { EXPLORER_URL } from "../config/chain";
import type { ProxyInfo } from "../lib/proxy";
import { AbiTextarea } from "./AbiTextarea";

type Props = {
  loading: boolean;
  verified: boolean;
  partial: boolean;
  proxy?: ProxyInfo | null;
  abi: Abi | null;
  error: string | null;
  onLoad: (address: string) => void;
  onPasteAbi: (raw: string, address: string) => void;
  onClear: () => void;
  onLoadSaved: (saved: SavedContract) => void;
  initialAddress?: string;
};

export function ContractInput({
  loading,
  verified,
  partial,
  proxy,
  abi,
  error,
  onLoad,
  onPasteAbi,
  onClear,
  onLoadSaved,
  initialAddress,
}: Props) {
  const [address, setAddress] = useState(initialAddress ?? "");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedContract[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const savedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSaved(getSavedContracts());
  }, []);

  useEffect(() => {
    if (!showSaved) return;
    const onDown = (e: MouseEvent) => {
      if (savedRef.current && !savedRef.current.contains(e.target as Node)) {
        setShowSaved(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showSaved]);

  const refreshSaved = () => setSaved(getSavedContracts());

  const handleLoadSaved = (c: SavedContract) => {
    setAddress(c.address);
    setShowSaved(false);
    onLoadSaved(c);
  };

  const handleDelete = (addr: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteContract(addr);
    refreshSaved();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && address && !loading) onLoad(address);
          }}
          placeholder="Contract address (0x…)"
          spellCheck={false}
          className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-sm text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600 sm:flex-1"
        />
        <div className="flex gap-2">
          <button
            onClick={() => onLoad(address)}
            disabled={loading || !address}
            className="flex-1 rounded bg-cyan-700 px-4 py-2 text-sm font-medium text-on-accent hover:bg-cyan-600 disabled:opacity-40 sm:flex-none"
          >
            {loading ? "Loading…" : "Fetch"}
          </button>
          {saved.length > 0 && (
            <div className="relative" ref={savedRef}>
              <button
                onClick={() => setShowSaved(!showSaved)}
                className={`flex items-center gap-1.5 rounded px-3 py-2 text-sm font-medium transition ${
                  showSaved
                    ? "bg-gray-700 text-cyan-400"
                    : "bg-gray-800 text-gray-400 hover:text-gray-200"
                }`}
                title="Saved contracts"
              >
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                <span className="hidden sm:inline">Saved</span>
                <span className="rounded-full bg-gray-900/60 px-1.5 text-xs">{saved.length}</span>
                <svg
                  className={`size-3 transition-transform ${showSaved ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {showSaved && (
                <div className="absolute right-0 z-30 mt-1 max-h-80 w-72 overflow-y-auto rounded-lg border border-border bg-elevated p-1 shadow-lg">
                  {saved.map((c) => (
                    <div
                      key={c.address}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface"
                    >
                      <button
                        onClick={() => handleLoadSaved(c)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate text-xs font-medium text-gray-200">
                          {c.label}
                        </span>
                        <span className="block truncate font-mono text-xs text-gray-500">
                          {c.address}
                        </span>
                      </button>
                      <button
                        onClick={(e) => handleDelete(c.address, e)}
                        title="Delete"
                        aria-label="Delete saved contract"
                        className="shrink-0 rounded px-1.5 py-1 text-gray-600 hover:bg-red-900/40 hover:text-red-400"
                      >
                        <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {abi && (
            <button
              onClick={() => {
                onClear();
                setAddress("");
                setShowPaste(false);
                setPasteValue("");
              }}
              className="rounded bg-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-600"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {proxy && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-violet-500/30 bg-violet-900/20 px-3 py-2 text-xs">
          <span className="rounded bg-violet-900/50 px-1.5 py-0.5 font-bold tracking-wider text-violet-300 uppercase">
            Proxy
          </span>
          <span className="text-gray-400">{proxy.kind} — showing implementation ABI</span>
          <span className="font-mono text-gray-300" title={proxy.implementation}>
            {proxy.implementation.slice(0, 10)}…{proxy.implementation.slice(-8)}
          </span>
          <button
            onClick={() => onLoad(proxy.implementation)}
            className="rounded bg-gray-700 px-2 py-0.5 text-gray-200 hover:bg-gray-600"
            title="Inspect the implementation contract directly"
          >
            Inspect impl
          </button>
          <a
            href={`${EXPLORER_URL}/address/${proxy.implementation}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 hover:text-cyan-400"
            title="View implementation on explorer"
          >
            ↗
          </a>
        </div>
      )}

      {abi && verified && (
        <p className="text-xs text-green-400">Verified contract ABI loaded</p>
      )}

      {error && <p className="text-xs text-amber-400">{error}</p>}

      {abi && (
        <p className="text-xs text-gray-600">
          Tip: save this contract with its ABI from the{" "}
          <span className="text-gray-400">Addresses</span> tab so it&rsquo;s
          labeled and decodable everywhere.
        </p>
      )}

      {((!abi && !loading) || (partial && !verified)) && (
        <div>
          {!error && !partial && (
            <button
              onClick={() => setShowPaste(!showPaste)}
              className="text-xs text-gray-400 underline hover:text-gray-200"
            >
              {showPaste ? "Hide ABI input" : "Paste ABI manually"}
            </button>
          )}

          {(showPaste || error || partial) && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-gray-500">
                {partial
                  ? "Paste the contract ABI JSON to get full type info and return value decoding."
                  : "Paste the contract ABI JSON array."}
              </p>
              <AbiTextarea
                value={pasteValue}
                onChange={(v) => {
                  setPasteValue(v);
                  if (pasteError) setPasteError(null);
                }}
                onError={setPasteError}
                placeholder='[{"type":"function","name":"balanceOf",…}]'
                rows={4}
                className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-300 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
              />
              {pasteError && <p className="text-xs text-amber-400">{pasteError}</p>}
              <button
                onClick={() => onPasteAbi(pasteValue, address)}
                disabled={!pasteValue.trim()}
                className="rounded bg-cyan-700 px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-cyan-600 disabled:opacity-40"
              >
                {partial ? "Override ABI" : "Load ABI"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
