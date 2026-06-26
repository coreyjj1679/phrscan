import { useState } from "react";
import { extractAbiFromJsonText } from "../lib/abi";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Called with a message when a dropped file can't be parsed, or null on success. */
  onError?: (message: string | null) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
};

/**
 * A textarea for ABI JSON that also accepts a dragged-and-dropped `.json` file
 * (raw ABI array or a Hardhat/Foundry build artifact). The dropped ABI is
 * normalized to a pretty-printed array string.
 */
export function AbiTextarea({
  value,
  onChange,
  onError,
  placeholder,
  rows = 6,
  className = "",
}: Props) {
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      onChange(JSON.stringify(extractAbiFromJsonText(text), null, 2));
      onError?.(null);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Could not read ABI from file.");
    }
  };

  return (
    <div>
      <div
        className="relative"
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
      >
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          spellCheck={false}
          className={className}
        />
        {dragging && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded bg-cyan-900/40 ring-2 ring-cyan-500 ring-dashed">
            <span className="text-xs font-medium text-cyan-100">Drop .json ABI / artifact</span>
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-600">
        Drag a <span className="font-mono">.json</span> ABI or build artifact (Hardhat/Foundry) here
        to import.
      </p>
    </div>
  );
}
