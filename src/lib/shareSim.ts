import type { ValueUnit } from "./units";
import type { SimOverrides } from "./overrides";
import { ACTIVE_NETWORK } from "../config/chain";

export type SharedSim = {
  to?: string;
  from?: string;
  data?: string;
  value?: string;
  unit?: ValueUnit;
  block?: string;
  overrides?: SimOverrides;
};

function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

export function encodeSim(sim: SharedSim): string {
  return b64urlEncode(JSON.stringify(sim));
}

export function decodeSim(raw: string): SharedSim | null {
  try {
    const obj = JSON.parse(b64urlDecode(raw));
    if (!obj || typeof obj !== "object") return null;
    return obj as SharedSim;
  } catch {
    return null;
  }
}

/** Absolute URL that reopens this simulation prefilled (and auto-runs). */
export function buildSimShareUrl(sim: SharedSim): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?sim=${encodeSim(sim)}&net=${ACTIVE_NETWORK.id}`;
}

/**
 * Compact share URL that reopens the full replay view for a transaction
 * (receipt / trace / flow / re-sim). Preferred over {@link buildSimShareUrl}
 * when a re-sim is the unmodified original tx, since it avoids embedding the
 * entire calldata in the link.
 */
export function buildTxShareUrl(hash: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?tab=replay&tx=${hash}&net=${ACTIVE_NETWORK.id}`;
}
