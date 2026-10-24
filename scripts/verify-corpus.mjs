// Real-corpus smoke test: parse + render-vs-oracle + feature census for every .svga in a directory.
//   npm run verify:corpus                       # samples/corpus/ (git-ignored; the owner drops real files there)
//   npm run verify:corpus -- --dir=samples      # dry run on the repo samples
//   options: --step=10  --limit=N  --threshold=2  --browser=chromium|webkit|firefox (default chromium)
// Writes reports/corpus.json + reports/corpus.md (or corpus-<dir>.* for any other directory).
import { spawn } from 'node:child_process';
import { runInBrowser } from './lib/pw.mjs';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const samples = join(root, 'samples');
const opt = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const browser = opt('browser', 'chromium');
const dir = resolve(root, opt('dir', 'samples/corpus'));
const step = opt('step', '10');
const threshold = Number(opt('threshold', 2));
const limit = Number(opt('limit', 0));
const isDefault = dir === join(samples, 'corpus');
const explicit = process.argv.some((a) => a.startsWith('--browser='));
const tag = (isDefault ? 'corpus' : `corpus-${basename(dir)}`) + (explicit ? `-${browser}` : '');
const port = 5197;

if (relative(samples, dir).startsWith('..')) {
  console.error('The directory must be inside samples/ (the dev server only serves that folder).');
  process.exit(1);
}
mkdirSync(join(root, 'reports'), { recursive: true });

const all = existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.')).sort() : [];
let files = all.filter((f) => f.toLowerCase().endsWith('.svga') && statSync(join(dir, f)).isFile());
const skipped = all.filter((f) => !files.includes(f));
if (limit) files = files.slice(0, limit);

const report = { date: new Date().toISOString(), dir: relative(root, dir), isDryRun: !isDefault, step: Number(step), threshold, fileCount: files.length, skipped, files: [] };

