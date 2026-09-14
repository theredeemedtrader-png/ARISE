import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureMt5ProductConfig } from './mt5-agent-manager';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('packaged MT5 configuration', () => {
  it('creates a non-trading default with no credentials', () => {
    const root = path.join(tmpdir(), `arise-mt5-config-${Date.now()}-${Math.random()}`);
    roots.push(root);
    mkdirSync(root, { recursive: true });
    const filename = path.join(root, 'mt5.json');
    expect(ensureMt5ProductConfig(filename).mode).toBe('READ_ONLY');
    expect(readFileSync(filename, 'utf8')).not.toMatch(/password|login|token/i);
  });

  it('rejects LIVE configuration', () => {
    const root = path.join(tmpdir(), `arise-mt5-config-live-${Date.now()}-${Math.random()}`);
    roots.push(root);
    mkdirSync(root, { recursive: true });
    const filename = path.join(root, 'mt5.json');
    writeFileSync(filename, JSON.stringify({ mode: 'LIVE', terminalPath: '', symbolMappings: [] }));
    expect(() => ensureMt5ProductConfig(filename)).toThrow();
  });
});
