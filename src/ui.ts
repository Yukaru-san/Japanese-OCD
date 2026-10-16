// Small helpers every section of the page uses: element lookup and the log panel.
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Adds a line at the top of the log panel; with an error, its code and message. */
export function log(message: string, error?: unknown): void {
  const logEl = $('log');
  const time = new Date().toLocaleTimeString();
  let line = `${time} ${message}`;
  if (error) {
    const e = error as { code?: string; message?: string };
    line += ` → ${e.code ?? 'ERROR'}: ${e.message ?? String(error)}`;
  }
  logEl.textContent = `${line}\n${logEl.textContent ?? ''}`;
}

/** Runs a plugin call, logs its outcome and never throws. */
export async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const value = await fn();
    log(`${label} ok`);
    return value;
  } catch (error) {
    log(label, error);
    return undefined;
  }
}
