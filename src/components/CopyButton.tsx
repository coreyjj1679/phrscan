import { useState } from "react";

type Props = {
  text: string;
  /** Optional label; defaults to an icon-only button. */
  label?: string;
  className?: string;
};

export function CopyButton({ text, label, className = "" }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy to clipboard"
      title={copied ? "Copied!" : "Copy"}
      className={`inline-flex items-center gap-1 text-xs transition-colors ${
        copied ? "text-success" : "text-gray-500 hover:text-gray-300"
      } ${className}`}
    >
      {copied ? (
        <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 13 4 4L19 7" />
        </svg>
      ) : (
        <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
      {label && <span>{copied ? "copied" : label}</span>}
    </button>
  );
}
