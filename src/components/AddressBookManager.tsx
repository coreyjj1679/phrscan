import { useState, useCallback } from "react";
import type { AddressBook } from "../hooks/useAddressBook";
import { parseAbiJson } from "../lib/abi";

const ADDR_RE = /0x[0-9a-fA-F]{40}/;

function parseBulk(text: string): { label: string; address: string }[] {
  const results: { label: string; address: string }[] = [];
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[=:\t]+/);
    if (parts.length < 2) continue;
    const addrIdx = parts.findIndex((p) => ADDR_RE.test(p.trim()));
    if (addrIdx < 0) continue;
    const address = parts[addrIdx].trim();
    const label = parts
      .filter((_, i) => i !== addrIdx)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" ");
    if (label && ADDR_RE.test(address)) {
      results.push({ label, address });
    }
  }
  return results;
}

type Props = {
  book: AddressBook;
};

export function AddressBookManager({ book }: Props) {
  const [newAddr, setNewAddr] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editAddr, setEditAddr] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [bulkPreview, setBulkPreview] = useState<
    { label: string; address: string }[] | null
  >(null);
  const [abiEditAddr, setAbiEditAddr] = useState<string | null>(null);
  const [abiEditValue, setAbiEditValue] = useState("");
  const [abiEditError, setAbiEditError] = useState<string | null>(null);

  const handleAdd = () => {
    const addr = newAddr.trim();
    const label = newLabel.trim();
    if (!addr || !label) return;
    book.save(addr, label);
    setNewAddr("");
    setNewLabel("");
  };

  const handleEditSave = (
    originalAddress: string,
    isContract: boolean,
  ) => {
    const addr = editAddr.trim();
    const label = editLabel.trim();
    if (!addr || !label) return;
    book.updateEntry(originalAddress, addr, label);
    if (isContract) {
      book.updateContract(originalAddress, addr, label);
    }
    setEditId(null);
  };

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData("text/plain");
      if (!text.includes("\n") && !/[=:\t]/.test(text)) return;
      const parsed = parseBulk(text);
      if (parsed.length < 1) return;
      e.preventDefault();
      setBulkPreview(parsed);
    },
    [],
  );

  const acceptBulk = () => {
    if (!bulkPreview) return;
    for (const entry of bulkPreview) {
      book.save(entry.address, entry.label);
    }
    setBulkPreview(null);
    setNewAddr("");
    setNewLabel("");
  };

  const handleAbiUpdate = (address: string) => {
    try {
      const parsed = parseAbiJson(abiEditValue);
      book.updateContractAbi(address, parsed);
      setAbiEditAddr(null);
      setAbiEditValue("");
      setAbiEditError(null);
    } catch (e) {
      setAbiEditError(e instanceof Error ? e.message : "Invalid ABI JSON");
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-600">
        Label addresses so they display as names throughout the app. Paste
        multiple lines (e.g.{" "}
        <code className="text-gray-500">LABEL=0x…</code>) to bulk-import.
      </p>

      {bulkPreview ? (
        <div className="space-y-2 rounded bg-gray-900/60 p-3 ring-1 ring-cyan-800">
          <p className="text-[11px] font-medium text-cyan-400">
            {bulkPreview.length} address{bulkPreview.length > 1 ? "es" : ""}{" "}
            detected — import?
          </p>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {bulkPreview.map((entry) => (
              <div
                key={entry.address}
                className="flex items-center gap-2 text-xs"
              >
                <span className="rounded bg-cyan-900/30 px-1.5 py-0.5 font-medium text-cyan-300">
                  {entry.label}
                </span>
                <span className="truncate font-mono text-[11px] text-gray-500">
                  {entry.address}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={acceptBulk}
              className="rounded bg-cyan-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-600"
            >
              Import all
            </button>
            <button
              onClick={() => setBulkPreview(null)}
              className="rounded px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={newAddr}
            onChange={(e) => setNewAddr(e.target.value)}
            onPaste={handlePaste}
            placeholder="0x… address (or paste LABEL=0x… lines)"
            spellCheck={false}
            className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600 sm:flex-1"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              placeholder="Label"
              className="flex-1 rounded bg-gray-900 px-3 py-2 text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600 sm:w-36 sm:flex-none"
            />
            <button
              onClick={handleAdd}
              disabled={!newAddr.trim() || !newLabel.trim()}
              className="rounded bg-cyan-700 px-4 py-2 text-xs font-medium text-white hover:bg-cyan-600 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {(() => {
        const addrSet = new Set(
          book.addresses.map((a) => a.address.toLowerCase()),
        );
        const contractOnly = book.contracts.filter(
          (c) => !addrSet.has(c.address.toLowerCase()),
        );
        const hasAbi = new Set(
          book.contracts.map((c) => c.address.toLowerCase()),
        );
        const total = book.addresses.length + contractOnly.length;

        if (total === 0) {
          return (
            <p className="py-6 text-center text-xs text-gray-600">
              No saved addresses yet.
            </p>
          );
        }

        return (
          <div className="space-y-1">
            {book.addresses.map((entry) => {
              const isContract = hasAbi.has(entry.address.toLowerCase());
              const contract = isContract
                ? book.contracts.find(
                    (c) =>
                      c.address.toLowerCase() ===
                      entry.address.toLowerCase(),
                  )
                : undefined;
              return (
                <div
                  key={entry.address}
                  className="space-y-2 rounded bg-gray-900/50 px-3 py-2 ring-1 ring-gray-800"
                >
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    {editId === entry.address ? (
                      <div className="flex w-full flex-col gap-1.5">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            type="text"
                            value={editAddr}
                            onChange={(e) => setEditAddr(e.target.value)}
                            placeholder="0x… address"
                            spellCheck={false}
                            className="flex-1 rounded bg-gray-900 px-2 py-1 font-mono text-[11px] text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
                          />
                          <input
                            type="text"
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                handleEditSave(entry.address, isContract);
                              if (e.key === "Escape") setEditId(null);
                            }}
                            autoFocus
                            placeholder="Label"
                            className="w-full rounded bg-gray-900 px-2 py-1 text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600 sm:w-32"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() =>
                              handleEditSave(entry.address, isContract)
                            }
                            disabled={!editAddr.trim() || !editLabel.trim()}
                            className="rounded bg-cyan-700 px-2 py-1 text-[10px] font-medium text-white hover:bg-cyan-600 disabled:opacity-40"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditId(null)}
                            className="text-[10px] text-gray-500 hover:text-gray-300"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="shrink-0 rounded bg-cyan-900/30 px-1.5 py-0.5 text-xs font-medium text-cyan-300">
                          {entry.label}
                        </span>
                        {isContract && (
                          <span className="shrink-0 rounded bg-violet-900/40 px-1 py-0.5 text-[9px] font-medium text-violet-400">
                            contract
                          </span>
                        )}
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-500"
                          title={entry.address}
                        >
                          {entry.address}
                        </span>
                        <div className="ml-auto flex shrink-0 gap-1">
                          {contract && (
                            <button
                              onClick={() => {
                                setAbiEditAddr(
                                  abiEditAddr === entry.address
                                    ? null
                                    : entry.address,
                                );
                                setAbiEditValue(
                                  JSON.stringify(contract.abi, null, 2),
                                );
                                setAbiEditError(null);
                              }}
                              className={`rounded px-1.5 py-0.5 text-[10px] ${
                                abiEditAddr === entry.address
                                  ? "bg-violet-900/40 text-violet-300"
                                  : "text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                              }`}
                            >
                              abi
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setEditId(entry.address);
                              setEditAddr(entry.address);
                              setEditLabel(entry.label);
                            }}
                            className="rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                          >
                            edit
                          </button>
                          <button
                            onClick={() => book.remove(entry.address)}
                            className="rounded px-1.5 py-0.5 text-[10px] text-red-500 hover:bg-red-900/50 hover:text-red-400"
                          >
                            delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  {abiEditAddr === entry.address &&
                    editId !== entry.address &&
                    contract && (
                      <div className="space-y-2">
                        <textarea
                          value={abiEditValue}
                          onChange={(e) => {
                            setAbiEditValue(e.target.value);
                            setAbiEditError(null);
                          }}
                          placeholder='[{"type":"function","name":"balanceOf",…}]'
                          rows={6}
                          spellCheck={false}
                          className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-[11px] text-gray-300 outline-none ring-1 ring-gray-700 focus:ring-violet-600"
                        />
                        {abiEditError && (
                          <p className="text-[11px] text-amber-400">
                            {abiEditError}
                          </p>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAbiUpdate(entry.address)}
                            disabled={!abiEditValue.trim()}
                            className="rounded bg-violet-700 px-3 py-1.5 text-[10px] font-medium text-white hover:bg-violet-600 disabled:opacity-40"
                          >
                            Update ABI
                          </button>
                          <button
                            onClick={() => {
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
              );
            })}

            {contractOnly.map((c) => (
              <div
                key={c.address}
                className="space-y-2 rounded bg-violet-950/20 px-3 py-2 ring-1 ring-violet-900/40"
              >
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  {editId === c.address ? (
                    <div className="flex w-full flex-col gap-1.5">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          type="text"
                          value={editAddr}
                          onChange={(e) => setEditAddr(e.target.value)}
                          placeholder="0x… address"
                          spellCheck={false}
                          className="flex-1 rounded bg-gray-900 px-2 py-1 font-mono text-[11px] text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-violet-600"
                        />
                        <input
                          type="text"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const addr = editAddr.trim();
                              const label = editLabel.trim();
                              if (addr && label)
                                book.updateContract(c.address, addr, label);
                              setEditId(null);
                            }
                            if (e.key === "Escape") setEditId(null);
                          }}
                          autoFocus
                          placeholder="Label"
                          className="w-full rounded bg-gray-900 px-2 py-1 text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-violet-600 sm:w-32"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            const addr = editAddr.trim();
                            const label = editLabel.trim();
                            if (addr && label)
                              book.updateContract(c.address, addr, label);
                            setEditId(null);
                          }}
                          disabled={!editAddr.trim() || !editLabel.trim()}
                          className="rounded bg-violet-700 px-2 py-1 text-[10px] font-medium text-white hover:bg-violet-600 disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="text-[10px] text-gray-500 hover:text-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="shrink-0 rounded bg-violet-900/40 px-1.5 py-0.5 text-xs font-medium text-violet-300">
                        {c.label}
                      </span>
                      <span className="shrink-0 rounded bg-violet-900/40 px-1 py-0.5 text-[9px] font-medium text-violet-400">
                        contract
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-500"
                        title={c.address}
                      >
                        {c.address}
                      </span>
                      <div className="ml-auto flex shrink-0 gap-1">
                        <button
                          onClick={() => {
                            setAbiEditAddr(
                              abiEditAddr === c.address ? null : c.address,
                            );
                            setAbiEditValue(
                              JSON.stringify(c.abi, null, 2),
                            );
                            setAbiEditError(null);
                          }}
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            abiEditAddr === c.address
                              ? "bg-violet-900/40 text-violet-300"
                              : "text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                          }`}
                        >
                          abi
                        </button>
                        <button
                          onClick={() => {
                            setEditId(c.address);
                            setEditAddr(c.address);
                            setEditLabel(c.label);
                          }}
                          className="rounded px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                        >
                          edit
                        </button>
                        <button
                          onClick={() => book.removeContract(c.address)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-red-500 hover:bg-red-900/50 hover:text-red-400"
                        >
                          delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
                {abiEditAddr === c.address && editId !== c.address && (
                  <div className="space-y-2">
                    <textarea
                      value={abiEditValue}
                      onChange={(e) => {
                        setAbiEditValue(e.target.value);
                        setAbiEditError(null);
                      }}
                      placeholder='[{"type":"function","name":"balanceOf",…}]'
                      rows={6}
                      spellCheck={false}
                      className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-[11px] text-gray-300 outline-none ring-1 ring-gray-700 focus:ring-violet-600"
                    />
                    {abiEditError && (
                      <p className="text-[11px] text-amber-400">
                        {abiEditError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAbiUpdate(c.address)}
                        disabled={!abiEditValue.trim()}
                        className="rounded bg-violet-700 px-3 py-1.5 text-[10px] font-medium text-white hover:bg-violet-600 disabled:opacity-40"
                      >
                        Update ABI
                      </button>
                      <button
                        onClick={() => {
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
        );
      })()}
    </div>
  );
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return addr.slice(0, 6) + "\u2026" + addr.slice(-4);
}
