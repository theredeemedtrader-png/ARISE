import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProductLogger, redactLogText } from './product-logger';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('production logging', () => {
  it('redacts common credential fields', () => {
    expect(redactLogText('api_key=abc password: secret token=xyz')).toBe(
      'api_key=[REDACTED] password: [REDACTED] token=[REDACTED]',
    );
  });

  it('writes structured build-aware logs', () => {
    const root = path.join(tmpdir(), `arise-logger-${Date.now()}-${Math.random()}`);
    roots.push(root);
    mkdirSync(root, { recursive: true });
    const filename = path.join(root, 'arise.log');
    createProductLogger(filename, { version: '1.0.0-beta.1', buildCommit: 'abcdef0' })
      .info('startup', 'token=private');
    const entry = JSON.parse(readFileSync(filename, 'utf8').trim()) as Record<string, string>;
    expect(entry.version).toBe('1.0.0-beta.1');
    expect(entry.detail).toBe('token=[REDACTED]');
  });
});
