import { useEffect, useRef, useState } from "react";
import type { AddressBook } from "../hooks/useAddressBook";
import { AddressLabel } from "./AddressLabel";
import { CopyButton } from "./CopyButton";
import {
  getReplayHistory,
  setReplayHistoryTag,
  deleteReplayHistory,
  clearReplayHistory,
  type ReplayHistoryEntry,
} from "../lib/storage";

function timeAgo(ms: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

type Props = {
  book: AddressBook;
  /** Bump to force a re-read after a new transaction is recorded. */
  version: number;
  onOpen: (hash: string) => void;
  /** Notified after any in-panel mutation so the parent can refresh counts. */
  onChange?: () => void;
};

export function ReplayHistory({ book, version, onOpen, onChange }: Props) {
  const [items, setItems] = useState<ReplayHistoryEntry[]>(getReplayHistory);

  useEffect(() => {
    setItems(getReplayHistory());
  }, [version]);

  const refresh = () => {
    setItems(getReplayHistory());
    onChange?.();
  };

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-3 py-6 text-center text-xs text-gray-500">
        No replays yet. Load a transaction above and it will appear here.
      </div>
    );
  }

  const handleTag = (hash: string, tag: string) => {
    setReplayHistoryTag(hash, tag);
    refresh();
  };

  const handleDelete = (hash: string) => {
    deleteReplayHistory(hash);
    refresh();
  };

  const handleClear = () => {
    clearReplayHistory();
    refresh();
  };

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <h3 className="text-sm font-semibold text-gray-100">Replay history</h3>
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
          {items.length}
        </span>
        <button
          onClick={handleClear}
          className="ml-auto rounded px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-elevated hover:text-gray-300"
        >
          Clear
        </button>
      </div>

      <div className="overflow-x-auto border-t border-border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-gray-600">
              <Th>Name</Th>
              <Th>Block</Th>
              <Th>Tx Hash</Th>
              <Th>From</Th>
              <Th>To</Th>
              <Th>Status</Th>
              <Th>Time</Th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {items.map((entry) => (
              <tr
                key={entry.hash}
                onClick={() => onOpen(entry.hash)}
                className="cursor-pointer border-b border-border/50 align-middle transition-colors last:border-0 hover:bg-elevated"
                title="Open in replay"
              >
                <td className="px-3 py-2 whitespace-nowrap">
                  <TagCell entry={entry} onSave={(tag) => handleTag(entry.hash, tag)} />
                </td>
                <td className="px-3 py-2 font-mono whitespace-nowrap text-gray-400">
                  {entry.blockNumber || "—"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-mono text-cyan-400">
                      {entry.hash.slice(0, 10)}…{entry.hash.slice(-8)}
                    </span>
                    <CopyButton text={entry.hash} />
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <AddressLabel address={entry.from} book={book} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <AddressLabel address={entry.to} book={book} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
                      entry.status === "success"
                        ? "bg-green-900/50 text-green-400"
                        : "bg-red-900/50 text-red-400"
                    }`}
                  >
                    {entry.status}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                  {timeAgo(entry.viewedAt)}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(entry.hash);
                    }}
                    aria-label="Remove from history"
                    className="rounded p-1 text-gray-600 transition-colors hover:bg-red-900/40 hover:text-red-400"
                  >
                    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TagCell({
  entry,
  onSave,
}: {
  entry: ReplayHistoryEntry;
  onSave: (tag: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(entry.tag ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    onSave(val);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setVal(entry.tag ?? "");
            setEditing(false);
          }
        }}
        onBlur={commit}
        placeholder="Name…"
        className="w-32 rounded bg-gray-900 px-2 py-1 text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
      />
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setVal(entry.tag ?? "");
        setEditing(true);
      }}
      title={entry.tag ? "Rename" : "Add a name"}
      className={
        entry.tag
          ? "inline-block max-w-40 truncate rounded bg-cyan-900/30 px-1.5 py-0.5 align-middle text-cyan-300"
          : "text-gray-600 hover:text-gray-400"
      }
    >
      {entry.tag ?? "+ name"}
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 font-medium tracking-wider whitespace-nowrap uppercase">
      {children}
    </th>
  );
}
