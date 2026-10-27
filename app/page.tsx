"use client";

import { useEffect, useState } from "react";
import { startMandragora } from "@/lib/engine";
import { getBrowserClient } from "@/lib/supabase";

type Row = { id: string; text: string };

export default function Home() {
  const [channel, setChannel] = useState(1);
  const [live, setLive] = useState("연결 중…");
  useEffect(() => {
    const sb = getBrowserClient();
    const endpoint = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/mandrakes/`;
    const client = crypto.randomUUID();
    const pullsEndpoint = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/pulls/`;
    const controller = new AbortController();
    let stopped = false;
    const seen = new Set<string>();
    async function loadLocal(): Promise<Row[]> {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load messages");
      return response.json();
    }
    const api = {
      async load(): Promise<Row[]> {
        if (!sb) {
          const rows = await loadLocal();
          rows.forEach(row => seen.add(row.id));
          return rows;
        }
        const { data, error } = await sb.from("mandrakes").select("id, text").order("created_at", { ascending: false }).limit(1000);
        if (error) throw error;
        return data ?? [];
      },
      subscribe(cb: (row: Row) => void) {
        if (!sb) {
          let stopped = false;
          let loading = false;
          const poll = async () => {
            if (stopped || loading || document.hidden) return;
            loading = true;
            try {
              const rows = await loadLocal();
              if (stopped) return;
              for (const row of rows) if (!seen.has(row.id)) { seen.add(row.id); cb(row); }
              seen.clear();
              rows.forEach(row => seen.add(row.id));
            } catch { /* Keep the current field visible during temporary outages. */ }
            finally { loading = false; }
          };
          const timer = setInterval(poll, 5000);
          return () => { stopped = true; clearInterval(timer); };
        }
        const ch = sb
          .channel("mandrakes-inserts")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "mandrakes" }, payload => cb(payload.new as Row))
          .subscribe();
        return () => { sb.removeChannel(ch); };
      },
      async pull(pull: { text: string; seed: number; x: number; y: number }) {
        const response = await fetch(pullsEndpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...pull, client, channel }), signal: controller.signal });
        if (!response.ok) throw new Error("Pull broadcast failed");
      },
      subscribePulls(cb: (event: { text: string; seed: number; x: number; y: number }) => void) {
        let cursor: number | null = null;
        let loading = false;
        const poll = async () => {
          if (stopped || loading || document.hidden) return;
          loading = true;
          try {
            const response = await fetch(`${pullsEndpoint}?channel=${channel}${cursor === null ? "" : `&since=${cursor}`}`, { cache: "no-store", signal: controller.signal });
            if (!response.ok) throw new Error("Live connection failed");
            const data = await response.json();
            if (stopped) return;
            cursor = data.cursor;
            for (const event of data.events) if (event.client !== client) cb(event);
            setLive("실시간 연결됨");
          } catch { if (!stopped) setLive("다시 연결 중…"); }
          finally { loading = false; }
        };
        void poll();
        const timer = setInterval(poll, 400);
        return () => clearInterval(timer);
      },
      async plant(text: string) {
        const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
        if (res.ok) return { ok: true };
        const j = await res.json().catch(() => ({}));
        return { ok: false, code: j.code, message: j.message };
      },
    };
    setLive("연결 중…");
    const cleanup = startMandragora(api);
    return () => { stopped = true; controller.abort(); cleanup(); };
  }, [channel]);

  return (
    <>
      <main className="scene" id="field" aria-label="만드라고라 밭">
        <canvas id="bg" />
        <canvas id="fg" />
        <canvas id="fx" />
        <div className="status" id="status">불러오는 중…</div>
      </main>

      <nav className="channels" aria-label="밭 채널">
        <div className="channel-buttons">
          {["동쪽", "서쪽", "남쪽", "북쪽"].map((name, index) => (
            <button key={name} type="button" aria-pressed={channel === index + 1} onClick={() => setChannel(index + 1)}>{name} 밭</button>
          ))}
        </div>
        <p role="status">{live} · 같은 밭의 뽑기가 함께 보여요</p>
      </nav>

      <button className="mute" id="mute" type="button" aria-pressed="false" aria-label="소리 끄기">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
          <path className="waves" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
          <path className="x" d="M17 9l5 6M22 9l-5 6" />
        </svg>
      </button>

      <div className="toast" id="toast" role="status" aria-live="polite" />

      <form className="bar" id="plantForm" autoComplete="off">
        <label className="sr" htmlFor="msg">입력</label>
        <input id="msg" name="msg" maxLength={100} placeholder="아무 말이나 입력하세요" enterKeyHint="send" />
        <span className="count" id="count">0/100</span>
        <button type="submit" className="send" id="sendBtn">입력</button>
      </form>
    </>
  );
}
