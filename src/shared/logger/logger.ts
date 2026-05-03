type LogLevel = "info" | "warn" | "error";

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

export type Logger = {
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
};

export function createLogger(scope: string): Logger {
  const log = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
    const ctx = context ? ` ${safeJson(context)}` : "";
    const line = `[spole-api] [${scope}] ${level.toUpperCase()} ${message}${ctx}`;
    console[level === "info" ? "log" : level](line);
  };

  return {
    info: (message, context) => log("info", message, context),
    warn: (message, context) => log("warn", message, context),
    error: (message, context) => log("error", message, context)
  };
}
