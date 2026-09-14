import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';

// Main/preload changes require a restart; renderer changes use Vite HMR.
const rebuild = spawn(process.execPath, [process.env.npm_execpath, 'native:electron'], { stdio: 'inherit' });
const code = await new Promise((resolve, reject) => {
  rebuild.once('error', reject);
  rebuild.once('exit', resolve);
});
if (code !== 0) process.exit(code ?? 1);
await import('./build.mjs');
const server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
await server.listen();
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
});
const close = async () => { child.kill(); await server.close(); };
process.once('SIGINT', close);
process.once('SIGTERM', close);
child.once('error', async (error) => { console.error(error); await server.close(); process.exitCode = 1; });
child.once('exit', async (exitCode) => { await server.close(); process.exitCode = exitCode ?? 1; });
