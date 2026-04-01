import { useState, useCallback } from "react";
import type { Abi, PublicClient } from "viem";
import { isAddress } from "viem";
import { fetchAbi, parseAbiJson } from "../lib/abi";

export function useAbi() {
  const [abi, setAbi] = useState<Abi | null>(null);
  const [verified, setVerified] = useState(false);
  const [partial, setPartial] = useState(false);
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

    const result = await fetchAbi(address, client);
    setLoading(false);

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
      const parsed = parseAbiJson(raw);
      setAbi(parsed);
      setVerified(false);
      setPartial(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid ABI JSON");
    }
  }, []);

  const clear = useCallback(() => {
    setAbi(null);
    setVerified(false);
    setPartial(false);
    setError(null);
  }, []);

  return { abi, verified, partial, loading, error, load, pasteAbi, clear };
}
