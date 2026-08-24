"use client";

import { useEffect, useState } from "react";

/**
 * Ticks down to the next midnight in Sydney (when the daily grid rolls over),
 * regardless of the viewer's timezone.
 */
function msUntilNextSydneyMidnight(now: Date): number {
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const [h, m, s] = fmt
    .format(now)
    .split(":")
    .map((v) => Number(v));
  const secondsOfDay = ((h % 24) * 60 + m) * 60 + s;
  return 24 * 60 * 60 * 1000 - secondsOfDay * 1000;
}

function format(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function NextGridCountdown() {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(msUntilNextSydneyMidnight(new Date()));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  if (remaining === null) return null;

  return (
    <span className="rounded-full bg-accent px-3 py-1 text-sm font-medium">
      New grid in {format(remaining)}
    </span>
  );
}
