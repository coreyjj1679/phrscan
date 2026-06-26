import { useState, useCallback } from "react";
import type { Abi, PublicClient } from "viem";
import { isAddress } from "viem";
import { fetchAbi, extractAbiFromJsonText } from "../lib/abi";
import type { ProxyInfo } from "../lib/proxy";

export function useAbi() {
  const [abi, setAbi] = useState<Abi | null>(null);
  const [verified, setVerified] = useState(false);
  const [partial, setPartial] = useState(false);
  const [proxy, setProxy] = useState<ProxyInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (address: string, client?: PublicClient) => {
    if (!isAddress(address)) {
      setError("Invalid address");
      return;
    }
    setLoading(true);
    setError(null);
    setAbi(null);
    setVerified(false);
    setPartial(false);
    setProxy(null);

    const result = await fetchAbi(address, client);
    setLoading(false);

    setProxy(result.proxy ?? null);
    if (result.abi) {
      setAbi(result.abi);
      setVerified(result.verified);
      setPartial(result.partial ?? false);
      if (result.error) setError(result.error);
    } else {
      setVerified(false);
      setPartial(false);
      if (result.error) setError(result.error);
    }
  }, []);

  const pasteAbi = useCallback((raw: string) => {
    try {
      const parsed = extractAbiFromJsonText(raw);
      setAbi(parsed);
      setVerified(false);
      setPartial(false);
      // A manually supplied ABI replaces auto-detection, so any proxy info from
      // a previously fetched contract no longer applies (e.g. switching to a
      // saved contract would otherwise keep showing the old proxy badge).
      setProxy(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid ABI JSON");
    }
  }, []);

  const clear = useCallback(() => {
    setAbi(null);
    setVerified(false);
    setPartial(false);
    setProxy(null);
    setError(null);
  }, []);

  return { abi, verified, partial, proxy, loading, error, load, pasteAbi, clear };
}
