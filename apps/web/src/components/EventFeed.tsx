"use client";

import { useEffect, useRef, useState } from "react";
import type { SSEEvent } from "@agent-aqi/shared";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function fmt(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function addrShort(addr: string): string {
  return addr.slice(0, 8) + "…";
}

function payloadStr(payload: Record<string, unknown>): string {
  const parts: string[] = [];

  if (payload["agentId"])     parts.push(`agent=${payload["agentId"]}`);
  if (payload["jobType"])     parts.push(`type=${payload["jobType"]}`);
  if (payload["mode"] && payload["mode"] !== "sim")
                              parts.push(`mode=${payload["mode"]}`);
  if (payload["latencyMs"])   parts.push(`latency=${payload["latencyMs"]}ms`);
  if (payload["gasUsedUsd"])  parts.push(`gas=$${payload["gasUsedUsd"]}`);
  if (payload["slippageBps"]) parts.push(`slip=${payload["slippageBps"]}bps`);

  // Phase 2.1: quote fields
  if (payload["quotedOut"])     parts.push(`quotedOut=${payload["quotedOut"]}`);
  if (payload["routeSummary"])  parts.push(`route=${payload["routeSummary"]}`);

  // Phase 2.2: tx payload fields
  if (payload["txTo"])  parts.push(`txTo=${addrShort(String(payload["txTo"]))}`);
  if (payload["txGas"]) parts.push(`txGas=${payload["txGas"]}`);

  if (payload["safetyFlags"] && (payload["safetyFlags"] as string[]).length) {
    parts.push(`flags=[${(payload["safetyFlags"] as string[]).join(",")}]`);
  }

  // Failure fields
  if (payload["phase"]) parts.push(`phase=${payload["phase"]}`);
  if (payload["error"]) parts.push(`err=${payload["error"]}`);

  return parts.join("  ");
}

export default function EventFeed() {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`${API}/events`);

    es.onmessage = (e: MessageEvent) => {
      try {
        const ev: SSEEvent = JSON.parse(e.data as string);
        setEvents((prev) => [...prev.slice(-99), ev]);
      } catch {
        // heartbeat or malformed line — ignore
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => es.close();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div className="event-feed">
      {events.length === 0 && (
        <span className="muted">Waiting for events… submit a job to start.</span>
      )}
      {events.map((ev) => (
        <div key={ev.id} className={`event-row ${ev.type}`}>
          <span className="event-time">{fmt(ev.ts)}</span>
          <span className={`event-type ${ev.type}`}>{ev.type.toUpperCase()}</span>
          <span className="muted">{payloadStr(ev.payload)}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
