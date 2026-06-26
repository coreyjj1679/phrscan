import { useState, useRef } from "react";
import type { AddressBook } from "../hooks/useAddressBook";
import type { SavedAddress, SavedContract } from "../lib/storage";
import { extractAbiFromJsonText } from "../lib/abi";
import { AbiTextarea } from "./AbiTextarea";
import { HighlightAddress } from "./HighlightAddress";
import { Modal } from "./Modal";

const ADDR_EXACT = /^0x[0-9a-fA-F]{40}$/;

function short(addr: string): string {
  return addr.length >= 10 ? addr.slice(0, 6) + "…" + addr.slice(-4) : addr;
}

type Tab = "addresses" | "contracts";

export function AddressBookManager({ book }: { book: AddressBook }) {
  const [tab, setTab] = useState<Tab>("addresses");
  const [modal, setModal] = useState<Tab | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-gray-900 p-1 ring-1 ring-gray-800">
          <TabButton active={tab === "addresses"} onClick={() => setTab("addresses")}>
            Addresses
            <Count n={book.addresses.length} active={tab === "addresses"} />
          </TabButton>
          <TabButton active={tab === "contracts"} onClick={() => setTab("contracts")}>
            Contracts
            <Count n={book.contracts.length} active={tab === "contracts"} />
          </TabButton>
        </div>
        <button
          onClick={() => setModal(tab)}
          className="ml-auto rounded bg-cyan-700 px-3 py-2 text-xs font-medium text-on-accent hover:bg-cyan-600"
        >
          + Add {tab === "contracts" ? "contract" : "address"}
        </button>
      </div>

      {tab === "addresses" ? (
        book.addresses.length === 0 ? (
          <Empty>No saved addresses yet.</Empty>
        ) : (
          <div className="space-y-1">
            {book.addresses.map((entry) => (
              <AddressRow key={entry.address} book={book} entry={entry} />
            ))}
          </div>
        )
      ) : book.contracts.length === 0 ? (
        <Empty>No saved contracts yet.</Empty>
      ) : (
        <div className="space-y-1">
          {book.contracts.map((c) => (
            <ContractRow key={c.address} book={book} contract={c} />
          ))}
        </div>
      )}

      {modal === "addresses" && (
        <Modal title="Add addresses" size="xl" onClose={() => setModal(null)}>
          <AddAddressForm book={book} onClose={() => setModal(null)} />
        </Modal>
      )}
      {modal === "contracts" && (
        <Modal title="Add contracts" size="2xl" onClose={() => setModal(null)}>
          <AddContractForm book={book} onClose={() => setModal(null)} />
        </Modal>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
        active ? "bg-elevated text-cyan-400" : "text-gray-500 hover:text-gray-300"
      }`}
    >
      {children}
    </button>
  );
}

function Count({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-xs ${
        active ? "bg-cyan-900/40 text-cyan-400" : "bg-gray-800 text-gray-500"
      }`}
    >
      {n}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-xs text-gray-600">{children}</p>;
}

