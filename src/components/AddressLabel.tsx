import { useState, useRef, useEffect } from "react";
import type { AddressBook } from "../hooks/useAddressBook";

type Props = {
  address: string;
  book: AddressBook;
  className?: string;
};

export function AddressLabel({ address, book, className = "" }: Props) {
  const label = book.resolve(address);
  const [showSave, setShowSave] = useState(false);
  const [input, setInput] = useState(label ?? "");
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showSave) return;
    const handler = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setShowSave(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSave]);

  useEffect(() => {
    if (showSave) {
      setInput(label ?? "");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [showSave, label]);

  const handleSave = () => {
    const trimmed = input.trim();
    if (trimmed) {
      book.save(address, trimmed);
    }
    setShowSave(false);
  };

  const short = address.length >= 10
    ? address.slice(0, 6) + "…" + address.slice(-4)
    : address;

  return (
    <span className={`relative inline-flex items-center gap-1 ${className}`}>
      <span
        className={`cursor-pointer font-mono text-[11px] ${
          label
            ? "rounded bg-cyan-900/30 px-1 py-0.5 text-cyan-300"
            : "text-gray-500"
        }`}
        title={address}
        onClick={(e) => {
          e.stopPropagation();
          setShowSave(true);
        }}
      >
        {label ?? short}
      </span>

      {showSave && (
        <div
          ref={popRef}
          className="absolute top-full left-0 z-50 mt-1 flex items-center gap-1 rounded bg-gray-800 p-2 shadow-lg ring-1 ring-gray-700"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") setShowSave(false);
            }}
            placeholder="Label…"
            className="w-28 rounded bg-gray-900 px-2 py-1 text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
          <button
            onClick={handleSave}
            className="rounded bg-cyan-700 px-2 py-1 text-[10px] font-medium text-white hover:bg-cyan-600"
          >
            Save
          </button>
          {label && (
            <button
              onClick={() => {
                book.remove(address);
                setShowSave(false);
              }}
              className="rounded px-1.5 py-1 text-[10px] text-red-400 hover:bg-red-900/50"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </span>
  );
}