if (files.length === 0) {
  console.log(`No .svga files in ${relative(root, dir)}/ yet: the corpus is waiting for files. Nothing to verify.`);
  report.note = 'corpus empty: waiting for real files';
} else {
  const vite = spawn('npx', ['vite', 'playground', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const base = `http://localhost:${port}/verify.html`;
  const run = async (query) => {
    try {
      return (await runInBrowser(browser, `${base}?${query}`, { timeout: 900000 })).result;
    } catch (e) {
      return { error: `harness failed: ${String(e.message).split('\n')[0].slice(0, 200)}` };
    }
  };
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${port}/`); break; } catch { await sleep(250); } }
    const rel = relative(samples, dir); // '' for samples/, 'corpus' for the corpus
    for (const [i, f] of files.entries()) {
      const name = rel ? `${rel}/${f}` : f;
      process.stdout.write(`[${i + 1}/${files.length}] ${f} ... `);
      const r = await run(`task=corpus&file=${encodeURIComponent(name)}&step=${step}`);
      r.file = f;
      if (r.diff && r.diff.maxPercent > threshold) r.diagnosis = await diagnose(name, r);
      report.files.push(r);
      console.log(r.parse?.ok ? (r.diff ? `max ${r.diff.maxPercent}%` : `parsed; diff failed: ${r.diffError}`) : `PARSE FAILED: ${r.parse?.message ?? r.error}`);
    }
  } finally {
    vite.kill('SIGKILL');
  }

  /** Re-renders with each oracle quirk neutralised; whichever brings the file under the threshold is the cause. */
  async function diagnose(name, r) {
    const q = `task=diff&sample=${encodeURIComponent(name)}&step=${step}`;
    const tries = [
      ['mimicOracleAlpha=1', 'svgaplayerweb skips sprites with alpha < 0.05 (we draw them)'],
      ['oracleIsolate=1', 'svgaplayerweb applies a matte to the whole canvas, erasing earlier unmasked content (we mask only the run)'],
      ['mimicOracleAlpha=1&oracleIsolate=1', 'both svgaplayerweb quirks: alpha < 0.05 cutoff and whole-canvas matte'],
    ];
    for (const [flags, why] of tries) {
      const d = await run(`${q}&${flags}`);
      if (d.maxPercent !== undefined && d.maxPercent <= threshold) return { text: why, confidence: 'proven (diff drops below threshold when the quirk is neutralised)', afterMax: d.maxPercent };
    }
    const c = r.census;
    const hints = [];
    if (c.rotated.frames) hints.push(`${c.rotated.frames} frames with a == 0 or d == 0 (rotated sprites): svgaplayerweb defaults a/d to 1 when 0`);
    if (c.shapes.arcPaths) hints.push(`${c.shapes.arcPaths} paths with arc commands: svgaplayerweb ignores A/a`);
    if (c.shapes.dashes) hints.push(`${c.shapes.dashes} dashed strokes: svgaplayerweb builds a different dash array`);
    if (c.shapes.strokes) hints.push(`${c.shapes.strokes} strokes: svgaplayerweb draws zero-width strokes at width 1`);
    if (c.shapes.roundedRects) hints.push(`${c.shapes.roundedRects} rounded rects`);
    return hints.length
      ? { text: `likely: ${hints.join('; ')}`, confidence: 'heuristic (from the feature census, not proven)' }
      : { text: 'unexplained: needs a manual look (npm run playground, /compare.html)', confidence: 'none' };
  }
}

// ---- summary -----------------------------------------------------------------------------------
const parsed = report.files.filter((f) => f.parse?.ok);
const failed = report.files.filter((f) => !f.parse?.ok);
const diffed = parsed.filter((f) => f.diff);
const over = diffed.filter((f) => f.diff.maxPercent > threshold);
const noDiff = parsed.filter((f) => !f.diff);
const sum = (sel) => parsed.reduce((n, f) => n + (sel(f.census) || 0), 0);
const withFeature = (sel) => parsed.filter((f) => sel(f.census) > 0).length;
const FEATURES = [
  ['rotated sprites (a == 0 or d == 0)', (c) => c.rotated.frames, 'frames', (c) => c.rotated.sprites],
  ['rotated / skewed sprites (b or c != 0)', (c) => c.skewedOrRotated.frames, 'frames', (c) => c.skewedOrRotated.sprites],
  ['strokes (width > 0)', (c) => c.shapes.strokes, 'shapes'],
  ['dashed strokes', (c) => c.shapes.dashes, 'shapes'],
  ['arc path commands (A/a)', (c) => c.shapes.arcPaths, 'paths'],
  ['rounded rects', (c) => c.shapes.roundedRects, 'rects'],
  ['vector shapes (any)', (c) => c.shapes.unique, 'shapes'],
  ['clipPath', (c) => c.clipPathFrames, 'frames'],
  ['mattes', (c) => c.mattes.matteSprites, 'matte sprites'],
  ['dangling matteKeys', (c) => (c.mattes.danglingMatteKeys ? 1 : 0), 'files'],
  ['audio', (c) => c.audios, 'clips'],
  ['replaceable-looking keys', (c) => c.replaceableLookingKeys.length, 'keys'],
];
const md = [];
md.push(`# Corpus report${report.isDryRun ? ' (DRY RUN on ' + report.dir + '/)' : ''}`, '');
md.push(`${report.date} · dir \`${report.dir}/\` · every ${step}th frame · threshold ${threshold}% of canvas pixels`, '');
if (report.note) md.push(`> ${report.note}`, '');
else {
  md.push(`**${report.fileCount} files**: ${parsed.length} parsed, ${failed.length} parse failures, ${diffed.length} rendered against the oracle, ${noDiff.length} parsed but not diffed, ${over.length} over ${threshold}%.`);
  if (skipped.length) md.push('', `Skipped (not .svga): ${skipped.join(', ')}`);
  md.push('', '## Failures', '');
  if (!failed.length && !noDiff.length) md.push('None.');
  for (const f of failed) md.push(`- **${f.file}**: parse failed: \`${f.parse?.code ?? ''}\` ${f.parse?.message ?? f.error}`);
  for (const f of noDiff) md.push(`- **${f.file}**: parsed OK but the oracle comparison failed: ${f.diffError}`);
  md.push('', `## Files above ${threshold}% max diff`, '');
  if (!over.length) md.push('None.');
  else {
    md.push('| file | mean % | max % | worst frame | diagnosis | confidence |', '|---|---|---|---|---|---|');
    for (const f of over) md.push(`| ${f.file} | ${f.diff.meanPercent} | ${f.diff.maxPercent} | ${f.diff.worstFrame} | ${f.diagnosis.text} | ${f.diagnosis.confidence} |`);
  }
  md.push('', '## All files', '', '| file | mean % | max % | worst | warnings |', '|---|---|---|---|---|');
  for (const f of parsed) md.push(`| ${f.file} | ${f.diff?.meanPercent ?? '-'} | ${f.diff?.maxPercent ?? '-'} | ${f.diff?.worstFrame ?? '-'} | ${f.parse.warnings.length} |`);
  md.push('', '## Feature census', '', `Over the ${parsed.length} parsed files.`, '', '| feature | files with it | total |', '|---|---|---|');
  for (const [label, sel, unit, sprites] of FEATURES) md.push(`| ${label} | ${withFeature(sel)} | ${sum(sel)} ${unit}${sprites ? ` (${sum(sprites)} sprites)` : ''} |`);
  const keys = [...new Set(parsed.flatMap((f) => f.census.replaceableLookingKeys))].sort();
  md.push('', `Replaceable-looking keys seen: ${keys.length ? keys.slice(0, 60).map((k) => `\`${k}\``).join(', ') : 'none'}`);
}
writeFileSync(join(root, `reports/${tag}.json`), JSON.stringify(report, null, 2) + '\n');
writeFileSync(join(root, `reports/${tag}.md`), md.join('\n') + '\n');
console.log(`\nWrote reports/${tag}.json and reports/${tag}.md`);
if (!report.note) console.log(`${parsed.length}/${report.fileCount} parsed, ${over.length} over ${threshold}%, ${failed.length} parse failures`);
