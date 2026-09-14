import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import { z } from 'zod';
import type { ProductLogger } from './product-logger.js';
import type { ProductPaths } from './product-paths.js';

const symbolMappingSchema = z.object({
  canonicalSymbol: z.string().trim().min(1),
  brokerSymbol: z.string().trim().min(1),
  pipSize: z.number().positive(),
});
const mt5ProductConfigSchema = z.object({
  mode: z.enum(['READ_ONLY', 'DEMO']).default('READ_ONLY'),
  terminalPath: z.string().default(''),
  symbolMappings: z.array(symbolMappingSchema).default([]),
  timeframes: z.array(z.string().trim().min(1)).default(['M5', 'M15', 'H1', 'H4', 'D']),
});
export type Mt5ProductConfig = z.infer<typeof mt5ProductConfigSchema>;

const defaultConfig: Mt5ProductConfig = Object.freeze({
  mode: 'READ_ONLY',
  terminalPath: '',
  symbolMappings: [],
  timeframes: ['M5', 'M15', 'H1', 'H4', 'D'],
});

export function ensureMt5ProductConfig(filename: string): Mt5ProductConfig {
  if (!existsSync(filename)) {
    writeFileSync(filename, `${JSON.stringify(defaultConfig, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    return defaultConfig;
  }
  return mt5ProductConfigSchema.parse(JSON.parse(readFileSync(filename, 'utf8')));
}

export class PackagedMt5Agent {
  private child: UtilityProcess | null = null;

  constructor(
    private readonly paths: ProductPaths,
    private readonly logger: ProductLogger,
    private readonly resourcesPath: string,
    private readonly appVersion: string,
  ) {}

  start(): void {
    if (this.child) return;
    const config = ensureMt5ProductConfig(this.paths.mt5Config);
    const agentEntry = path.join(this.resourcesPath, 'app.asar', 'dist', 'agent', 'main.mjs');
    const pythonExecutable = path.join(this.resourcesPath, 'python', 'python.exe');
    const bridgePath = path.join(this.resourcesPath, 'mt5', 'mt5_bridge.py');
    const configured = config.terminalPath.trim().length > 0 && config.symbolMappings.length > 0;
    const child = utilityProcess.fork(agentEntry, [], {
      serviceName: 'ARISE MT5 Agent',
      stdio: 'pipe',
      env: {
        ...process.env,
        ARISE_APP_VERSION: this.appVersion,
        ARISE_MT5_AGENT_PORT: '19781',
        ARISE_MT5_MODE: config.mode,
        ARISE_MT5_CONNECTOR: configured ? 'PYTHON' : 'UNAVAILABLE',
        ARISE_MT5_PYTHON: pythonExecutable,
        ARISE_MT5_BRIDGE_PATH: bridgePath,
        ARISE_MT5_TERMINAL_PATH: config.terminalPath,
        ARISE_MT5_SYMBOLS_JSON: JSON.stringify(config.symbolMappings),
        ARISE_MT5_TIMEFRAMES: config.timeframes.join(','),
        ARISE_MT5_LEDGER_PATH: this.paths.mt5Ledger,
      },
    });
    child.stdout?.on('data', (data: Buffer) => this.logger.info('mt5-agent', data.toString('utf8').trim()));
    child.stderr?.on('data', (data: Buffer) => this.logger.warn('mt5-agent', data.toString('utf8').trim()));
    child.on('spawn', () => this.logger.info('mt5-agent-started', config.mode));
    child.on('exit', (code) => {
      this.logger.warn('mt5-agent-exited', `code=${code}`);
      if (this.child === child) this.child = null;
    });
    this.child = child;
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }
}
