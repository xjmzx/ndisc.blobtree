import { useEffect, useMemo, useState } from "react";

/**
 * `useState<string>` that mirrors itself into localStorage under `key`.
 * On mount, the initial value is read from storage; falls back to
 * `fallback` if the key is absent or storage is unavailable.
 *
 * Used for "last-used directory" memory on the Scanner / Workspace /
 * Sampler destination inputs so the user doesn't have to re-pick on
 * every relaunch. Keys live under the `afqc-tauri.` namespace.
 */
export function usePersistedString(
  key: string,
  fallback: string,
): [string, (v: string) => void] {
  const [v, setV] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, v);
    } catch {
      // quota exceeded or storage disabled — silently ignore
    }
  }, [key, v]);
  return [v, setV];
}

/** Boolean variant — stored as "1" / "0". Used by collapsible panels. */
export function usePersistedBool(
  key: string,
  fallback: boolean,
): [boolean, (v: boolean) => void] {
  const [s, setS] = usePersistedString(key, fallback ? "1" : "0");
  const setter = useMemo(() => (v: boolean) => setS(v ? "1" : "0"), [setS]);
  return [s === "1", setter];
}
