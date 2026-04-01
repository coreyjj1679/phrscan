import { useState, useEffect } from "react";
import type { Abi } from "viem";
import {
  getSavedContracts,
  saveContract,
  deleteContract,
  updateContractAbi,
  type SavedContract,
} from "../lib/storage";
import { parseAbiJson } from "../lib/abi";

type Props = {
  loading: boolean;
  verified: boolean;
  partial: boolean;
  abi: Abi | null;
  error: string | null;
  onLoad: (address: string) => void;
  onPasteAbi: (raw: string, address: string) => void;
  onClear: () => void;
  onLoadSaved: (saved: SavedContract) => void;
};

export function ContractInput({
  loading,
  verified,
  partial,
  abi,
  error,
  onLoad,
  onPasteAbi,
  onClear,
  onLoadSaved,
}: Props) {
  const [address, setAddress] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [saved, setSaved] = useState<SavedContract[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [abiEditAddr, setAbiEditAddr] = useState<string | null>(null);
  const [abiEditValue, setAbiEditValue] = useState("");
  const [abiEditError, setAbiEditError] = useState<string | null>(null);

  useEffect(() => {
    setSaved(getSavedContracts());
  }, []);

  const refreshSaved = () => setSaved(getSavedContracts());

  const handleSave = () => {
    if (!abi || !address) return;
    const label = saveLabel.trim() || address.slice(0, 10) + "…";
    saveContract({ address, label, abi, savedAt: Date.now() });
    refreshSaved();
    setShowSaveForm(false);
    setSaveLabel("");
  };

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

  const handleAbiUpdate = (addr: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const parsed = parseAbiJson(abiEditValue);
      updateContractAbi(addr, parsed);
      refreshSaved();
      setAbiEditAddr(null);
      setAbiEditValue("");
      setAbiEditError(null);
    } catch (err) {
      setAbiEditError(
        err instanceof Error ? err.message : "Invalid ABI JSON",
      );
    }
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
            className="flex-1 rounded bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-40 sm:flex-none"
          >
            {loading ? "Loading…" : "Fetch"}
          </button>
          {saved.length > 0 && (
            <button
              onClick={() => setShowSaved(!showSaved)}
              className={`rounded px-3 py-2 text-sm font-medium transition ${
                showSaved
                  ? "bg-gray-700 text-cyan-400"
                  : "bg-gray-800 text-gray-400 hover:text-gray-200"
              }`}
              title="Saved contracts"
            >
              ★ {saved.length}
            </button>
          )}
          {abi && (
            <button
              onClick={() => {
                onClear();
                setAddress("");
                setShowPaste(false);
                setPasteValue("");
                setShowSaveForm(false);
              }}
              className="rounded bg-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-600"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {showSaved && saved.length > 0 && (
        <div className="rounded bg-gray-900 ring-1 ring-gray-700">
          {saved.map((c) => (
            <div
              key={c.address}
              className="border-b border-gray-800 last:border-0"
            >
              <div
                onClick={() => handleLoadSaved(c)}
                className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 hover:bg-gray-800/60"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-200">
                    {c.label}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-gray-500">
                    {c.address}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setAbiEditAddr(
                        abiEditAddr === c.address ? null : c.address,
                      );
                      setAbiEditValue(JSON.stringify(c.abi, null, 2));
                      setAbiEditError(null);
                    }}
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      abiEditAddr === c.address
                        ? "bg-violet-900/40 text-violet-300"
                        : "text-gray-600 hover:bg-gray-800 hover:text-gray-300"
                    }`}
                    title="Update ABI"
                  >
                    abi
                  </button>
                  <button
                    onClick={(e) => handleDelete(c.address, e)}
                    className="rounded px-1.5 py-0.5 text-xs text-gray-600 hover:bg-red-900/40 hover:text-red-400"
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {abiEditAddr === c.address && (
                <div
                  className="space-y-2 px-3 pb-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <textarea
                    value={abiEditValue}
                    onChange={(e) => {
                      setAbiEditValue(e.target.value);
                      setAbiEditError(null);
                    }}
                    placeholder='[{"type":"function","name":"balanceOf",…}]'
                    rows={5}
                    spellCheck={false}
                    className="w-full rounded bg-gray-800 px-3 py-2 font-mono text-[11px] text-gray-300 outline-none ring-1 ring-gray-700 focus:ring-violet-600"
                  />
                  {abiEditError && (
                    <p className="text-[11px] text-amber-400">
                      {abiEditError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => handleAbiUpdate(c.address, e)}
                      disabled={!abiEditValue.trim()}
                      className="rounded bg-violet-700 px-3 py-1.5 text-[10px] font-medium text-white hover:bg-violet-600 disabled:opacity-40"
                    >
                      Update ABI
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAbiEditAddr(null);
                        setAbiEditValue("");
                        setAbiEditError(null);
                      }}
                      className="text-[10px] text-gray-500 hover:text-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {abi && verified && (
        <p className="text-xs text-green-400">Verified contract ABI loaded</p>
      )}

      {error && <p className="text-xs text-amber-400">{error}</p>}

      {abi && !showSaveForm && (
        <button
          onClick={() => setShowSaveForm(true)}
          className="text-xs text-gray-500 underline hover:text-gray-300"
        >
          Save contract
        </button>
      )}

      {abi && showSaveForm && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={saveLabel}
            onChange={(e) => setSaveLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            placeholder="Label (optional)"
            className="flex-1 rounded bg-gray-900 px-3 py-1.5 text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex-1 rounded bg-cyan-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-600 sm:flex-none"
            >
              Save
            </button>
            <button
              onClick={() => setShowSaveForm(false)}
              className="rounded bg-gray-700 px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
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
              <p className="text-[11px] text-gray-500">
                {partial
                  ? "Paste the contract ABI JSON to get full type info and return value decoding."
                  : "Paste the contract ABI JSON array."}
              </p>
              <textarea
                value={pasteValue}
                onChange={(e) => setPasteValue(e.target.value)}
                placeholder='[{"type":"function","name":"balanceOf",…}]'
                rows={4}
                spellCheck={false}
                className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-300 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
              />
              <button
                onClick={() => onPasteAbi(pasteValue, address)}
                disabled={!pasteValue.trim()}
                className="rounded bg-cyan-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-600 disabled:opacity-40"
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
