// Folio: local PDF editor. Serves the web app, stores uploads and your
// autosaved session on disk, and builds the edited PDF for download.
const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { buildPdf } = require('./lib/build-pdf');
const { buildSample } = require('./lib/sample');

// Railway sets RAILWAY_PROJECT_ID in every deployment. There the app must accept
// outside connections and keep its files on the attached volume. There is no
// sign-in: everyone with the URL shares one workspace.
const ON_RAILWAY = !!process.env.RAILWAY_PROJECT_ID;
const PORT = Number(process.env.PORT) || 5180;
const HOST = process.env.HOST || (ON_RAILWAY ? '0.0.0.0' : '127.0.0.1');
const DATA = process.env.FOLIO_DATA || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const SESSION = path.join(DATA, 'session.json');
const ID = /^[a-f0-9]{24}$/;

if (ON_RAILWAY && !process.env.FOLIO_DATA && !process.env.RAILWAY_VOLUME_MOUNT_PATH)
  console.warn('No volume attached: uploads and autosave will be lost on every redeploy.');
fs.mkdirSync(UPLOADS, { recursive: true });

const app = express();
app.disable('x-powered-by');

// Health check for Railway.
app.get('/healthz', (req, res) => res.send('ok'));

const pkgDir = name => path.dirname(require.resolve(name + '/package.json'));
const forever = { maxAge: '30d', immutable: true };
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/pdfjs', express.static(path.join(pkgDir('pdfjs-dist'), 'build'), forever));
app.use('/vendor/fonts/literata', express.static(pkgDir('@fontsource/literata'), forever));
app.use('/vendor/fonts/caveat', express.static(pkgDir('@fontsource/caveat'), forever));

const uploadPath = id => path.join(UPLOADS, id + '.pdf');
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
  const id = newId();
  await fsp.writeFile(uploadPath(id), req.body);
  res.json({ id });
});

app.get('/api/files/:id', (req, res) => {
  if (!ID.test(req.params.id)) return res.sendStatus(400);
  res.sendFile(uploadPath(req.params.id), { headers: { 'Content-Type': 'application/pdf' } }, err => {
    if (err && !res.headersSent) res.sendStatus(404);
  });
});

// First run: generate the sample agreement and store it like an upload.
app.post('/api/sample', async (req, res) => {
  try {
    const { bytes, anns } = await buildSample();
    const id = newId();
    await fsp.writeFile(uploadPath(id), bytes);
    res.json({ id, name: 'studio-rental-agreement.pdf', anns });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not create the sample' });
  }
});

// Autosaved editor state: open documents, pages, marks and images.
app.get('/api/session', async (req, res) => {
  try { res.type('json').send(await fsp.readFile(SESSION, 'utf8')); }
  catch { res.json(null); }
});

app.put('/api/session', express.json({ limit: '300mb' }), async (req, res) => {
  const s = req.body;
  if (!s || !Array.isArray(s.docs) || !Array.isArray(s.pages) || s.docs.some(d => !ID.test(d.id)))
    return res.status(400).json({ error: 'Bad session' });
  await writeAtomic(SESSION, JSON.stringify(s));
  res.json({ ok: true, savedAt: new Date().toISOString() });
  cleanUploads(new Set(s.docs.map(d => d.id))).catch(() => {});
});

app.delete('/api/session', async (req, res) => {
  await fsp.rm(SESSION, { force: true });
  res.json({ ok: true });
});

// Drop uploads the session no longer uses (after an hour, so nothing in flight is lost).
async function cleanUploads(keep) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const f of await fsp.readdir(UPLOADS)) {
    const id = f.replace(/\.pdf$/, '');
    if (!ID.test(id) || keep.has(id)) continue;
    const st = await fsp.stat(path.join(UPLOADS, f));
    if (st.mtimeMs < cutoff) await fsp.rm(path.join(UPLOADS, f), { force: true });
  }
}

// Build the edited PDF and send it back as a download.
app.post('/api/export', express.json({ limit: '300mb' }), async (req, res) => {
  try {
    const { pages, docs, imgs, filename } = req.body || {};
    if (!Array.isArray(pages) || !pages.length) return res.status(400).json({ error: 'No pages to save' });
    if (!Array.isArray(docs) || docs.some(id => !ID.test(id))) return res.status(400).json({ error: 'Bad document list' });
    const bytes = await buildPdf({
      pages,
      imgs: imgs || {},
      readDoc: d => {
        if (!docs[d]) throw new Error('Unknown source document');
        return fsp.readFile(uploadPath(docs[d]));
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
