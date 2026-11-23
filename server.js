// Folio: PDF editor. Serves the web app, stores uploads and the autosaved
// session on disk, and builds the edited PDF for download.
const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { buildPdf } = require('./lib/build-pdf');
const { buildSample } = require('./lib/sample');

// Railway sets RAILWAY_PROJECT_ID in every deployment. There the app accepts
// outside connections, keeps files on the attached volume, and gives every
// browser its own private workspace (no sign-in). Run locally, there is one
// workspace in DATA, as before.
const ON_RAILWAY = !!process.env.RAILWAY_PROJECT_ID;
const PER_VISITOR = ON_RAILWAY || !!process.env.FOLIO_PER_VISITOR;
const PORT = Number(process.env.PORT) || 5180;
const HOST = process.env.HOST || (ON_RAILWAY ? '0.0.0.0' : '127.0.0.1');
const DATA = process.env.FOLIO_DATA || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const KEEP_DAYS = Number(process.env.FOLIO_KEEP_DAYS) || 30;
const WORKSPACES = path.join(DATA, 'ws');
const ID = /^[a-f0-9]{24}$/;
const COOKIE = 'folio_ws';
const WS_ID = /^[a-f0-9]{32}$/;

if (ON_RAILWAY && !process.env.FOLIO_DATA && !process.env.RAILWAY_VOLUME_MOUNT_PATH)
  console.warn('No volume attached: uploads and autosave will be lost on every redeploy.');
fs.mkdirSync(PER_VISITOR ? WORKSPACES : path.join(DATA, 'uploads'), { recursive: true });

const app = express();
app.disable('x-powered-by');
if (ON_RAILWAY) app.set('trust proxy', true); // so req.secure sees Railway's HTTPS

// Health check for Railway.
app.get('/healthz', (req, res) => res.send('ok'));

// Each browser gets a random, unguessable workspace id in a cookie, set when it
// first loads the page. Folders are only created once something is saved.
const cookieOpts = req => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 400 * 864e5, path: '/' });
if (PER_VISITOR) {
  app.use((req, res, next) => {
    const m = /(?:^|;\s*)folio_ws=([a-f0-9]{32})(?:;|$)/.exec(req.get('cookie') || '');
    req.wsId = m ? m[1] : crypto.randomBytes(16).toString('hex');
    if (!m) res.cookie(COOKIE, req.wsId, cookieOpts(req));
    next();
  });
}

const pkgDir = name => path.dirname(require.resolve(name + '/package.json'));
const forever = { maxAge: '30d', immutable: true };
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/pdfjs', express.static(path.join(pkgDir('pdfjs-dist'), 'build'), forever));
app.use('/vendor/fonts/literata', express.static(pkgDir('@fontsource/literata'), forever));
app.use('/vendor/fonts/caveat', express.static(pkgDir('@fontsource/caveat'), forever));

// Paths for the workspace this request belongs to.
function ws(req) {
  const dir = PER_VISITOR && WS_ID.test(req.wsId) ? path.join(WORKSPACES, req.wsId) : DATA;
  const uploads = path.join(dir, 'uploads');
  return { dir, uploads, session: path.join(dir, 'session.json'), file: id => path.join(uploads, id + '.pdf') };
}
const ensure = w => fsp.mkdir(w.uploads, { recursive: true });

