import { useState } from "react";
import { KeyRound, Radio, Sparkles, Trash2 } from "lucide-react";
import { Section } from "./Section";
import {
  clearIdentity,
  generateIdentity,
  saveKey,
  shortNpub,
  type Identity,
} from "../lib/nostr";

// Stub: publish action not wired yet (no obvious thing to publish from a
// quality scanner). Identity scaffolding is real though — FeedPanel's
// "me only" toggle relies on it, and a future publish flow can plug in.
// When that arrives, port NIP-96 upload + NIP-94 publish from
// smpl-tool's lib/nostr.ts.

interface NostrPanelProps {
  identity: Identity | null;
  setIdentity: (i: Identity | null) => void;
}

export function NostrPanel({ identity, setIdentity }: NostrPanelProps) {
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function handleSave() {
    setErr(null);
    try {
      setIdentity(saveKey(input));
      setInput("");
    } catch (e) {
      setErr(String(e));
    }
  }

  function handleGenerate() {
    setErr(null);
    setIdentity(generateIdentity());
  }

  function handleClear() {
    clearIdentity();
    setIdentity(null);
    setInput("");
    setErr(null);
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
              title="Forget this key"
              className="text-muted hover:text-alert shrink-0"
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
                placeholder="nsec1… or 64-char hex"
                className="flex-1 px-2.5 py-1.5 rounded-md bg-surface text-fg
                           placeholder:text-muted outline-none border border-transparent
                           focus:border-accent/50 text-xs font-mono"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                onClick={handleSave}
                disabled={!input.trim()}
                className="px-2.5 py-1.5 rounded-md bg-surface hover:bg-surfaceHover
                           text-fg disabled:opacity-50 text-xs"
              >
                Load
              </button>
            </div>
            <button
              onClick={handleGenerate}
              className="w-full px-2.5 py-1.5 rounded-md bg-surface hover:bg-surfaceHover
                         text-fg text-xs flex items-center justify-center gap-1.5"
            >
              <Sparkles size={12} />
              Generate new key
            </button>
            {err && (
              <p className="text-[10px] text-alert font-mono break-all">{err}</p>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-muted leading-relaxed">
        Publish action not wired — no obvious thing for a quality scanner to
        push yet. The identity above already powers FeedPanel's <em>me only</em>
        {" "}toggle. When a publish use case appears, port{" "}
        <code className="text-fg/80">lib/nostr.ts</code> from{" "}
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
