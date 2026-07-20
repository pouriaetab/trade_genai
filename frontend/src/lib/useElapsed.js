import { useEffect, useState } from "react";

// Ticks up in whole seconds while `active` is true, resets to 0 when it isn't.
// Used to give a live "how long has this been running" cue for anything that
// hits an external API or a slow computation (no server-side progress needed).
export function useElapsed(active) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) { setSeconds(0); return; }
    const start = Date.now();
    setSeconds(0);
    const id = setInterval(() => setSeconds(Math.round((Date.now() - start) / 1000)), 500);
    return () => clearInterval(id);
  }, [active]);
  return seconds;
}