function IconButton({
  onClick,
  title,
  danger,
  children,
}: {
  onClick: () => void;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded px-1.5 py-0.5 text-xs transition-colors ${
        danger
          ? "text-red-500 hover:bg-red-900/50 hover:text-red-400"
          : "text-gray-500 hover:bg-gray-800 hover:text-gray-300"
      }`}
    >
      {children}
    </button>
  );
}

/* ─── Add forms (rendered inside a modal) ─────────────────────── */

type AddrDraft = { label: string; address: string };
const emptyAddr = (): AddrDraft => ({ label: "", address: "" });

function AddAddressForm({ book, onClose }: { book: AddressBook; onClose: () => void }) {
  const [rows, setRows] = useState<AddrDraft[]>([emptyAddr()]);

  const setRow = (i: number, patch: Partial<AddrDraft>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, emptyAddr()]);
  const removeRow = (i: number) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));

  const validCount = rows.filter((r) => ADDR_EXACT.test(r.address.trim())).length;

  const addAll = () => {
    let added = 0;
    for (const r of rows) {
      const a = r.address.trim();
      if (!ADDR_EXACT.test(a)) continue;
      book.save(a, r.label.trim() || short(a));
      added++;
    }
    if (added > 0) onClose();
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1 text-xs font-medium tracking-wider text-gray-600 uppercase">
          <span className="w-40 shrink-0">Label</span>
          <span className="min-w-0 flex-1">Address</span>
          <span className="w-5 shrink-0" />
        </div>
        {rows.map((r, i) => {
          const invalid = !!r.address.trim() && !ADDR_EXACT.test(r.address.trim());
          return (
            <div key={i} className="flex items-center gap-2">
              <input
                value={r.label}
                onChange={(e) => setRow(i, { label: e.target.value })}
                placeholder="Label"
                className="w-40 shrink-0 rounded bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
              />
              <input
                value={r.address}
                onChange={(e) => setRow(i, { address: e.target.value })}
                placeholder="0x…"
                spellCheck={false}
                className={`min-w-0 flex-1 rounded bg-gray-900 px-2 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 focus:ring-cyan-600 ${
                  invalid ? "ring-red-700" : "ring-gray-700"
                }`}
              />
              <button
                onClick={() => removeRow(i)}
                disabled={rows.length === 1}
                aria-label="Remove row"
                className="w-5 shrink-0 text-xs text-gray-600 hover:text-red-400 disabled:opacity-30"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <button
          onClick={addRow}
          className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700"
        >
          + Add row
        </button>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200">
            Cancel
          </button>
          <button
            onClick={addAll}
            disabled={validCount === 0}
            className="rounded bg-cyan-700 px-4 py-1.5 text-xs font-medium text-on-accent hover:bg-cyan-600 disabled:opacity-40"
          >
            Add {validCount > 0 ? validCount : ""} address{validCount === 1 ? "" : "es"}
          </button>
        </div>
      </div>
    </div>
  );
}

type ContractDraft = {
  label: string;
  address: string;
  abiText: string;
  abiCount: number | null;
  abiError: string | null;
};

const emptyDraft = (): ContractDraft => ({
  label: "",
  address: "",
  abiText: "",
  abiCount: null,
  abiError: null,
});

function AddContractForm({ book, onClose }: { book: AddressBook; onClose: () => void }) {
  const [rows, setRows] = useState<ContractDraft[]>([emptyDraft()]);

  const setRow = (i: number, patch: Partial<ContractDraft>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, emptyDraft()]);
  const removeRow = (i: number) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));

  const loadFile = async (i: number, file: File | undefined) => {
    if (!file) return;
    try {
      const abi = extractAbiFromJsonText(await file.text());
      setRow(i, { abiText: JSON.stringify(abi), abiCount: abi.length, abiError: null });
    } catch (e) {
      setRow(i, {
        abiText: "",
        abiCount: null,
        abiError: e instanceof Error ? e.message : "Invalid ABI file",
      });
    }
  };

  const validCount = rows.filter((r) => ADDR_EXACT.test(r.address.trim())).length;

  const addAll = () => {
    let added = 0;
    for (const r of rows) {
      const a = r.address.trim();
      if (!ADDR_EXACT.test(a)) continue;
      let abi: ReturnType<typeof extractAbiFromJsonText> = [];
      try {
        abi = r.abiText ? extractAbiFromJsonText(r.abiText) : [];
      } catch {
        abi = [];
      }
      book.addContract(a, r.label.trim() || short(a), abi);
      added++;
    }
    if (added > 0) onClose();
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">
        Add several contracts at once. Drop a <span className="font-mono">.json</span> ABI / build
        artifact on each row (optional) — only a summary is shown, not the full ABI.
      </p>
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1 text-xs font-medium tracking-wider text-gray-600 uppercase">
          <span className="w-28 shrink-0">Label</span>
          <span className="min-w-0 flex-1">Address</span>
          <span className="w-24 shrink-0">ABI</span>
          <span className="w-5 shrink-0" />
        </div>
        {rows.map((r, i) => {
          const invalid = !!r.address.trim() && !ADDR_EXACT.test(r.address.trim());
          return (
            <div key={i} className="flex items-center gap-2">
              <input
                value={r.label}
                onChange={(e) => setRow(i, { label: e.target.value })}
                placeholder="Label"
                className="w-28 shrink-0 rounded bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
              />
              <input
                value={r.address}
                onChange={(e) => setRow(i, { address: e.target.value })}
                placeholder="0x…"
                spellCheck={false}
                className={`min-w-0 flex-1 rounded bg-gray-900 px-2 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 focus:ring-cyan-600 ${
                  invalid ? "ring-red-700" : "ring-gray-700"
                }`}
              />
              <AbiDropCell
                count={r.abiCount}
                error={r.abiError}
                onFile={(f) => loadFile(i, f)}
                onClear={() => setRow(i, { abiText: "", abiCount: null, abiError: null })}
              />
              <button
                onClick={() => removeRow(i)}
                disabled={rows.length === 1}
                aria-label="Remove row"
                className="w-5 shrink-0 text-xs text-gray-600 hover:text-red-400 disabled:opacity-30"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <button
          onClick={addRow}
          className="rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700"
        >
          + Add row
        </button>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200">
            Cancel
          </button>
          <button
            onClick={addAll}
            disabled={validCount === 0}
            className="rounded bg-cyan-700 px-4 py-1.5 text-xs font-medium text-on-accent hover:bg-cyan-600 disabled:opacity-40"
          >
            Add {validCount > 0 ? validCount : ""} contract{validCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AbiDropCell({
  count,
  error,
  onFile,
  onClear,
}: {
  count: number | null;
  error: string | null;
  onFile: (file: File | undefined) => void;
  onClear: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (count != null) {
    return (
      <div className="flex w-24 shrink-0 items-center justify-between gap-1 rounded bg-green-900/30 px-2 py-1.5 text-xs text-green-300 ring-1 ring-green-800">
        <span className="truncate" title={`${count} ABI items`}>
          ✓ {count}
        </span>
        <button
          onClick={onClear}
          aria-label="Clear ABI"
          className="shrink-0 text-green-500 hover:text-green-300"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFile(e.dataTransfer.files?.[0]);
        }}
        title={error ?? "Drop or click to add an ABI .json"}
        className={`w-24 shrink-0 truncate rounded border border-dashed px-2 py-1.5 text-xs transition-colors ${
          error
            ? "border-red-700 text-red-400"
            : dragging
              ? "border-cyan-500 bg-cyan-900/30 text-cyan-200"
              : "border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-300"
        }`}
      >
        {error ? "ABI error" : dragging ? "Drop…" : "Drop ABI"}
      </button>
    </>
  );
}

/* ─── List rows ───────────────────────────────────────────────── */

function EditFields({
  addr,
  label,
  setAddr,
  setLabel,
  onSave,
  onCancel,
}: {
  addr: string;
  label: string;
  setAddr: (v: string) => void;
  setLabel: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="0x… address"
          spellCheck={false}
          className="flex-1 rounded bg-gray-900 px-2 py-1 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
        />
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave();
            if (e.key === "Escape") onCancel();
          }}
          autoFocus
          placeholder="Label"
          className="w-full rounded bg-gray-900 px-2 py-1 text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600 sm:w-32"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={!addr.trim() || !label.trim()}
          className="rounded bg-cyan-700 px-2 py-1 text-xs font-medium text-on-accent hover:bg-cyan-600 disabled:opacity-40"
        >
          Save
        </button>
        <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-300">
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddressRow({ book, entry }: { book: AddressBook; entry: SavedAddress }) {
  const [editing, setEditing] = useState(false);
  const [addr, setAddr] = useState(entry.address);
  const [label, setLabel] = useState(entry.label);
  const isContract = book.contracts.some(
    (c) => c.address.toLowerCase() === entry.address.toLowerCase(),
  );

  const save = () => {
    if (!addr.trim() || !label.trim()) return;
    book.updateEntry(entry.address, addr.trim(), label.trim());
    setEditing(false);
  };

  return (
    <div className="rounded bg-gray-900/50 px-3 py-2 ring-1 ring-gray-800">
      {editing ? (
        <EditFields
          addr={addr}
          label={label}
          setAddr={setAddr}
          setLabel={setLabel}
          onSave={save}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 rounded bg-cyan-900/30 px-1.5 py-0.5 text-xs font-medium text-cyan-300">
              {entry.label}
            </span>
            {isContract && (
              <span className="shrink-0 rounded bg-violet-900/40 px-1 py-0.5 text-xs font-medium text-violet-400">
                contract
              </span>
            )}
            <div className="ml-auto flex shrink-0 gap-1">
              <IconButton
                title="Edit"
                onClick={() => {
                  setAddr(entry.address);
                  setLabel(entry.label);
                  setEditing(true);
                }}
              >
                edit
              </IconButton>
              <IconButton title="Delete" danger onClick={() => book.remove(entry.address)}>
                delete
              </IconButton>
            </div>
          </div>
          <HighlightAddress address={entry.address} className="block text-[13px] break-all" />
        </div>
      )}
    </div>
  );
}

function ContractRow({ book, contract }: { book: AddressBook; contract: SavedContract }) {
  const [editing, setEditing] = useState(false);
  const [addr, setAddr] = useState(contract.address);
  const [label, setLabel] = useState(contract.label);
  const [abiOpen, setAbiOpen] = useState(false);
  const [abiText, setAbiText] = useState("");
  const [abiError, setAbiError] = useState<string | null>(null);

  const save = () => {
    if (!addr.trim() || !label.trim()) return;
    book.updateContract(contract.address, addr.trim(), label.trim());
    setEditing(false);
  };

  const saveAbi = () => {
    try {
      book.updateContractAbi(contract.address, extractAbiFromJsonText(abiText));
      setAbiOpen(false);
      setAbiError(null);
    } catch (e) {
      setAbiError(e instanceof Error ? e.message : "Invalid ABI JSON");
    }
  };

  return (
    <div className="space-y-2 rounded bg-violet-950/20 px-3 py-2 ring-1 ring-violet-900/40">
      {editing ? (
        <EditFields
          addr={addr}
          label={label}
          setAddr={setAddr}
          setLabel={setLabel}
          onSave={save}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 rounded bg-violet-900/40 px-1.5 py-0.5 text-xs font-medium text-violet-300">
              {contract.label}
            </span>
            <span className="shrink-0 rounded bg-violet-900/40 px-1 py-0.5 text-xs font-medium text-violet-400">
              {contract.abi.length} ABI items
            </span>
            <div className="ml-auto flex shrink-0 gap-1">
              <IconButton
                title="Edit ABI"
                onClick={() => {
                  setAbiOpen((v) => !v);
                  setAbiText(JSON.stringify(contract.abi, null, 2));
                  setAbiError(null);
                }}
              >
                abi
              </IconButton>
              <IconButton
                title="Edit"
                onClick={() => {
                  setAddr(contract.address);
                  setLabel(contract.label);
                  setEditing(true);
                }}
              >
                edit
              </IconButton>
              <IconButton title="Delete" danger onClick={() => book.removeContract(contract.address)}>
                delete
              </IconButton>
            </div>
          </div>
          <HighlightAddress address={contract.address} tone="violet" className="block text-[13px] break-all" />
        </div>
      )}

      {abiOpen && !editing && (
        <div className="space-y-2">
          <AbiTextarea
            value={abiText}
            onChange={(v) => {
              setAbiText(v);
              setAbiError(null);
            }}
            onError={setAbiError}
            placeholder='[{"type":"function","name":"balanceOf",…}]'
            rows={6}
            className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-300 outline-none ring-1 ring-gray-700 focus:ring-violet-600"
          />
          {abiError && <p className="text-xs text-amber-400">{abiError}</p>}
          <div className="flex gap-2">
            <button
              onClick={saveAbi}
              disabled={!abiText.trim()}
              className="rounded bg-violet-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-40"
            >
              Update ABI
            </button>
            <button onClick={() => setAbiOpen(false)} className="text-xs text-gray-500 hover:text-gray-300">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
