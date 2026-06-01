export const log = {
  info: (...args: unknown[]): void => console.info("[ai-core]", ...args),
  warn: (...args: unknown[]): void => console.warn("[ai-core]", ...args),
  error: (...args: unknown[]): void => console.error("[ai-core]", ...args)
};
