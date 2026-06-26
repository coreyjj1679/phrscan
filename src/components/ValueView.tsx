import { useState } from "react";
import { EXPLORER_URL } from "../config/chain";
import type { AddressBook } from "../hooks/useAddressBook";
import { AddressLabel } from "./AddressLabel";
import { CopyButton } from "./CopyButton";

type Props = { value: unknown; book?: AddressBook };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_RE = /^0x[0-9a-fA-F]+$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True for values ValueView renders as a multi-line block (struct or array). */
function isComplexValue(v: unknown): boolean {
  return Array.isArray(v) || isPlainObject(v);
}

/** Scalars short enough to comma-join onto a single line. */
function isInlineScalar(v: unknown): boolean {
  if (typeof v === "bigint" || typeof v === "number" || typeof v === "boolean") return true;
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.length <= 18 && !ADDRESS_RE.test(v);
  return false;
}

function scalarText(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return String(v);
  return String(v);
}

function shortenHex(v: string, lead = 10, tail = 8): string {
  return v.length > lead + tail + 1 ? `${v.slice(0, lead)}\u2026${v.slice(-tail)}` : v;
}

/** A 20-byte address: full form, explorer link, and (if a book is given) label. */
function AddressValue({ address, book }: { address: string; book?: AddressBook }) {
  if (book) return <AddressLabel address={address} book={book} full />;
  return (
    <span className="inline-flex items-center gap-1">
      <a
        href={`${EXPLORER_URL}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={address}
        className="font-mono break-all text-cyan-300 hover:underline"
      >
        {address}
      </a>
      <CopyButton text={address} />
    </span>
  );
}

/** A hex blob (bytesN / dynamic bytes): full for hashes, expandable for long data. */
function HexValue({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  const byteLen = (value.length - 2) / 2;

  if (value.length <= 66) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="font-mono break-all text-cyan-300">{value}</span>
        <CopyButton text={value} />
      </span>
    );
  }

  return (
    <div className="rounded bg-gray-950/40 px-2 py-1 ring-1 ring-gray-800/50">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-600">{byteLen} bytes</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="text-xs text-gray-500 transition-colors hover:text-gray-300"
        >
          {open ? "collapse" : "expand"}
        </button>
        <CopyButton text={value} className="ml-auto" />
      </div>
      <pre
        className={`mt-0.5 font-mono text-xs break-all whitespace-pre-wrap text-gray-400 ${
          open ? "max-h-60 overflow-auto" : ""
        }`}
      >
        {open ? value : shortenHex(value, 34, 8)}
      </pre>
    </div>
  );
}

/** A uint/int: shown in full with no digit grouping (values aren't always amounts). */
function BigIntValue({ value }: { value: bigint }) {
  const raw = value.toString();
  return (
    <span className="inline-flex items-center gap-1">
      <span className="tabular-nums break-all text-cyan-300">{raw}</span>
      {raw.length > 15 && <CopyButton text={raw} />}
    </span>
  );
}

/** Render a single leaf (non-object, non-array) value with a type-aware treatment. */
function LeafValue({ value, book }: Props): React.ReactElement {
  if (typeof value === "bigint") return <BigIntValue value={value} />;
  if (typeof value === "boolean") {
    return <span className={value ? "text-emerald-400" : "text-gray-500"}>{String(value)}</span>;
  }
  if (typeof value === "string") {
    if (ADDRESS_RE.test(value)) return <AddressValue address={value} book={book} />;
    if (value.length > 10 && value.length % 2 === 0 && HEX_RE.test(value)) {
      return <HexValue value={value} />;
    }
  }
  return <span className="break-all text-cyan-300">{scalarText(value)}</span>;
}

/**
 * Recursively render a decoded ABI value. Structs (tuples) become labeled
 * key/value blocks and arrays of structs (tuple[]) become a list of indexed
 * blocks, so nested data stays readable instead of a JSON blob. Addresses,
 * byte blobs, and large integers get type-aware, compact treatments.
 *
 * Pass `book` to resolve addresses to saved labels (otherwise they render as a
 * full, copyable explorer link).
 */
export function ValueView({ value, book }: Props): React.ReactElement {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-gray-500">[]</span>;

    if (value.some(isComplexValue)) {
      return (
        <div className="space-y-1.5">
          {value.map((v, i) => (
            <div key={i} className="rounded bg-gray-950/40 px-2 py-1 ring-1 ring-gray-800/50">
              <span className="text-xs text-gray-600">[{i}]</span>
              <div className="mt-0.5">
                <ValueView value={v} book={book} />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (value.every(isInlineScalar)) {
      return (
        <span className="break-all text-cyan-300">
          [{value.map((v) => scalarText(v)).join(", ")}]
        </span>
      );
    }

    return (
      <div className="space-y-0.5">
        {value.map((v, i) => (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 text-gray-600">[{i}]</span>
            <div className="min-w-0">
              <ValueView value={v} book={book} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isPlainObject(value)) {
    return (
      <div className="space-y-0.5">
        {Object.entries(value).map(([k, v]) =>
          isComplexValue(v) ? (
            <div key={k}>
              <span className="text-gray-500">{k}:</span>
              <div className="mt-0.5 border-l border-gray-800/70 pl-2">
                <ValueView value={v} book={book} />
              </div>
            </div>
          ) : (
            <div key={k} className="flex gap-2">
              <span className="shrink-0 text-gray-500">{k}:</span>
              <div className="min-w-0">
                <ValueView value={v} book={book} />
              </div>
            </div>
          ),
        )}
      </div>
    );
  }

  return <LeafValue value={value} book={book} />;
}