const newId = () => crypto.randomBytes(12).toString('hex');
const isPdf = buf => buf && buf.length > 4 && buf.subarray(0, 1024).includes('%PDF');
async function writeAtomic(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

// Upload an original PDF. Body is the raw file.
app.post('/api/files', express.raw({ type: () => true, limit: '300mb' }), async (req, res) => {
  if (!isPdf(req.body)) return res.status(400).json({ error: 'That file is not a PDF' });
  const w = ws(req), id = newId();
  await ensure(w);
  await fsp.writeFile(w.file(id), req.body);
  res.json({ id });
});

app.get('/api/files/:id', (req, res) => {
  if (!ID.test(req.params.id)) return res.sendStatus(400);
  res.sendFile(ws(req).file(req.params.id), { headers: { 'Content-Type': 'application/pdf' } }, err => {
    if (err && !res.headersSent) res.sendStatus(404);
  });
});

// First run: generate the sample agreement and store it like an upload.
app.post('/api/sample', async (req, res) => {
  try {
    const { bytes, anns } = await buildSample();
    const w = ws(req), id = newId();
    await ensure(w);
    await fsp.writeFile(w.file(id), bytes);
    res.json({ id, name: 'studio-rental-agreement.pdf', anns });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not create the sample' });
  }
});

// Autosaved editor state: open documents, pages, marks and images.
app.get('/api/session', async (req, res) => {
  try { res.type('json').send(await fsp.readFile(ws(req).session, 'utf8')); }
  catch { res.json(null); }
});

app.put('/api/session', express.json({ limit: '300mb' }), async (req, res) => {
  const s = req.body;
  if (!s || !Array.isArray(s.docs) || !Array.isArray(s.pages) || s.docs.some(d => !ID.test(d.id)))
    return res.status(400).json({ error: 'Bad session' });
  const w = ws(req);
  await ensure(w);
  await writeAtomic(w.session, JSON.stringify(s));
  if (PER_VISITOR) res.cookie(COOKIE, req.wsId, cookieOpts(req)); // keep an active workspace's cookie fresh
  res.json({ ok: true, savedAt: new Date().toISOString() });
  cleanUploads(w.uploads, new Set(s.docs.map(d => d.id))).catch(() => {});
});

app.delete('/api/session', async (req, res) => {
  await fsp.rm(ws(req).session, { force: true });
  res.json({ ok: true });
});

// Drop uploads the session no longer uses (after an hour, so nothing in flight is lost).
async function cleanUploads(dir, keep) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const f of await fsp.readdir(dir)) {
    const id = f.replace(/\.pdf$/, '');
    if (!ID.test(id) || keep.has(id)) continue;
    const st = await fsp.stat(path.join(dir, f));
    if (st.mtimeMs < cutoff) await fsp.rm(path.join(dir, f), { force: true });
  }
}

// Delete workspaces nobody has touched in KEEP_DAYS, so the volume doesn't fill up.
// A workspace folder's modified time moves every time its session autosaves.
async function sweepWorkspaces() {
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  for (const id of await fsp.readdir(WORKSPACES)) {
    if (!WS_ID.test(id)) continue;
    const dir = path.join(WORKSPACES, id);
    const st = await fsp.stat(dir).catch(() => null);
    if (st && st.mtimeMs < cutoff) await fsp.rm(dir, { recursive: true, force: true });
  }
}
if (PER_VISITOR) {
  const sweep = () => sweepWorkspaces().catch(e => console.error('Workspace sweep failed:', e));
  sweep();
  setInterval(sweep, 6 * 60 * 60 * 1000).unref();
}

// Build the edited PDF and send it back as a download.
app.post('/api/export', express.json({ limit: '300mb' }), async (req, res) => {
  try {
    const { pages, docs, imgs, filename } = req.body || {};
    if (!Array.isArray(pages) || !pages.length) return res.status(400).json({ error: 'No pages to save' });
    if (!Array.isArray(docs) || docs.some(id => !ID.test(id))) return res.status(400).json({ error: 'Bad document list' });
    const w = ws(req);
    const bytes = await buildPdf({
      pages,
      imgs: imgs || {},
      readDoc: d => {
        if (!docs[d]) throw new Error('Unknown source document');
        return fsp.readFile(w.file(docs[d]));
      },
    });
    const name = String(filename || 'document.pdf').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 200) || 'document.pdf';
    const ascii = name.replace(/[^\x20-\x7e]/g, '_');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Length': bytes.length,
    });
    res.end(Buffer.from(bytes));
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'The original PDF is no longer on the server' });
    console.error('Export failed:', e);
    res.status(500).json({ error: e.message || 'Export failed' });
  }
});

app.listen(PORT, HOST, () => {
  if (ON_RAILWAY) return console.log(`Folio listening on ${HOST}:${PORT}, data in ${DATA}`);
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Folio is running at ${url}\n  Your files and autosave live in ${DATA}\n  Press Ctrl+C to stop.\n`);
  if (process.env.FOLIO_NO_OPEN) return;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
});
