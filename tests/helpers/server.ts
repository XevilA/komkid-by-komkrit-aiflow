// Boots the REAL server (server/index.ts) in a child process with an isolated database,
// so HTTP-level tests exercise routing, auth gate, validation and persistence end to end.
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';

export interface TestServer {
  base: string;
  token: string;
  dataDir: string;
  stop: () => Promise<void>;
  api: (method: string, url: string, body?: unknown, opts?: { auth?: boolean }) => Promise<{ status: number; json: any; text: string; headers: Headers }>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export async function startTestServer(
  extraEnv: Record<string, string> = {},
  opts: { fakeVendors?: boolean } = {}
): Promise<TestServer & { ctrlFile: string; logFile: string }> {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiflow-e2e-'));
  const password = `t-${Math.random().toString(36).slice(2)}${Date.now()}`;
  const root = path.resolve(import.meta.dirname, '..', '..');
  const ctrlFile = path.join(dataDir, 'ctrl.txt');
  const logFile = path.join(dataDir, 'vendor.log');
  fs.writeFileSync(ctrlFile, '');
  fs.writeFileSync(logFile, '');
  const fakeEnv: Record<string, string> = opts.fakeVendors
    ? {
        NODE_OPTIONS: `--import ${path.join(root, 'tests/helpers/fakeVendors.mjs')}`,
        FAKE_CTRL: ctrlFile,
        FAKE_LOG: logFile,
        DEEPSEEK_API_KEY: 'sk-test-deepseek-000000',
        OPENAI_API_KEY: 'sk-test-openai-000000',
      }
    : {};
  const child: ChildProcess = spawn(
    process.execPath,
    ['--no-warnings', path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        DATA_DIR: dataDir,
        UPLOADS_DIR: path.join(dataDir, 'uploads'),
        TMPDIR: '/tmp',
        ADMIN_USERNAME: 'e2e-admin',
        ADMIN_PASSWORD: password,
        ADMIN_AUTH_SECRET: 'c'.repeat(64),
        VAULT_MASTER_KEY: 'd'.repeat(64),
        ...fakeEnv,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let log = '';
  child.stdout?.on('data', (d) => (log += d));
  child.stderr?.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;

  const started = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > 30000) {
      child.kill();
      throw new Error(`test server did not start:\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'e2e-admin', password }),
  });
  const token = (await login.json()).token as string;

  const api: TestServer['api'] = async (method, url, body, opts) => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (opts?.auth !== false) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, json, text, headers: res.headers };
  };

  return {
    base,
    token,
    dataDir,
    ctrlFile,
    logFile,
    api,
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 200));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
