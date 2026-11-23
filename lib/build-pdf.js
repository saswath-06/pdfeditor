// Builds the edited PDF on the server: copies the original pages, applies
// rotation, and flattens every annotation into real PDF content.
const { PDFDocument, StandardFonts, rgb, degrees, BlendMode, LineCapStyle } = require('pdf-lib');

const norm = a => (((Math.round((a || 0) / 90) * 90) % 360) + 360) % 360;

// Same visible box pdf.js uses: crop box clipped to the media box.
function viewOf(page) {
  const m = page.getMediaBox(), c = page.getCropBox();
  const x0 = Math.max(m.x, c.x), y0 = Math.max(m.y, c.y);
  const x1 = Math.min(m.x + m.width, c.x + c.width), y1 = Math.min(m.y + m.height, c.y + c.height);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : [m.x, m.y, m.x + m.width, m.y + m.height];
}

// Display coordinates (points, y down, as the editor shows the page) to PDF
// user space. Mirrors pdf.js PageViewport.convertToPdfPoint at scale 1.
function toUser([x0, y0, x1, y1], r) {
  return (dx, dy) =>
    r === 0 ? [x0 + dx, y1 - dy] :
    r === 90 ? [x0 + dy, y0 + dx] :
    r === 180 ? [x1 - dx, y0 + dy] :
    [x1 - dy, y1 - dx];
}

const hex = x => {
  const n = parseInt(String(x || '#000000').slice(1, 7), 16) || 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const arrowHead = a => {
  const g = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), l = Math.max(10, a.sw * 4), s = 0.45;
  return [[a.x2 - l * Math.cos(g - s), a.y2 - l * Math.sin(g - s)], [a.x2 - l * Math.cos(g + s), a.y2 - l * Math.sin(g + s)]];
};

// Standard PDF fonts only cover Latin-1 plus a few symbols; swap the rest.
const clean = (s, font) => [...String(s).replace(/\t/g, '    ')].map(ch => {
  try { font.encodeText(ch); return ch; } catch { return '?'; }
}).join('');

async function drawAnn(out, page, a, U, total, fonts, imgs, embedded) {
  const c = a.c ? hex(a.c) : undefined;
  const R = () => {
    const [x1, y1] = U(a.x, a.y), [x2, y2] = U(a.x + a.w, a.y + a.h);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  };
  // drawSvgPath flips y, so feed it negated user-space y with origin (0, 0).
  const path = pts => pts.map(([x, y], i) => {
    const [u, v] = U(x, y);
    return (i ? 'L' : 'M') + u.toFixed(2) + ' ' + (-v).toFixed(2);
  }).join(' ');
  const stroke = { x: 0, y: 0, borderColor: c, borderWidth: a.sw, borderLineCap: LineCapStyle.Round };

  switch (a.t) {
    case 'box': page.drawRectangle({ ...R(), borderColor: c, borderWidth: a.sw }); break;
    case 'hl': page.drawRectangle({ ...R(), color: c, opacity: 0.4, blendMode: BlendMode.Multiply }); break;
    case 'white': page.drawRectangle({ ...R(), color: rgb(1, 1, 1) }); break;
    case 'ellipse': {
      const r = R();
      page.drawEllipse({ x: r.x + r.width / 2, y: r.y + r.height / 2, xScale: r.width / 2, yScale: r.height / 2, borderColor: c, borderWidth: a.sw });
      break;
    }
    case 'pen': {
      const pts = a.pts.length > 1 ? a.pts : [a.pts[0], [a.pts[0][0] + 0.1, a.pts[0][1]]];
      page.drawSvgPath(path(pts), stroke);
      break;
    }
    case 'arrow': {
      const [h1, h2] = arrowHead(a);
      page.drawSvgPath(path([[a.x1, a.y1], [a.x2, a.y2]]) + ' ' + path([h1, [a.x2, a.y2], h2]), stroke);
      break;
    }
    case 'text': {
      const font = fonts[a.f] || fonts.sans;
      String(a.text).split('\n').forEach((line, i) => {
        const s = clean(line, font);
        if (!s.trim()) return;
        const [x, y] = U(a.x, a.y + a.size * (1 + 1.2 * i));
        page.drawText(s, { x, y, size: a.size, font, color: c, rotate: degrees(total) });
      });
      break;
    }
    case 'img': {
      if (!imgs[a.img]) break;
      if (!embedded[a.img]) embedded[a.img] = await out.embedPng(imgs[a.img]);
      const [x, y] = U(a.x, a.y + a.h);
      page.drawImage(embedded[a.img], { x, y, width: a.w, height: a.h, rotate: degrees(total) });
      break;
    }
  }
}

/**
 * @param {object} o
 * @param {Array} o.pages   editor page records: {doc, idx, rot, w0, h0, base?, view?, anns}
 * @param {Function} o.readDoc  (docIndex) => Promise<Uint8Array> original bytes
 * @param {object} o.imgs   imageId -> PNG data URI
 */
async function buildPdf({ pages, readDoc, imgs = {} }) {
  const out = await PDFDocument.create();
  const fonts = {
    sans: await out.embedFont(StandardFonts.Helvetica),
    serif: await out.embedFont(StandardFonts.TimesRoman),
    mono: await out.embedFont(StandardFonts.Courier),
  };
  const need = new Map(), src = new Map(), copied = new Map(), used = new Set(), embedded = {};

  for (const p of pages) if (p.doc >= 0) {
    if (!need.has(p.doc)) need.set(p.doc, new Set());
    need.get(p.doc).add(p.idx);
  }
  // Copy each source's pages in one go so shared fonts and images are copied once.
  for (const [d, set] of need) {
    const doc = await PDFDocument.load(await readDoc(d), { ignoreEncryption: true });
    src.set(d, doc);
    const idx = [...set], cp = await out.copyPages(doc, idx);
    idx.forEach((v, i) => copied.set(d + ':' + v, { page: cp[i], orig: doc.getPage(v) }));
  }

  for (const p of pages) {
    let page, view, base;
    if (p.doc < 0) {
      page = out.addPage([p.w0, p.h0]);
      view = [0, 0, p.w0, p.h0];
      base = 0;
    } else {
      const k = p.doc + ':' + p.idx, entry = copied.get(k);
      if (!entry) throw new Error(`Missing page ${p.idx + 1} of source ${p.doc}`);
      let cp = entry.page;
      if (used.has(k)) [cp] = await out.copyPages(src.get(p.doc), [p.idx]); // a duplicated page needs its own copy
      used.add(k);
      page = out.addPage(cp);
      view = Array.isArray(p.view) && p.view.length === 4 ? p.view : viewOf(entry.orig);
      base = typeof p.base === 'number' ? norm(p.base) : norm(entry.orig.getRotation().angle);
    }
    const total = (base + norm(p.rot)) % 360;
    page.setRotation(degrees(total));
    const U = toUser(view, total);
    for (const a of p.anns || []) await drawAnn(out, page, a, U, total, fonts, imgs, embedded);
  }
  return out.save();
}

module.exports = { buildPdf, toUser, viewOf };
