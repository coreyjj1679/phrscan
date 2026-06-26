import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Abi } from "viem";
import { extractAbiFromJsonText } from "../lib/abi";
import { AbiTextarea } from "./AbiTextarea";
import { EXPLORER_URL } from "../config/chain";
import type { AddressBook } from "../hooks/useAddressBook";
import { AddressMenuContext } from "../hooks/useAddressMenu";

type MenuState = { address: string; x: number; y: number };
type FormMode = "address" | "contract";

function short(addr: string): string {
  return addr.length >= 10 ? addr.slice(0, 6) + "…" + addr.slice(-4) : addr;
}

export function AddressMenuProvider({
  book,
  children,
}: {
  book: AddressBook;
  children: React.ReactNode;
}) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [form, setForm] = useState<FormMode | null>(null);
  const [label, setLabel] = useState("");
  const [abiText, setAbiText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const open = useCallback((address: string, x: number, y: number) => {
    setForm(null);
    setError(null);
    setLabel("");
    setAbiText("");
    setMenu({ address, x, y });
  }, []);

  const value = useMemo(() => ({ open }), [open]);

  const close = useCallback(() => {
    setMenu(null);
    setForm(null);
    setError(null);
    setLabel("");
    setAbiText("");
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, close]);

  const address = menu?.address ?? "";
  const lc = address.toLowerCase();
  const contract = book.contracts.find((c) => c.address.toLowerCase() === lc);
  const addrEntry = book.addresses.find((a) => a.address.toLowerCase() === lc);
  const labeled = !!book.resolve(address);

  const startForm = (mode: FormMode) => {
    setLabel(book.resolve(address) ?? "");
    setAbiText(
      mode === "contract" && contract ? JSON.stringify(contract.abi, null, 2) : "",
    );
    setError(null);
    setForm(mode);
  };

  const submit = () => {
    const lbl = label.trim() || short(address);
    if (form === "address") {
      book.save(address, lbl);
      close();
      return;
    }
    let abi: Abi;
    try {
      abi = abiText.trim() ? extractAbiFromJsonText(abiText) : [];
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid ABI JSON");
      return;
    }
    book.addContract(address, lbl, abi);
    close();
  };

  // Position: clamp to viewport.
  const PANEL_W = 248;
  const estH = form === "contract" ? 320 : form === "address" ? 150 : 200;
  const left = menu ? Math.max(8, Math.min(menu.x, window.innerWidth - PANEL_W - 8)) : 0;
  const top = menu ? Math.max(8, Math.min(menu.y, window.innerHeight - estH - 8)) : 0;

  return (
    <AddressMenuContext.Provider value={value}>
      {children}
      {menu && (
        <div
          ref={panelRef}
          style={{ position: "fixed", left, top, width: PANEL_W, zIndex: 60 }}
          className="rounded-md border border-border bg-elevated p-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="truncate px-2 py-1 font-mono text-xs text-gray-500" title={address}>
            {short(address)}
          </div>

          {!form ? (
            <div className="flex flex-col">
              {!labeled && (
                <>
                  <MenuItem onClick={() => startForm("address")}>Save as address</MenuItem>
                  <MenuItem onClick={() => startForm("contract")}>Save as contract</MenuItem>
                </>
              )}
              {contract && (
                <>
                  <MenuItem onClick={() => startForm("contract")}>Edit contract (label + ABI)</MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      book.removeContract(address);
                      close();
                    }}
                  >
                    Remove contract
                  </MenuItem>
                </>
              )}
              {addrEntry && (
                <>
                  <MenuItem onClick={() => startForm("address")}>Edit label</MenuItem>
                  {!contract && (
                    <MenuItem onClick={() => startForm("contract")}>Convert to contract</MenuItem>
                  )}
                  <MenuItem
                    danger
                    onClick={() => {
                      book.remove(address);
                      close();
                    }}
                  >
                    Remove label
                  </MenuItem>
                </>
              )}
              <div className="my-1 border-t border-border" />
              <MenuItem
                onClick={() => {
                  navigator.clipboard.writeText(address);
                  close();
                }}
              >
                Copy address
              </MenuItem>
              <MenuItem
                onClick={() => {
                  window.open(`${EXPLORER_URL}/address/${address}`, "_blank", "noopener,noreferrer");
                  close();
                }}
              >
                Open in explorer
              </MenuItem>
            </div>
          ) : (
            <div className="space-y-2 p-1.5">
              <input
                type="text"
                value={label}
                autoFocus
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && form === "address") submit();
                }}
                placeholder="Label"
                className="w-full rounded bg-gray-900 px-2 py-1.5 text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
              />
              {form === "contract" && (
                <AbiTextarea
                  value={abiText}
                  onChange={(v) => {
                    setAbiText(v);
                    if (error) setError(null);
                  }}
                  onError={setError}
                  placeholder='ABI JSON (optional) — [{"type":"function",…}]'
                  rows={6}
                  className="w-full rounded bg-gray-900 px-2 py-1.5 font-mono text-xs text-gray-300 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
                />
              )}
              {error && <p className="text-xs text-amber-400">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={submit}
                  className="flex-1 rounded bg-cyan-700 px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-cyan-600"
                >
                  Save
                </button>
                <button
                  onClick={close}
                  className="rounded bg-gray-700 px-2 py-1.5 text-xs text-gray-300 hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </AddressMenuContext.Provider>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface ${
        danger ? "text-red-400" : "text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
