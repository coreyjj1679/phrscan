import { useState, useRef, useEffect } from "react";
import type { AddressBook } from "../hooks/useAddressBook";
import { EXPLORER_URL } from "../config/chain";
import { useAddressMenu } from "../hooks/useAddressMenu";

type Props = {
  address: string;
  book: AddressBook;
  className?: string;
  /** Render the full address instead of the truncated 0x1234…abcd form. */
  full?: boolean;
};

export function AddressLabel({ address, book, className = "", full = false }: Props) {
  const { open } = useAddressMenu();
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
      inputRef.current?.focus();
    }
  }, [showSave]);

  const handleSave = () => {
    const trimmed = input.trim();
    if (trimmed) {
      book.save(address, trimmed);
    }
    setShowSave(false);
  };

  const short = !full && address.length >= 10
    ? address.slice(0, 6) + "…" + address.slice(-4)
    : address;

  return (
    <span className={`relative inline-flex items-center gap-1 ${className}`}>
      <span
        className={`cursor-pointer font-mono text-xs ${
          label
            ? "rounded bg-cyan-900/30 px-1 py-0.5 text-cyan-300"
            : "text-gray-500"
        }`}
        title={address}
        onClick={(e) => {
          e.stopPropagation();
          setInput(label ?? "");
          setShowSave(true);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          open(address, e.clientX, e.clientY);
        }}
      >
        {label ?? short}
      </span>
      <a
        href={`${EXPLORER_URL}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-gray-600 transition-colors hover:text-cyan-400"
        title="View on PharosScan"
      >
        <svg className="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-3M10 2h4m0 0v4m0-4L7 9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>

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
            className="rounded bg-cyan-700 px-2 py-1 text-xs font-medium text-on-accent hover:bg-cyan-600"
          >
            Save
          </button>
          {label && (
            <button
              onClick={() => {
                book.remove(address);
                setShowSave(false);
              }}
              aria-label="Remove label"
              className="rounded px-1.5 py-1 text-red-400 hover:bg-red-900/50"
            >
              <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>
      )}
    </span>
  );
}
