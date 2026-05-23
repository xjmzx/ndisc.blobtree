// Nostr identity helpers for audio-flac-quality-check-tauri.
//
// Scope: identity only — load / save / generate / clear an nsec held in
// localStorage. Used by FeedPanel for its "me only" author filter and by
// the (still-stub) NostrPanel for status display. When/if NostrPanel
// grows a real publish action, port the NIP-96 upload + NIP-94 publish
// flow from smpl-tool's lib/nostr.ts.

import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";

const KEY_STORAGE = "afqc-tauri.nsec";

export interface Identity {
  sk: Uint8Array;
  pk: string; // hex pubkey
  nsec: string;
  npub: string;
}

function fromSecret(sk: Uint8Array, nsec: string): Identity {
  const pk = getPublicKey(sk);
  return { sk, pk, nsec, npub: nip19.npubEncode(pk) };
}

export function loadIdentity(): Identity | null {
  const stored = localStorage.getItem(KEY_STORAGE);
  if (!stored) return null;
  try {
    const decoded = nip19.decode(stored);
    if (decoded.type !== "nsec") return null;
    return fromSecret(decoded.data as Uint8Array, stored);
  } catch {
    return null;
  }
}

/** Accept either bech32 `nsec1…` or 64-char hex. */
export function saveKey(input: string): Identity {
  const trimmed = input.trim();
  let sk: Uint8Array;
  let nsec: string;

  if (trimmed.startsWith("nsec1")) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== "nsec") throw new Error("malformed nsec");
    sk = decoded.data as Uint8Array;
    nsec = trimmed;
  } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    sk = new Uint8Array(
      trimmed
        .toLowerCase()
        .match(/.{2}/g)!
        .map((b) => parseInt(b, 16)),
    );
    nsec = nip19.nsecEncode(sk);
  } else {
    throw new Error("expected nsec1… or 64-char hex");
  }

  localStorage.setItem(KEY_STORAGE, nsec);
  return fromSecret(sk, nsec);
}

export function generateIdentity(): Identity {
  const sk = generateSecretKey();
  const nsec = nip19.nsecEncode(sk);
  localStorage.setItem(KEY_STORAGE, nsec);
  return fromSecret(sk, nsec);
}

export function clearIdentity(): void {
  localStorage.removeItem(KEY_STORAGE);
}

/** Short display form: "npub1abcdefg…xyz". */
export function shortNpub(npub: string): string {
  if (npub.length < 16) return npub;
  return `${npub.slice(0, 12)}…${npub.slice(-4)}`;
}
