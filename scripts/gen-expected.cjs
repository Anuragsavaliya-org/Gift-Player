// Generates samples/expected.json by parsing each SVGA sample with svgaplayerweb
// (devDependency, reference implementation) inside Node with minimal browser stubs.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const samplesDir = path.join(root, 'samples');
const bundle = fs.readFileSync(path.join(root, 'node_modules/svgaplayerweb/build/svga.min.js'), 'utf8');

const files = fs.readdirSync(samplesDir).filter((f) => f.toLowerCase().endsWith('.svga')).sort();
let current = null;

class FakeXHR {
  open(_m, url) { this.url = url; }
  send() {
    const buf = fs.readFileSync(path.join(samplesDir, this.url));
    this.response = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    setImmediate(() => this.onload && this.onload());
  }
}

const sandbox = {
  XMLHttpRequest: FakeXHR,
  console,
  setTimeout, clearTimeout, setImmediate,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  document: { querySelectorAll: () => [], getElementsByTagName: () => [], createElement: () => ({ getContext: () => ({}), style: {} }), addEventListener() {} },
  navigator: { userAgent: 'node' },
  Uint8Array, ArrayBuffer, DataView, Int32Array, Float32Array, Uint32Array, Uint16Array, Int8Array, Int16Array, Float64Array,
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(bundle, sandbox);
const SVGA = sandbox.SVGA || sandbox.window.SVGA;
if (!SVGA || !SVGA.Parser) throw new Error('SVGA.Parser not found on sandbox');

function parse(file) {
  return new Promise((resolve, reject) => {
    new SVGA.Parser().load(file, resolve, reject);
  });
}

(async () => {
  const out = {};
  for (const f of files) {
    let v;
    try {
      v = await parse(f);
    } catch (e) {
      // svgaplayerweb needs JSZip for SVGA 1.x zips; we do not guess values it cannot give.
      out[f] = { unparsed: true, reason: String((e && e.message) || e) };
      console.warn(`[skip] ${f}: ${out[f].reason}`);
      continue;
    }
    out[f] = {
      version: v.version,
      fps: v.FPS,
      frames: v.frames,
      spriteCount: v.sprites.length,
      imageCount: Object.keys(v.images).length,
      viewBox: { width: v.videoSize.width, height: v.videoSize.height },
    };
  }
  fs.writeFileSync(path.join(samplesDir, 'expected.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
