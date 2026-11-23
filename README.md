# Folio

A PDF editor you run on your own machine. The browser does the viewing and editing,
and a small Node server stores your files, autosaves your work, and builds the edited PDF.

## Run it

You need Node 18 or newer (`node -v` to check; `brew install node` on a Mac if it's missing).

```bash
cd folio
npm install
npm start
```

Your browser opens at http://localhost:5180. Stop the server with Ctrl+C.

You can set a different port with `PORT=3000 npm start`, or skip opening the browser
with `FOLIO_NO_OPEN=1 npm start`.

## What it does

- **Annotate:** text (Helvetica, Times, Courier), freehand drawing, highlights, boxes, ellipses, arrows, whiteout, signatures (drawn or typed), and images
- **Edit marks:** in Select mode, drag to move and use the corner handle to resize. Double-click text to edit it, Delete removes a mark, arrow keys nudge it (hold Shift for 10 pt)
- **Pages:** rotate, reorder (drag the thumbnails), duplicate, insert blank pages, delete pages, and save selected pages as their own PDF
- **Merge:** append pages from other PDFs
- **Find:** search text across pages, step through matches, or highlight every match at once
- **Save PDF:** the server flattens your marks into the file and the browser downloads it
- **Autosave:** your open document and marks are saved to `data/` every second or so, so a refresh or a server restart picks up where you left off. **Reset** goes back to the sample

Shortcuts: V select, T text, P draw, H highlight, R box, O ellipse, A arrow, W whiteout,
Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z redo, Ctrl/Cmd+S save, Ctrl/Cmd+F find, + and - to zoom.

## How it's built

```
server.js          Express server: static files, uploads, autosave, export
lib/build-pdf.js   pdf-lib: copies original pages, applies rotation, draws every mark
lib/sample.js      generates the sample agreement shown on first run
public/            the editor (index.html, style.css, app.js), rendered with pdf.js
data/              created on first run: uploads/ and session.json
```

| Endpoint | What it does |
| --- | --- |
| `POST /api/files` | upload an original PDF (raw body), returns `{id}` |
| `GET /api/files/:id` | fetch an uploaded PDF |
| `GET` / `PUT` / `DELETE /api/session` | read, autosave, or clear the editor state |
| `POST /api/sample` | create the sample document |
| `POST /api/export` | `{filename, docs, pages, imgs}` in, edited PDF out (as an attachment) |

Coordinates: the editor stores marks in points with the page as displayed (y down).
`lib/build-pdf.js` maps them back to PDF user space the same way pdf.js's viewport does,
so marks land exactly where you drew them, including on rotated pages.

Everything runs offline. pdf.js and the fonts are served from `node_modules`, so no CDN is needed.
The server only listens on localhost.

## Limits

- Whiteout covers content visually. The text underneath stays in the file, so it is **not** redaction.
- Text you add uses the standard PDF fonts, which cover Latin characters. Other scripts are saved as "?".
- It doesn't edit the PDF's own text or fill existing form fields, and it won't open password-protected files.
- pdf.js 3.11 is pinned and runs with `isEvalSupported: false`, which is the documented mitigation for CVE-2024-4367.
