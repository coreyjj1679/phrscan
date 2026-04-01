import { useState, useRef, useEffect, useMemo } from "react";
import type { AddressBook } from "../hooks/useAddressBook";

type Props = {
  value: string;
  onChange: (value: string) => void;
  book: AddressBook;
  enabled: boolean;
  placeholder?: string;
  className?: string;
};

export function AddressSuggestInput({
  value,
  onChange,
  book,
  enabled,
  placeholder = "0x…",
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => {
    if (!enabled) return [];
    const seen = new Set<string>();
    const result: { address: string; label: string; isContract: boolean }[] = [];
    for (const a of book.addresses) {
      const key = a.address.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        const contractSet = new Set(book.contracts.map((c) => c.address.toLowerCase()));
        result.push({ address: a.address, label: a.label, isContract: contractSet.has(key) });
      }
    }
    for (const c of book.contracts) {
      const key = c.address.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ address: c.address, label: c.label, isContract: true });
      }
    }
    return result;
  }, [enabled, book.addresses, book.contracts, book.version]);

  const query = value.toLowerCase();
  const filtered = entries.filter(
    (e) =>
      e.label.toLowerCase().includes(query) ||
      e.address.toLowerCase().includes(query),
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!enabled) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={className}
      />
    );
  }

  const showDropdown = open && filtered.length > 0;

  return (
    <div ref={wrapperRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        spellCheck={false}
        className={className}
      />
      {showDropdown && (
        <div className="absolute top-full left-0 z-20 mt-1 max-h-44 w-full overflow-y-auto rounded bg-gray-800 py-1 shadow-lg ring-1 ring-gray-700">
          {filtered.map((entry) => (
            <button
              key={entry.address}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(entry.address);
                setOpen(false);
                inputRef.current?.focus();
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-gray-700/60"
            >
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  entry.isContract
                    ? "bg-violet-900/40 text-violet-300"
                    : "bg-cyan-900/30 text-cyan-300"
                }`}
              >
                {entry.label}
              </span>
              <span className="truncate font-mono text-[10px] text-gray-500">
                {entry.address}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
