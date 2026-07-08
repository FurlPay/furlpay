// ---------------------------------------------------------------------------
// Structured logger. JSON lines in production (machine-parseable by Vercel
// log drains / Datadog), human-readable in dev. Zero dependencies so it can
// be imported anywhere, including code that runs before app bootstrap.
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

const IS_PROD = process.env.NODE_ENV === "production";

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  if (IS_PROD) {
    // One JSON object per line; never throws on circular refs.
    let line: string;
    try {
      line = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...fields });
    } catch {
      line = JSON.stringify({ level, msg, ts: new Date().toISOString(), fieldsError: "unserializable" });
    }
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
    return;
  }
  const suffix = fields && Object.keys(fields).length ? ` ${safeInspect(fields)}` : "";
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(
    `[${level}] ${msg}${suffix}`
  );
}

function safeInspect(fields: LogFields): string {
  try {
    return JSON.stringify(fields);
  } catch {
    return "[unserializable fields]";
  }
}

export const log = {
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};
