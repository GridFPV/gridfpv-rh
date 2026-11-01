/**
 * The helper's local server (#99): loopback only, JSON over HTTP, the live picture as
 * server-sent events, and the window's own files. The desktop shell starts the pipeline
 * with `gridfpv-video serve` and points its window here; a plain browser works the same.
 *
 *   GET  /api/status                     the snapshot (what is running, connections, runs)
 *   GET  /api/events                     SSE: `snapshot` on connect, then `change` and `log`
 *   GET  /api/log                        the last log lines
 *   GET  /api/profiles                   { profiles: [{name, settings}], lastProfile, fields, defaults }
 *   PUT  /api/profiles/<name>            body: settings → saved profile
 *   DELETE /api/profiles/<name>
 *   POST /api/profiles/<name>/rename     { to }
 *   POST /api/start                      { profile }
 *   POST /api/stop
 *   POST /api/render                     { sidecar } — this run, now
 *   POST /api/render-all                 every run that needs a render, in order
 *   POST /api/probe                      { settings, only?: 'obs'|'timer', timeoutMs? } → { timer: {ok,…}, obs: {ok, scenes, …} } — tried, then closed
 *   POST /api/pick                       { kind: 'folder'|'file', start } → { path } | { path: null } | { unsupported: true }
 *   POST /api/open                       { path } — the folder (or file) in the OS's file manager
 *   GET  /api/browse?dir=                list a folder (for picking one)
 *   GET  /*                              the window's files from `uiDir` (index.html fallback)
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DEFAULTS } from './config.js';
import { FIELDS } from './helper.js';
import { pickPath } from './pick.js';
import { probeSettings } from './probe.js';
import { Profiles } from './profiles.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
};

export function startServer({
  helper,
  port = 0,
  host = '127.0.0.1',
  uiDir = null,
  log = () => {},
  probe = probeSettings,
  pick = pickPath
}) {
  const clients = new Set();
  const send = (res, event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  helper.on('change', (snap) => {
    for (const c of clients) send(c, 'change', snap);
  });
  helper.on('log', (line) => {
    for (const c of clients) send(c, 'log', line);
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return await serveStatic(res, url.pathname, uiDir);
    } catch (e) {
      log(`server: ${req.method} ${req.url} → ${e.message}`);
      json(res, e.status ?? 500, { error: e.message });
    }
  });

  async function api(req, res, url) {
    const [, , head, name, verb] = url.pathname.split('/').map(decodeURIComponent);
    const m = req.method;
    if (m === 'GET' && head === 'status') return json(res, 200, helper.snapshot());
    if (m === 'GET' && head === 'log') return json(res, 200, { lines: helper.lines });
    if (m === 'GET' && head === 'events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      res.write(': hello\n\n');
      send(res, 'snapshot', { ...helper.snapshot(), log: helper.lines });
      clients.add(res);
      const keep = setInterval(() => res.write(': ping\n\n'), 15_000);
      req.on('close', () => {
        clearInterval(keep);
        clients.delete(res);
      });
      return;
    }
    if (head === 'profiles') {
      if (m === 'GET' && !name)
        return json(res, 200, {
          profiles: await helper.profiles.list(),
          lastProfile: (await helper.profiles.state()).lastProfile,
          fields: FIELDS,
          defaults: DEFAULTS
        });
      if (m === 'PUT' && name)
        return json(res, 200, await helper.profiles.save(name, await body(req)));
      if (m === 'DELETE' && name) {
        await helper.profiles.remove(name);
        return json(res, 200, { ok: true });
      }
      if (m === 'POST' && name && verb === 'rename') {
        const { to } = await body(req);
        return json(res, 200, await helper.profiles.rename(name, to));
      }
    }
    if (m === 'POST' && head === 'start') {
      const { profile } = await body(req);
      return json(res, 200, await helper.start(profile));
    }
    if (m === 'POST' && head === 'stop') {
      await helper.stop();
      return json(res, 200, helper.snapshot());
    }
    if (m === 'POST' && head === 'render') {
      const { sidecar } = await body(req);
      helper.render(sidecar).catch((e) => helper.log(`render failed: ${e.message}`));
      return json(res, 202, { ok: true });
    }
    if (m === 'POST' && head === 'probe') {
      const { settings, only, timeoutMs } = await body(req);
      const opts = {};
      if (only === 'obs' || only === 'timer') opts.only = only;
      if (Number.isFinite(timeoutMs)) opts.timeoutMs = Math.min(30_000, Math.max(1000, timeoutMs));
      return json(res, 200, await probe(Profiles.effective(settings ?? {}), opts));
    }
    if (m === 'POST' && head === 'pick') {
      const { kind, start } = await body(req);
      const r = await pick(kind === 'file' ? 'file' : 'folder', start || '');
      return json(res, 200, r && typeof r === 'object' ? r : { path: r });
    }
    if (m === 'POST' && head === 'render-all') {
      helper.renderAll().catch((e) => helper.log(`render all failed: ${e.message}`));
      return json(res, 202, { ok: true });
    }
    if (m === 'POST' && head === 'open') {
      const { path: target } = await body(req);
      await openInFileManager(target);
      return json(res, 200, { ok: true });
    }
    if (m === 'GET' && head === 'browse') {
      const dir = url.searchParams.get('dir') || os.homedir();
      const names = await fs.readdir(dir, { withFileTypes: true });
      return json(res, 200, {
        dir,
        parent: path.dirname(dir) === dir ? null : path.dirname(dir),
        folders: names
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
          .map((d) => d.name)
          .sort((a, b) => a.localeCompare(b))
      });
    }
    json(res, 404, { error: `no such call: ${m} ${url.pathname}` });
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const a = server.address();
      const origin = `http://${host}:${a.port}`;
      log(`listening ${origin}`);
      resolve({ server, origin, port: a.port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function json(res, status, data) {
  const buf = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store'
  });
  res.end(buf);
}

async function serveStatic(res, pathname, uiDir) {
  if (!uiDir) return json(res, 404, { error: 'no UI files configured' });
  uiDir = path.resolve(uiDir); // a relative --ui would otherwise fail its own guard below
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  let file = path.join(uiDir, rel);
  if (!file.startsWith(uiDir)) return json(res, 403, { error: 'no' });
  let st = await fs.stat(file).catch(() => null);
  if (!st || st.isDirectory()) {
    file = path.join(uiDir, 'index.html');
    st = await fs.stat(file).catch(() => null);
    if (!st) return json(res, 404, { error: 'the window’s files are not built' });
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': file.endsWith('index.html')
      ? 'no-store'
      : 'public, max-age=31536000, immutable'
  });
  res.end(await fs.readFile(file));
}

/** Show a path in the OS's file manager — or a URL in its browser: Explorer, Finder/open, or xdg-open's choice. */
export function openInFileManager(target) {
  return new Promise((resolve, reject) => {
    let cmd, args;
    if (process.platform === 'win32') {
      cmd = 'explorer';
      args = [target];
    } else if (process.platform === 'darwin') {
      cmd = 'open';
      args = [target];
    } else {
      cmd = 'xdg-open';
      args = [target];
    }
    const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    p.on('error', reject);
    p.unref();
    resolve();
  });
}
