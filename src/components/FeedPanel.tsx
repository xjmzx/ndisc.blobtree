import { useEffect, useMemo, useRef, useState } from "react";
import {
  Headphones,
  Loader2,
  RefreshCw,
  Search,
  ThumbsDown,
  ThumbsUp,
  User,
  UserCheck,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { Section } from "./Section";
import { cn } from "../lib/cn";
import { type Identity, shortNpub } from "../lib/nostr";
import { useReactions } from "../hooks/useReactions";
import { REACTION_DOWN, REACTION_UP, displayCount } from "../lib/rating";

// TODO(relays): currently consumes only the first relay from the prop —
// raw WebSocket logic predates the multi-relay set. Refactor to SimplePool
// when the editable relay list lands suite-wide.
const KIND = 1063;
const LIMIT = 50;

interface NostrEvent {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
}

interface AudioMeta {
  url: string;
  mime: string;
  size: number | null;
  title: string | null;
}

function audioFrom(event: NostrEvent): AudioMeta | null {
  const get = (k: string) => event.tags.find((t) => t[0] === k)?.[1];
  const url = get("url");
  const mime = get("m");
  if (!url || !mime || !mime.startsWith("audio/")) return null;
  const sizeStr = get("size");
  return {
    url,
    mime,
    size: sizeStr ? parseInt(sizeStr, 10) : null,
    title: get("title") ?? null,
  };
}

function relativeTime(unix: number): string {
  const sec = Math.floor(Date.now() / 1000) - unix;
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function formatBytes(b: number | null): string {
  if (b === null) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}

function npubFromHex(hex: string): string {
  try {
    return nip19.npubEncode(hex);
  } catch {
    return hex.slice(0, 8);
  }
}

type Status = "idle" | "connecting" | "ready" | "error";

interface FeedPanelProps {
  relays: string[];
  identity: Identity | null;
}

export function FeedPanel({ identity, relays }: FeedPanelProps) {
  const RELAY_URL = relays[0] ?? "wss://relay.fizx.uk";
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [meOnly, setMeOnly] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);

  // Force "me only" off if identity disappears.
  useEffect(() => {
    if (!identity && meOnly) setMeOnly(false);
  }, [identity, meOnly]);

  useEffect(() => {
    setEvents([]);
    setStatus("connecting");
    setErrMsg(null);

    const subId = `afqc-feed-${Math.random().toString(36).slice(2, 10)}`;
    const filter: Record<string, unknown> = { kinds: [KIND], limit: LIMIT };
    if (meOnly && identity) filter.authors = [identity.pk];

    let ws: WebSocket;
    try {
      ws = new WebSocket(RELAY_URL);
    } catch (e) {
      setStatus("error");
      setErrMsg(String(e));
      return;
    }
    wsRef.current = ws;

    const timer = setTimeout(() => {
      if (status === "connecting") {
        setStatus("error");
        setErrMsg("connection timeout");
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      }
    }, 10_000);

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify(["REQ", subId, filter]));
      } catch (e) {
        setStatus("error");
        setErrMsg(String(e));
      }
    };

    ws.onmessage = (msg) => {
      let data: unknown;
      try {
        data = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (!Array.isArray(data)) return;
      if (data[0] === "EVENT" && data[1] === subId) {
        const event = data[2] as NostrEvent;
        if (!audioFrom(event)) return; // ignore non-audio kind:1063
        setEvents((prev) => {
          if (prev.some((e) => e.id === event.id)) return prev;
          const next = [...prev, event];
          next.sort((a, b) => b.created_at - a.created_at);
          return next;
        });
      } else if (data[0] === "EOSE" && data[1] === subId) {
        clearTimeout(timer);
        setStatus("ready");
      } else if (data[0] === "NOTICE") {
        // Relay-side notice; non-fatal.
      } else if (data[0] === "CLOSED" && data[1] === subId) {
        clearTimeout(timer);
        setStatus("error");
        setErrMsg(typeof data[2] === "string" ? data[2] : "subscription closed");
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      setStatus("error");
      setErrMsg("websocket error");
    };

    ws.onclose = (ev) => {
      clearTimeout(timer);
      if (ev.code !== 1000 && status !== "ready" && status !== "error") {
        setStatus("error");
        setErrMsg(`closed (code ${ev.code})`);
      }
    };

    return () => {
      clearTimeout(timer);
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(["CLOSE", subId]));
        }
        ws.close();
      } catch {
        /* already closed */
      }
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meOnly, identity?.pk, refreshKey]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) => {
      const a = audioFrom(e);
      const npub = npubFromHex(e.pubkey).toLowerCase();
      return (
        npub.includes(q) ||
        e.content.toLowerCase().includes(q) ||
        (a?.url.toLowerCase().includes(q) ?? false) ||
        (a?.title?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [events, search]);

  // Reaction subscription scoped to currently-visible feed events. Reads
  // are read-only (no signing); writes go via Rust commands so the nsec
  // stays in the OS keychain.
  const reactionRefs = useMemo(
    () => visible.map((e) => ({ id: e.id, pubkey: e.pubkey })),
    [visible],
  );
  const reactions = useReactions(reactionRefs, identity?.pk ?? null, KIND);

  return (
    <Section title="Listen · Nostr" icon={<Headphones size={16} />}>
      <div className="flex items-center gap-2 text-xs">
        <span
          className={cn(
            "px-2 py-0.5 rounded-full font-mono",
            status === "ready" && "bg-ok/15 text-ok",
            status === "connecting" && "bg-warn/15 text-warn",
            status === "error" && "bg-alert/15 text-alert",
            status === "idle" && "bg-surface/40 text-muted",
          )}
          title={RELAY_URL}
        >
          {status === "ready"
            ? `${events.length} loaded`
            : status === "connecting"
              ? "connecting…"
              : status === "error"
                ? "error"
                : "idle"}
        </span>
        <button
          onClick={() => setMeOnly((v) => !v)}
          disabled={!identity}
          title={
            !identity
              ? "Load or generate an identity in the Publish panel to enable"
              : meOnly
                ? "Showing only your samples"
                : "Showing everyone's samples"
          }
          className={cn(
            "px-2 py-1 rounded text-xs flex items-center gap-1.5",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            meOnly
              ? "bg-accent text-bg"
              : "bg-surface hover:bg-surfaceHover text-fg",
          )}
        >
          {meOnly ? <UserCheck size={12} /> : <User size={12} />}
          me only
        </button>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          title="Refresh"
          className="ml-auto px-2 py-1 rounded text-muted hover:text-fg hover:bg-surface/40"
        >
          <RefreshCw size={14} className={status === "connecting" ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="relative">
        <Search
          size={12}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="filter by author, title, url…"
          className="w-full pl-7 pr-3 py-1.5 rounded-md bg-surface text-fg
                     placeholder:text-muted outline-none border border-transparent
                     focus:border-accent/50 text-xs"
          spellCheck={false}
        />
      </div>

      {status === "error" && errMsg && (
        <p className="text-xs text-alert font-mono break-all">{errMsg}</p>
      )}

      <ul className="max-h-72 overflow-auto rounded-md bg-bg/40 divide-y divide-surface/30">
        {visible.length === 0 && (
          <li className="px-3 py-6 text-xs text-muted text-center">
            {status === "ready"
              ? search
                ? "no matches"
                : meOnly
                  ? "you haven't published any kind:1063 samples yet"
                  : "no audio samples on this relay"
              : status === "connecting"
                ? "loading…"
                : status === "error"
                  ? "nothing loaded"
                  : ""}
          </li>
        )}
        {visible.map((event) => {
          const a = audioFrom(event)!;
          const npub = npubFromHex(event.pubkey);
          const title = a.title ?? event.content.trim() ?? "untitled";
          const agg = reactions.forEvent(event.id);
          const isBusy = reactions.busy === event.id;
          const myUp = agg.mine != null; // mine is the reaction event id
          const onUp = async () => {
            if (!reactions.canReact || isBusy) return;
            if (myUp) await reactions.unreact(event.id);
            else await reactions.react(event.id, REACTION_UP);
          };
          const onDown = async () => {
            if (!reactions.canReact || isBusy) return;
            if (myUp) await reactions.unreact(event.id);
            await reactions.react(event.id, REACTION_DOWN);
          };
          return (
            <li key={event.id} className="p-2.5 space-y-1.5">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-mono text-accent truncate">{shortNpub(npub)}</span>
                <span className="text-muted shrink-0">{relativeTime(event.created_at)}</span>
                <span className="text-muted shrink-0 ml-auto">
                  {a.mime.replace("audio/", "")}
                  {a.size !== null && ` · ${formatBytes(a.size)}`}
                </span>
              </div>
              <div className="text-xs text-fg/90 break-words line-clamp-2" title={title}>
                {title || "(untitled)"}
              </div>
              <audio
                controls
                preload="none"
                src={a.url}
                className="w-full h-8"
              />
              <div className="flex items-center gap-1 text-[11px]">
                <button
                  onClick={onUp}
                  disabled={!reactions.canReact || isBusy}
                  title={
                    !reactions.canReact
                      ? "load a key to react"
                      : myUp
                        ? "remove your reaction"
                        : "upvote"
                  }
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded",
                    "disabled:opacity-40 disabled:cursor-not-allowed",
                    myUp
                      ? "bg-ok/15 text-ok"
                      : "text-muted hover:text-fg hover:bg-surface/40",
                  )}
                >
                  {isBusy ? <Loader2 size={11} className="animate-spin" /> : <ThumbsUp size={11} />}
                  {displayCount(agg.up)}
                </button>
                <button
                  onClick={onDown}
                  disabled={!reactions.canReact || isBusy}
                  title={!reactions.canReact ? "load a key to react" : "downvote"}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded",
                    "disabled:opacity-40 disabled:cursor-not-allowed",
                    "text-muted hover:text-alert hover:bg-surface/40",
                  )}
                >
                  <ThumbsDown size={11} />
                  {displayCount(agg.down)}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
