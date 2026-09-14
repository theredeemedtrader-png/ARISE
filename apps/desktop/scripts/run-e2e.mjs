import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const playwrightCli = fileURLToPath(import.meta.resolve('@playwright/test/cli'));
const result = spawnSync(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
  env: environment,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
