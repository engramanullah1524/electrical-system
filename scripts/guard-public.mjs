// This repository is PUBLIC. Refuse to let private material be committed:
// regulation text and PDFs, drawings, spreadsheets, the user's licensed tables,
// project notes, and anything that looks like a secret.
// Checks what git is tracking or has staged, so run it after `git add`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const BLOCKED_PATHS = [
  /^private\//,
  /^library\/raw\//,
  /^datapacks\//,
  /\.(pdf|xlsx?|xlsm|csv|docx?|dwg|dxf|dwf|zip|rar|7z|jks|keystore)$/i,
];

const SECRETS = [
  /script\.google\.com\/macros\/s\/AKfy/, // an Apps Script deployment URL
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

// Client, project and person names live only in this gitignored file, so the
// guard itself never publishes them. CI has no copy and checks the rest.
const TERMS_FILE = 'private/forbidden-terms.txt';
const terms = existsSync(TERMS_FILE)
  ? readFileSync(TERMS_FILE, 'utf8')
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter((t) => t && !t.startsWith('#'))
      // Whole-word, case-insensitive: short names must not match inside ordinary words.
      .map((t) => new RegExp(`(?<![A-Za-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i'))
  : [];

// Lock files hold only package names and base64 hashes, where short names turn up by chance.
const TERM_EXEMPT = new Set(['package-lock.json']);

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const problems = [];

for (const file of files) {
  if (BLOCKED_PATHS.some((rule) => rule.test(file))) {
    problems.push(`${file}: this kind of file must stay private`);
    continue;
  }
  if (/\.(png|ico|woff2?)$/i.test(file) || !existsSync(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const rule of SECRETS) if (rule.test(text)) problems.push(`${file}: looks like a secret (${rule.source})`);
  if (TERM_EXEMPT.has(file)) continue;
  for (const term of terms) if (term.test(text)) problems.push(`${file}: mentions a private name`);
}

if (problems.length) {
  console.error('Public-repo guard failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`Public-repo guard passed: ${files.length} files checked${terms.length ? `, ${terms.length} private terms` : ' (no local term list)'}.`);
