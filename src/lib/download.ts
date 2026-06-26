/** Trigger a client-side download of `data` serialized as pretty JSON (bigint-safe). */
export function downloadJson(filename: string, data: unknown): void {
  const json = JSON.stringify(
    data,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
