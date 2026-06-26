type Tone = "cyan" | "violet";

type Props = {
  address: string;
  className?: string;
  lead?: number;
  tail?: number;
  tone?: Tone;
};

const END_TONE: Record<Tone, string> = {
  cyan: "text-cyan-300",
  violet: "text-violet-300",
};

/**
 * Binance-style address display: the first `lead` and last `tail` characters —
 * the parts people actually eyeball when verifying an address — are emphasized
 * with color, while the middle stays a readable mid-gray (rather than being
 * dimmed into the background).
 */
export function HighlightAddress({
  address,
  className = "",
  lead = 6,
  tail = 6,
  tone = "cyan",
}: Props) {
  const endClass = `font-semibold ${END_TONE[tone]}`;
  const tooShort = address.length <= lead + tail;
  return (
    <span className={`font-mono tracking-tight ${className}`} title={address}>
      {tooShort ? (
        <span className="text-gray-300">{address}</span>
      ) : (
        <>
          <span className={endClass}>{address.slice(0, lead)}</span>
          <span className="text-gray-400">{address.slice(lead, address.length - tail)}</span>
          <span className={endClass}>{address.slice(address.length - tail)}</span>
        </>
      )}
    </span>
  );
}
