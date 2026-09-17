// Extracts the text of the user's local source PDFs into library/raw/<source-id>/, one file per
// PDF page (p0001.txt …), so clauses can be found with grep instead of re-reading whole documents.
// library/raw/ is gitignored: regulation text is copyrighted and is never published.
//
// Reads the id → PDF path map from private/sources-local.json (also gitignored).
// Needs pdftotext (xpdf or poppler) on PATH.  Usage: node scripts/extract-sources.mjs [id ...]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP_FILE = 'private/sources-local.json';
if (!existsSync(MAP_FILE)) {
  console.error(`Missing ${MAP_FILE}: a JSON object of source id -> local PDF path.`);
  process.exit(1);
}

const map = JSON.parse(readFileSync(MAP_FILE, 'utf8'));
const wanted = process.argv.slice(2);
const ids = wanted.length ? wanted : Object.keys(map);

// A map entry is either a path, or { "pdf": path, "mode": "table" | "reading" }.
// "table" suits single-column documents with tables; "reading" follows multi-column pages in order.
const MODE_FLAGS = { table: ['-table'], reading: [] };

for (const id of ids) {
  const entry = typeof map[id] === 'string' ? { pdf: map[id], mode: 'table' } : (map[id] ?? {});
  const { pdf, mode = 'table' } = entry;
  if (!pdf || !existsSync(pdf)) {
    console.error(`${id}: file not found (${pdf})`);
    process.exitCode = 1;
    continue;
  }
  const bytes = readFileSync(pdf);
  // pdftotext separates pages with a form feed, so one run gives every page. Table mode keeps
  // table rows together; layout mode split DEWA's maximum-demand table into two columns.
  const text = execFileSync('pdftotext', [...(MODE_FLAGS[mode] ?? MODE_FLAGS.table), '-enc', 'UTF-8', pdf, '-'], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'], // font-table warnings are noise, not failures
  });
  const pages = text.split('\f');
  if (pages.at(-1)?.trim() === '') pages.pop();

  const dir = join('library', 'raw', id);
  mkdirSync(dir, { recursive: true });
  // Empty the folder rather than deleting it: Windows refuses to remove a folder a shell is in.
  for (const old of readdirSync(dir)) rmSync(join(dir, old), { force: true });
  pages.forEach((page, i) => writeFileSync(join(dir, `p${String(i + 1).padStart(4, '0')}.txt`), page));
  writeFileSync(
    join(dir, 'index.json'),
    JSON.stringify(
      {
        id,
        pdf,
        mode,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        pages: pages.length,
        emptyPages: pages.filter((p) => p.trim().length < 20).length,
        extractedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`${id}: ${pages.length} pages -> ${dir}`);
}
