import { appendFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';

export interface ProductLogger {
  readonly info: (event: string, detail?: string) => void;
  readonly warn: (event: string, detail?: string) => void;
  readonly error: (event: string, error?: unknown) => void;
}

export function redactLogText(value: unknown): string {
  const text = value instanceof Error
    ? `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`
    : String(value ?? '');
  return text
    .replace(/((?:password|token|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(mt5:\/\/)[^@\s]+@/gi, '$1[REDACTED]@');
}

export function createProductLogger(
  filename: string,
  context: Readonly<{ version: string; buildCommit: string }>,
): ProductLogger {
  if (existsSync(filename) && statSync(filename).size > 5 * 1024 * 1024) {
    rmSync(`${filename}.1`, { force: true });
    renameSync(filename, `${filename}.1`);
  }
  const write = (level: string, event: string, detail?: unknown) => {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event: redactLogText(event),
      detail: detail === undefined ? undefined : redactLogText(detail),
      ...context,
    });
    appendFileSync(filename, `${line}\n`, { encoding: 'utf8' });
    const consoleMethod = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.info;
    consoleMethod(`[ARISE] ${event}${detail === undefined ? '' : `: ${redactLogText(detail)}`}`);
  };
  return Object.freeze({
    info: (event: string, detail?: string) => write('INFO', event, detail),
    warn: (event: string, detail?: string) => write('WARN', event, detail),
    error: (event: string, error?: unknown) => write('ERROR', event, error),
  });
}
