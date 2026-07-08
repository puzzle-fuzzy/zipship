/**
 * Tiny structured logger. Emits one JSON object per line to stdout/stderr so
 * logs are greppable and shippable to a log aggregator. Level is controlled by
 * `ZIPSHIP_LOG_LEVEL` (debug|info|warn|error), default `info`.
 *
 * Kept dependency-free on purpose — pull in pino/otlp later when we need
 * transports, but the call sites already speak the right shape.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = (process.env.ZIPSHIP_LOG_LEVEL as LogLevel | undefined) ??
  "info";

function shouldEmit(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[configuredLevel];
}

function emit(
  level: LogLevel,
  msg: string,
  fields?: Record<string, unknown>,
): void {
  if (!shouldEmit(level)) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  });
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(line + "\n");
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
