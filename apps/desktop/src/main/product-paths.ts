import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

export interface ProductPaths {
  readonly isExplicit: boolean;
  readonly root: string;
  readonly data: string;
  readonly evidence: string;
  readonly logs: string;
  readonly backups: string;
  readonly config: string;
  readonly runtime: string;
  readonly database: string;
  readonly logFile: string;
  readonly mt5Config: string;
  readonly mt5Ledger: string;
}

export function commandLineUserDataDirectory(argv: readonly string[]): string | null {
  const prefix = '--user-data-dir=';
  const argument = argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length).trim() || null : null;
}

export function resolveProductPaths(options: {
  readonly defaultUserDataDirectory: string;
  readonly isPackaged: boolean;
  readonly argv?: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
}): ProductPaths {
  const environment = options.environment ?? process.env;
  const explicit = environment.ARISE_USER_DATA_DIR?.trim()
    || commandLineUserDataDirectory(options.argv ?? process.argv);
  const localAppData = environment.LOCALAPPDATA?.trim();
  const root = path.resolve(
    explicit
      || (options.isPackaged && localAppData
        ? path.join(localAppData, 'ARISE')
        : options.defaultUserDataDirectory),
  );
  const data = path.join(root, 'data');
  const logs = path.join(root, 'logs');
  const config = path.join(root, 'config');
  const runtime = path.join(root, 'runtime');
  return Object.freeze({
    isExplicit: Boolean(explicit),
    root,
    data,
    evidence: path.join(root, 'evidence'),
    logs,
    backups: path.join(root, 'backups'),
    config,
    runtime,
    database: path.join(data, 'arise.db'),
    logFile: path.join(logs, 'arise.log'),
    mt5Config: path.join(config, 'mt5.json'),
    mt5Ledger: path.join(runtime, 'mt5-agent-ledger.json'),
  });
}

export function ensureProductDirectories(paths: ProductPaths): void {
  for (const directory of [
    paths.root,
    paths.data,
    paths.evidence,
    paths.logs,
    paths.backups,
    paths.config,
    paths.runtime,
  ]) mkdirSync(directory, { recursive: true });
}

export function adoptLegacyDatabase(
  paths: ProductPaths,
  legacyCandidates: readonly string[],
): string | null {
  if (existsSync(paths.database)) return null;
  const source = legacyCandidates
    .map((candidate) => path.resolve(candidate))
    .find((candidate) => candidate !== path.resolve(paths.database) && existsSync(candidate));
  if (!source) return null;

  const staged: string[] = [];
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const sourceFile = `${source}${suffix}`;
      if (!existsSync(sourceFile)) continue;
      const stagedFile = `${paths.database}${suffix}.adopting`;
      copyFileSync(sourceFile, stagedFile, constants.COPYFILE_EXCL);
      staged.push(stagedFile);
    }
    if (!staged.includes(`${paths.database}.adopting`)) return null;
    for (const stagedFile of staged) {
      renameSync(stagedFile, stagedFile.slice(0, -'.adopting'.length));
    }
    return source;
  } catch (error) {
    for (const stagedFile of staged) rmSync(stagedFile, { force: true });
    throw error;
  }
}

export function backupDatabase(paths: ProductPaths, now = new Date()): string | null {
  if (!existsSync(paths.database)) return null;
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const base = path.join(paths.backups, `arise-${stamp}.db`);
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${paths.database}${suffix}`;
    if (existsSync(source)) copyFileSync(source, `${base}${suffix}`, constants.COPYFILE_EXCL);
  }

  const backups = readdirSync(paths.backups)
    .filter((name) => /^arise-.*\.db$/.test(name))
    .map((name) => ({ name, mtime: statSync(path.join(paths.backups, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime);
  for (const old of backups.slice(10)) {
    const oldBase = path.join(paths.backups, old.name);
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${oldBase}${suffix}`, { force: true });
  }
  return base;
}
