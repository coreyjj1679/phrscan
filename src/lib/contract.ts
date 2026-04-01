import { EXPLORER_DIRECT_API } from "../config/chain";

export type ContractSource = {
  name: string;
  compiler: string;
  sourceCode: string;
  additionalSources: { filename: string; code: string }[];
  isProxy: boolean;
  implementationAddress?: string;
};

export async function fetchContractSource(
  address: string,
): Promise<ContractSource | null> {
  // Try explorer v2 API (via Vite proxy in dev)
  try {
    const url = `${EXPLORER_DIRECT_API}/api/v2/smart-contracts/${address}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    if (text.includes("<!DOCTYPE") || text.includes("<html")) return null;
    const json = JSON.parse(text);

    if (!json.source_code && !json.is_verified) return null;

    const additionalSources: { filename: string; code: string }[] = [];
    if (json.additional_sources && Array.isArray(json.additional_sources)) {
      for (const src of json.additional_sources) {
        if (src.file_path && src.source_code) {
          additionalSources.push({
            filename: src.file_path,
            code: src.source_code,
          });
        }
      }
    }

    return {
      name: json.name ?? "Unknown",
      compiler: json.compiler_version ?? "",
      sourceCode: json.source_code ?? "",
      additionalSources,
      isProxy: json.is_proxy ?? false,
      implementationAddress: json.implementations?.[0]?.address,
    };
  } catch {
    return null;
  }
}
