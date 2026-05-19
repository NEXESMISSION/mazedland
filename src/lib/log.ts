/**
 * Compact structured logger for server + client.
 *
 * Output shape (one line per event):
 *
 *   12:34:56 api  GET /api/explore 200 · 446ms
 *   12:34:56 mw   /fr/properties · 5ms
 *   12:34:56 cli  fetch GET /api/x 200 · 40ms
 *   WARN  12:34:56 api  POST /api/foo 503 · server_misconfigured
 *   ERROR 12:34:56 cli  TypeError: x is not a function
 *
 * Design:
 *   - No level tag on info/debug — only WARN and ERROR get prefixed
 *   - 8-char HH:MM:SS timestamp (drop ms — they're in the duration field)
 *   - 3-letter scope (mw / api / cli / …)
 *   - Free-form message column
 *   - Tail: ·-separated key facts (duration, status, count)
 *
 * Threshold: `NEXT_PUBLIC_LOG_LEVEL` (browser + server) or `LOG_LEVEL`
 * (server only). Default `debug` in dev, `info` in prod.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveLevel(): LogLevel {
  const raw =
    (typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_LOG_LEVEL ?? process.env.LOG_LEVEL
      : undefined) ?? "";
  const v = raw.toLowerCase();
  if (v === "debug" || v === "info" || v === "warn" || v === "error") return v;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

const ACTIVE_THRESHOLD = LEVEL_ORDER[resolveLevel()];
const IS_BROWSER = typeof window !== "undefined";

// ANSI for server, %c for browser. Picked to be readable on both light and
// dark terminal/console themes.
const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
} as const;

function shortTime() {
  const d = new Date();
  return (
    String(d.getHours()).padStart(2, "0") + ":" +
    String(d.getMinutes()).padStart(2, "0") + ":" +
    String(d.getSeconds()).padStart(2, "0")
  );
}

function fmtTail(payload: unknown): string {
  if (payload === undefined || payload === null) return "";
  if (typeof payload === "string") return ` · ${payload}`;
  if (typeof payload === "number" || typeof payload === "boolean") return ` · ${payload}`;
  if (payload instanceof Error) return ` · ${payload.name}: ${payload.message}`;
  if (typeof payload !== "object") return "";

  const obj = payload as Record<string, unknown>;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "object") {
      // Compact: just count or skip nested
      if (Array.isArray(v)) parts.push(`${k}=[${v.length}]`);
      else parts.push(`${k}={…}`);
      continue;
    }
    const str = String(v);
    parts.push(str.length > 60 ? `${k}=${str.slice(0, 60)}…` : `${k}=${str}`);
  }
  return parts.length ? ` · ${parts.join(" ")}` : "";
}

function emit(level: LogLevel, scope: string, message: string, payload?: unknown) {
  if (LEVEL_ORDER[level] < ACTIVE_THRESHOLD) return;
  const time = shortTime();
  const tail = fmtTail(payload);

  if (IS_BROWSER) {
    // Build one styled line. Only WARN/ERROR show a level prefix.
    const isLoud = level === "warn" || level === "error";
    const levelTag = isLoud ? (level === "error" ? "ERROR " : "WARN ") : "";
    const levelCss =
      level === "error" ? "color:#dc2626;font-weight:bold"
      : level === "warn" ? "color:#d97706;font-weight:bold"
      : "color:inherit";
    const head =
      `%c${levelTag}%c${time} %c${scope.padEnd(3)}%c ${message}${tail}`;
    const fn =
      level === "error" ? console.error
      : level === "warn" ? console.warn
      : level === "debug" ? console.debug
      : console.log;
    fn(head, levelCss, "color:#9ca3af", "color:#7c3aed;font-weight:bold", "color:inherit");
    if (payload instanceof Error && payload.stack) {
      fn(payload.stack);
    }
    return;
  }

  const fn =
    level === "error" ? console.error
    : level === "warn" ? console.warn
    : level === "debug" ? console.debug
    : console.log;

  const colorTime = `${ANSI.gray}${time}${ANSI.reset}`;
  const colorScope = `${ANSI.cyan}${scope.padEnd(3)}${ANSI.reset}`;
  const isLoud = level === "warn" || level === "error";
  const levelTag = isLoud
    ? (level === "error"
        ? `${ANSI.red}${ANSI.bold}ERR ${ANSI.reset} `
        : `${ANSI.yellow}${ANSI.bold}WARN${ANSI.reset} `)
    : "";
  const tailColored = tail ? `${ANSI.gray}${tail}${ANSI.reset}` : "";
  fn(`${levelTag}${colorTime} ${colorScope} ${message}${tailColored}`);
  if (payload instanceof Error && payload.stack) {
    const lines = payload.stack.split("\n").slice(1, 4).join("\n  ");
    fn(`  ${ANSI.dim}${lines}${ANSI.reset}`);
  }
}

type ScopedLogger = {
  debug: (msg: string, payload?: unknown) => void;
  info: (msg: string, payload?: unknown) => void;
  warn: (msg: string, payload?: unknown) => void;
  error: (msg: string, payload?: unknown) => void;
  /**
   * Start a timer. Returns a fn that, when called, logs ONE line with
   * the elapsed ms and returns it. No "start" log — keeps output tight.
   */
  time: (label: string) => () => number;
  scope: (sub: string) => ScopedLogger;
};

function build(scope: string): ScopedLogger {
  return {
    debug: (m, p) => emit("debug", scope, m, p),
    info: (m, p) => emit("info", scope, m, p),
    warn: (m, p) => emit("warn", scope, m, p),
    error: (m, p) => emit("error", scope, m, p),
    time(label) {
      const start = performance.now();
      return () => {
        const ms = Math.round(performance.now() - start);
        emit("debug", scope, label, { ms });
        return ms;
      };
    },
    scope(sub) {
      return build(sub);
    },
  };
}

export const log = build("app");
