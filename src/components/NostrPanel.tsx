import { useState } from "react";
import { Check, Copy, KeyRound, Radio, Sparkles, Trash2 } from "lucide-react";
import { Section } from "./Section";
import {
  clearIdentity,
  generateIdentity,
  saveKey,
  shortNpub,
  type Identity,
} from "../lib/nostr";

// Stub for publishing — no obvious thing for a quality scanner to push
// yet. Identity scaffolding is real: nsec lives in the OS keychain via
// the Rust `keyring` crate (libsecret on Linux), and the same identity
// powers FeedPanel's "me only" toggle. When a publish use case appears,
// port NIP-96 upload + NIP-94 publish from smpl-tool's lib/nostr.ts.

interface NostrPanelProps {
  identity: Identity | null;
  setIdentity: (i: Identity | null) => void;
}

export function NostrPanel({ identity, setIdentity }: NostrPanelProps) {
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupNsec, setBackupNsec] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSave() {
    setErr(null);
    setBusy(true);
    try {
      const id = await saveKey(input);
      setIdentity(id);
      setInput("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    setErr(null);
    setBusy(true);
    try {
      const id = await generateIdentity();
      setIdentity({ npub: id.npub, pk: id.pk });
      setBackupNsec(id.nsec);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    setErr(null);
    setBusy(true);
    try {
      await clearIdentity();
      setIdentity(null);
      setInput("");
      setBackupNsec(null);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyNsec() {
    if (!backupNsec) return;
    try {
      await navigator.clipboard.writeText(backupNsec);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied */
    }
  }

  return (
    <Section title="Publish · Nostr" icon={<Radio size={16} />}>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted mb-1">
          Identity
        </div>
        {identity ? (
          <div className="flex items-center gap-2 rounded-md bg-bg/50 px-2.5 py-1.5">
            <KeyRound size={12} className="text-accent shrink-0" />
            <span
              className="font-mono text-xs text-fg truncate flex-1"
              title={identity.npub}
            >
              {shortNpub(identity.npub)}
            </span>
            <button
              onClick={handleClear}
              disabled={busy}
              title="Forget this key (removes from OS keychain)"
              className="text-muted hover:text-alert shrink-0 disabled:opacity-50"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="password"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                placeholder="nsec1…"
                disabled={busy}
                className="flex-1 px-2.5 py-1.5 rounded-md bg-surface text-fg
                           placeholder:text-muted outline-none border border-transparent
                           focus:border-accent/50 text-xs font-mono disabled:opacity-50"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                onClick={handleSave}
                disabled={!input.trim() || busy}
                className="px-2.5 py-1.5 rounded-md bg-surface hover:bg-surfaceHover
                           text-fg disabled:opacity-50 text-xs"
              >
                Load
              </button>
            </div>
            <button
              onClick={handleGenerate}
              disabled={busy}
              className="w-full px-2.5 py-1.5 rounded-md bg-surface hover:bg-surfaceHover
                         text-fg text-xs flex items-center justify-center gap-1.5
                         disabled:opacity-50"
            >
              <Sparkles size={12} />
              Generate new key
            </button>
          </div>
        )}
        {err && (
          <p className="text-[10px] text-alert font-mono break-all mt-2">{err}</p>
        )}
      </div>

      {backupNsec && (
        <div className="rounded-md bg-warn/10 border border-warn/40 px-2.5 py-2 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-warn font-semibold">
            Back up your secret key
          </div>
          <p className="text-[11px] text-fg/80">
            The nsec is stored in your OS keychain, but it&apos;s only shown
            here once. Copy it somewhere safe — you can&apos;t recover it later.
          </p>
          <div className="flex items-center gap-2">
            <code className="font-mono text-[10px] text-fg truncate flex-1
                             rounded bg-bg/60 px-2 py-1">
              {backupNsec}
            </code>
            <button
              onClick={handleCopyNsec}
              className="text-muted hover:text-fg shrink-0"
              title={copied ? "Copied" : "Copy nsec"}
            >
              {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
            </button>
          </div>
          <button
            onClick={() => setBackupNsec(null)}
            className="text-[10px] text-muted hover:text-fg underline"
          >
            I&apos;ve saved it — dismiss
          </button>
        </div>
      )}

      <p className="text-xs text-muted leading-relaxed">
        Publish action not wired — no obvious thing for a quality scanner to
        push yet. The identity above lives in the OS keychain (libsecret on
        Linux) and powers FeedPanel&apos;s <em>me only</em> toggle. When a
        publish use case appears, port{" "}
        <code className="text-fg/80">lib/nostr.ts</code> upload + publish from{" "}
        <code className="text-fg/80">smpl-tool</code>.
      </p>

      <button
        disabled
        className="px-3 py-2 rounded-md bg-surface text-muted text-xs
                   cursor-not-allowed opacity-50"
      >
        Publish (TODO)
      </button>
    </Section>
  );
}
