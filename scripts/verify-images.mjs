// Phase 4 browser verification for GIF / animated WebP, in Chromium, WebKit and Firefox (Playwright).
//   npm run verify:images [-- --browsers=chromium,webkit,firefox --cycles=50 --no-corpus]
// Reference data: frames dumped from Chromium's WebCodecs ImageDecoder (samples/.golden/, git-ignored) for the
// synthetic files; for real files each browser uses its own ImageDecoder where it has one.
// Writes reports/phase4-images.json and reports/phase4-images.md. Exit code 1 if anything unexpected fails.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInBrowser } from './lib/pw.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const opt = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const browsers = (opt('browser', null) ?? opt('browsers', 'chromium,webkit,firefox')).split(','); // --browser=webkit or --browsers=chromium,webkit
const cycles = opt('cycles', '50');
const withCorpus = !process.argv.includes('--no-corpus');
const port = 5195;
const base = `http://localhost:${port}`;

const vite = spawn('npx', ['vite', 'playground', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (task, params = {}) => `${base}/verify-images.html?${new URLSearchParams({ task, ...params })}`;
const list = async (dir) => (await (await fetch(`${base}/__list/${dir}`)).json());

let failures = 0;
const report = { date: new Date().toISOString(), cycles: Number(cycles), browsers: {} };

try {
  for (let i = 0; i < 80; i++) { try { await fetch(base); break; } catch { await sleep(250); } }
  const synthetic = (await list('synthetic')).map((f) => `synthetic/${f}`);
  const real = ['rotating-earth.gif', 'animated.webp', 'static.webp'];
  const corpus = withCorpus ? (await list('corpus')).filter((f) => /\.(gif|webp)$/i.test(f)).map((f) => `corpus/${f}`) : [];
  report.files = { synthetic: synthetic.length, real: real.length, corpus: corpus.length };

  // 1. golden frames from the reference browser
  console.log('golden: dumping synthetic frames from Chromium ImageDecoder ...');
  mkdirSync(join(root, 'samples/.golden'), { recursive: true });
  const save = (golden) => { for (const [file, data] of Object.entries(golden)) writeFileSync(join(root, 'samples/.golden', `${file.replace(/\//g, '__')}.json`), JSON.stringify(data)); return Object.keys(golden).length; };
  // synthetic files: every frame; real / corpus files: 6 evenly spaced frames (keeps the dump small)
  const nSyn = save((await runInBrowser('chromium', url('dumpgolden', { files: synthetic.join(',') }), { timeout: 120000 })).result);
  const nReal = save((await runInBrowser('chromium', url('dumpgolden', { files: [...real, ...corpus].join(','), max: 6 }), { timeout: 600000 })).result);
  console.log(`golden: ${nSyn} synthetic (all frames) + ${nReal} real/corpus (6 frames each)`);

  // 2. every browser
  for (const b of browsers) {
    const R = (report.browsers[b] = {});
    const run = async (task, params, timeout = 600000) => (await runInBrowser(b, url(task, params), { timeout })).result;
    try {
      const probe = await runInBrowser(b, url('support'), { timeout: 60000 });
      R.version = probe.version;
      R.support = probe.result;
    } catch (e) {
      R.unavailable = String(e.message).split('\n').find((l) => /Could not|Failed|error|Error/.test(l))?.trim() ?? String(e.message).split('\n')[0];
      console.log(`${b}: UNAVAILABLE (${R.unavailable})`);
      continue;
    }
    console.log(`${b} ${R.version}: running ...`);
    R.correctSynthetic = await run('correct', { files: synthetic.join(','), paths: 'auto,imagedecoder,fallback', oracle: 'golden' });
    R.correctReal = await run('correct', { files: [...real, ...corpus].join(','), paths: 'auto,imagedecoder,fallback', oracle: b === 'chromium' ? 'local' : 'golden' });
    R.timing = await run('timing', { files: ['synthetic/gif-delays.gif', 'synthetic/webp-delays.webp', 'synthetic/gif-mixed.gif', 'synthetic/webp-mixed-codecs.webp', 'rotating-earth.gif', 'animated.webp'].join(','), paths: 'imagedecoder,fallback' });
    R.loops = await run('loops', {});
    R.leaks = await run('leaks', { files: ['rotating-earth.gif', 'animated.webp', 'synthetic/gif-mixed.gif', 'synthetic/webp-mixed-codecs.webp'].join(','), paths: 'imagedecoder,fallback', cycles });
  }
} finally {
  vite.kill('SIGKILL');
}

// ---- classify + report -------------------------------------------------------------------------
const short = (f) => f.replace(/^synthetic\//, 's/').replace(/^corpus\//, 'c/').slice(0, 44);
// Documented, expected deviations of the browser's own ImageDecoder (our `auto` mode routes around them):
//  - a decoder that failed its self-test (WebKit: WebP alpha / GIF disposal)
//  - single-frame images forced through ImageDecoder (auto uses createImageBitmap for those): the VideoFrame's YUV->RGB
//    conversion differs slightly from the reference canvas path
const knownIssue = (R, row) =>
  row.path === 'imagedecoder' &&
  ((R.support && row.file.endsWith('.webp') && R.support.imageDecoderWebpAlphaReliable === false) ||
    (R.support && row.file.endsWith('.gif') && R.support.imageDecoderGifDisposalReliable === false) ||
    row.frames === 1);
const md = [`# Phase 4: GIF / animated WebP verification`, '', `${report.date} · ${report.files.synthetic} synthetic + ${report.files.real} real + ${report.files.corpus} corpus files · leak cycles ${cycles}`, ''];

md.push('## Browser support', '', '| browser | ImageDecoder (gif / webp) | self-tests: GIF disposal / WebP alpha | createImageBitmap(WebP) | path for GIF | path for animated WebP | still / 1-frame |', '|---|---|---|---|---|---|---|');
for (const [b, R] of Object.entries(report.browsers)) {
  if (R.unavailable) { md.push(`| ${b} | **could not be launched here**: ${R.unavailable} | | | | | |`); continue; }
  const s = R.support;
  md.push(`| ${b} ${R.version} | ${s.imageDecoder ? `${s.imageDecoderGif ? 'yes' : 'no'} / ${s.imageDecoderWebp ? 'yes' : 'no'}` : 'not available'} | ${s.imageDecoder ? `${s.imageDecoderGifDisposalReliable ? 'pass' : '**FAIL**'} / ${s.imageDecoderWebpAlphaReliable ? 'pass' : '**FAIL**'}` : 'n/a'} | ${s.createImageBitmapWebp ? 'yes' : 'no'} | ${s.autoPathGif} | ${s.autoPathAnimatedWebp} | ${s.autoPathStillWebp} / ${s.autoPathSingleFrameGif} |`);
}

const cell = (R, r) => {
  if (!r) return '-';
  if (r.skipped) return 'skipped';
  if (r.error) { if (!knownIssue(R, r)) failures++; return `ERROR`; }
  if (r.ok) return `ok (Δ${r.maxDelta})`;
  if (knownIssue(R, r)) return `known (${r.mismatchedFrames}/${r.checked} Δ${r.maxDelta})`;
  failures++;
  return `**FAIL** ${r.mismatchedFrames}/${r.checked} Δ${r.maxDelta}`;
};
for (const [b, R] of Object.entries(report.browsers)) {
  if (R.unavailable) continue;
  md.push('', `## Fallback diff table: ${b} ${R.version}`, '', 'Every frame, decoded three ways and compared with the reference (Δ = largest premultiplied channel difference, 0-255). `auto` is what applications get; `fallback` is our own decoder; `imagedecoder` is the browser\'s WebCodecs path.', '', '| file | frames | auto path | auto | imagedecoder | fallback |', '|---|---|---|---|---|---|');
  const rows = [...(R.correctSynthetic ?? []), ...(R.correctReal ?? [])];
  const byFile = new Map();
  for (const r of rows) (byFile.get(r.file) ?? byFile.set(r.file, {}).get(r.file))[r.path] = r;
  for (const [file, p] of byFile) {
    md.push(`| ${short(file)} | ${(p.auto ?? p.fallback ?? p.imagedecoder)?.frames ?? ''} | ${p.auto?.usedPath ?? ''} | ${cell(R, p.auto)} | ${cell(R, p.imagedecoder)} | ${cell(R, p.fallback)} |`);
  }
}

md.push('', '## Timing: on-screen frame times vs. the file\'s delays', '', 'Each emitted frame is compared with its scheduled start (cumulative delays). A requestAnimationFrame callback can only run on a ~16.7 ms tick, so ~17 ms is the floor. Pass: max error <= 60 ms and total play time within 60 ms.', '', '| browser | file | path | frames | mean err ms | max err ms | total expected / measured ms | late draws | |', '|---|---|---|---|---|---|---|---|---|');
for (const [b, R] of Object.entries(report.browsers)) for (const r of R.timing ?? []) {
  if (!r.ok) failures++;
  md.push(`| ${b} | ${short(r.file)} | ${r.usedPath ?? r.path} | ${r.frames ?? ''} | ${r.meanErrMs ?? ''} | ${r.maxAbsErrMs ?? ''} | ${r.expectedTotalMs ?? ''} / ${r.measuredTotalMs ?? ''} | ${r.lateDraws ?? ''} | ${r.ok ? 'ok' : '**FAIL**'} |`);
}

md.push('', '## Loop counts (file vs. player option)', '', '| browser | file | option | file loop count (total plays) | observed plays | ended after / expected ms | |', '|---|---|---|---|---|---|---|');
for (const [b, R] of Object.entries(report.browsers)) for (const r of R.loops ?? []) {
  if (!r.ok) failures++;
  md.push(`| ${b} | ${short(r.file)} | ${r.option ?? '-'} | ${r.fileLoopCount === 0 ? 'forever' : r.fileLoopCount} | ${r.observedPlays} (expected ${r.expectedPlays}) | ${r.endedAfterMs ?? '-'} / ${r.expectedMs ?? '-'} | ${r.ok ? 'ok' : '**FAIL**'} |`);
}

md.push('', `## Leaks: ${cycles} create -> play -> seek -> destroy cycles per path`, '', '| browser | file | path | VideoFrames created / closed | ImageBitmaps created / closed | decoders opened / closed | still open | peak open per renderer | rAF outstanding | ResizeObservers live | |', '|---|---|---|---|---|---|---|---|---|---|---|');
for (const [b, R] of Object.entries(report.browsers)) for (const r of R.leaks ?? []) {
  if (r.error) { failures++; md.push(`| ${b} | ${short(r.file)} | ${r.path} | ERROR ${r.error.slice(0, 80)} | | | | | | | |`); continue; }
  if (!r.ok) failures++;
  md.push(`| ${b} | ${short(r.file)} | ${r.usedPath} | ${r.created.videoFrames} / ${r.closed.videoFrames} | ${r.created.bitmaps} / ${r.closed.bitmaps} | ${r.created.decoders} / ${r.closed.decoders} | ${r.stillOpen.videoFrames + r.stillOpen.bitmaps + r.stillOpen.decoders} | ${r.peakOpenPerRenderer} | ${r.rafOutstanding} | ${r.resizeObserversLive} | ${r.ok ? 'ok' : '**FAIL**'} |`);
}
md.push('', failures ? `**${failures} unexpected failure(s).**` : '**All checks passed** (rows marked "known" are the documented WebKit ImageDecoder bug, which `auto` routes around).');

mkdirSync(join(root, 'reports'), { recursive: true });
const suffix = process.argv.some((a) => a.startsWith('--browser=')) ? `-${browsers.join('+')}` : ''; // a run for named browsers (CI) never overwrites the committed default report
writeFileSync(join(root, `reports/phase4-images${suffix}.json`), JSON.stringify(report, null, 1) + '\n');
writeFileSync(join(root, `reports/phase4-images${suffix}.md`), md.join('\n') + '\n');
console.log(md.slice(md.indexOf('## Browser support'), md.indexOf('## Browser support') + 10).join('\n'));
console.log(failures ? `\n${failures} unexpected failure(s); see reports/phase4-images.md` : '\nall checks passed; see reports/phase4-images.md');
process.exit(failures ? 1 : 0);
