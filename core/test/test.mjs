/* Testy rdzenia — node core/test/test.mjs. Zero zależności. */
import { strict as A } from "node:assert";
import { parseImage, assess, dpiForPaper, PAPERS, PreflightError, analyzeBytes, probeTiff, parseTiffDimsFromIfd, tiffIfdByteLength } from "../dist/esm/core.js";

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + " — " + e.message); }
}

/* ── syntetyczne nagłówki ───────────────────────────────────────── */
function pngBytes(w, h) {
  const b = new Uint8Array(26);
  b.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a, 0,0,0,13, 0x49,0x48,0x44,0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
function jpegBytes(w, h) {
  // SOI, APP0(len4), SOF0: FFC0 len=11 prec=8 h w comps=1 …
  return new Uint8Array([0xff,0xd8, 0xff,0xe0,0x00,0x04,0,0,
    0xff,0xc0,0x00,0x0b,0x08, h>>8,h&255, w>>8,w&255, 0x01, 0,0,0]);
}
function webpVp8x(w, h) {
  const b = new Uint8Array(30);
  b.set([0x52,0x49,0x46,0x46, 22,0,0,0, 0x57,0x45,0x42,0x50, 0x56,0x50,0x38,0x58, 10,0,0,0, 0]);
  const W = w-1, H = h-1;
  b[24]=W&255; b[25]=(W>>8)&255; b[26]=(W>>16)&255;
  b[27]=H&255; b[28]=(H>>8)&255; b[29]=(H>>16)&255;
  return b;
}
function tiffBytes(w, h, littleEndian) {
  const b = new Uint8Array(8 + 2 + 24 + 4);
  const dv = new DataView(b.buffer);
  const le = littleEndian;
  if (le) { b[0]=0x49; b[1]=0x49; } else { b[0]=0x4d; b[1]=0x4d; }
  dv.setUint16(2, 42, le); dv.setUint32(4, 8, le);
  dv.setUint16(8, 2, le); // 2 entries
  let e = 10;
  dv.setUint16(e, 0x0100, le); dv.setUint16(e+2, 4, le); dv.setUint32(e+4, 1, le); dv.setUint32(e+8, w, le);
  e += 12;
  dv.setUint16(e, 0x0101, le); dv.setUint16(e+2, 3, le); dv.setUint32(e+4, 1, le); dv.setUint16(e+8, h, le);
  return b;
}

/* ── parsery ────────────────────────────────────────────────────── */
t("PNG 4961x3508", () => { const p = parseImage(pngBytes(4961,3508)); A.equal(p.format,"png"); A.equal(p.width,4961); A.equal(p.height,3508); });
t("JPEG 2480x3508", () => { const p = parseImage(jpegBytes(2480,3508)); A.equal(p.format,"jpeg"); A.equal(p.width,2480); A.equal(p.height,3508); });
t("WebP VP8X 800x600", () => { const p = parseImage(webpVp8x(800,600)); A.equal(p.format,"webp"); A.equal(p.width,800); A.equal(p.height,600); });
t("TIFF little-endian 5000x4000", () => { const p = parseImage(tiffBytes(5000,4000,true)); A.equal(p.format,"tiff"); A.equal(p.width,5000); A.equal(p.height,4000); });
t("TIFF big-endian 5000x4000", () => { const p = parseImage(tiffBytes(5000,4000,false)); A.equal(p.width,5000); A.equal(p.height,4000); });
t("pusty plik -> empty", () => { A.throws(() => parseImage(new Uint8Array(0)), (e) => e instanceof PreflightError && e.code==="empty"); });
t("GIF -> unsupported", () => { A.throws(() => parseImage(new Uint8Array([0x47,0x49,0x46,0x38,0x39,0x61,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0])), (e) => e.code==="unsupported"); });
t("uciety JPEG -> corrupt", () => { A.throws(() => parseImage(new Uint8Array([0xff,0xd8,0xff,0xc0,0xff,0xff,0,0,0,0])), (e) => e instanceof PreflightError); });

/* ── matematyka: wektor wzorcowy ze specyfikacji ────────────────── */
t("WZORZEC 4961x3508: DPI per format", () => {
  const r = assess(4961, 3508);
  const d = Object.fromEntries(r.formats.map(f => [f.paper, f.dpi]));
  A.equal(d.A3, 300); A.equal(d.A2, 212); A.equal(d.A1, 150); A.equal(d.A0, 106);
  A.ok(d.A4 >= 300 && r.formats.find(f=>f.paper==="A4").capped);
});
t("WZORZEC: recommendedMax = A1", () => { A.equal(assess(4961,3508).recommendedMax, "A1"); });
t("WZORZEC: score = 82", () => { A.equal(assess(4961,3508).score, 82); });
t("WZORZEC: aspect idealny (deviation<=0.1%)", () => { A.ok(assess(4961,3508).aspectDeviationPct <= 0.1); });

/* ── matematyka: pozostale wektory ──────────────────────────────── */
t("A4@300 portret 2480x3508 -> A4=300, rec=A2", () => {
  const r = assess(2480, 3508);
  A.equal(r.formats.find(f=>f.paper==="A4").dpi, 300);
  A.equal(r.formats.find(f=>f.paper==="A2").dpi, 150);
  A.equal(r.recommendedMax, "A2");
  A.equal(r.orientation, "portrait");
});
t("orientacja: landscape rotuje papier (dpi symetryczne)", () => {
  A.equal(assess(3508,2480).formats.find(f=>f.paper==="A4").dpi,
          assess(2480,3508).formats.find(f=>f.paper==="A4").dpi);
});
t("A0@300: 9933x14043 -> wszystko excellent, rec=A0", () => {
  const r = assess(9933, 14043);
  A.equal(r.formats.find(f=>f.paper==="A0").dpi, 300);
  A.equal(r.recommendedMax, "A0");
  A.equal(r.score, 100 + 0 ? 100 : r.score); A.ok(r.score >= 100 - 0 || r.score === 100);
});
t("male zdjecie 640x480: rec=null, score niski", () => {
  const r = assess(640, 480);
  A.equal(r.recommendedMax, null);
  A.ok(r.formats.every(f => f.dpi < 150));
  A.ok(r.score < 30);
});
t("dziwny aspekt 5000x1000: warning + kara", () => {
  const r = assess(5000, 1000);
  A.ok(r.aspectWarning);
  A.ok(r.aspectDeviationPct > 7);
});
t("kwadrat 3000x3000: orientation=square, aspect warning", () => {
  const r = assess(3000, 3000);
  A.equal(r.orientation, "square");
  A.ok(r.aspectWarning);
});
t("bardzo duze 100000x70711: wszystko capped 300+", () => {
  const r = assess(100000, 70711);
  A.ok(r.formats.every(f => f.capped));
  A.equal(r.score, 100);
});
t("wymiary absurdalne -> bounds", () => {
  A.throws(() => parseImage(pngBytes(2_000_000, 10)), (e) => e.code === "bounds");
});
t("analyzeBytes: sklejka parser+matma", () => {
  const { image, result } = analyzeBytes(pngBytes(4961,3508));
  A.equal(image.format, "png"); A.equal(result.score, 82);
});

/* ── kontrola niezalezna: DPI z definicji, nie z implementacji ──── */
t("cross-check: A2 landscape = 594mm szer -> 4961/(594/25.4)", () => {
  const expected = Math.round(4961 / (594 / 25.4));
  A.equal(dpiForPaper(4961, 3508, PAPERS.find(p=>p.name==="A2")), expected);
});


/* ── rozbite rekomendacje (uwaga #2 Macka) ──────────────────────── */
t("WZORZEC: verdict przy rec-max = acceptable-large-format", () => {
  A.equal(assess(4961,3508).recommendedMaxVerdict, "acceptable-large-format");
});
t("WZORZEC: closeViewingMax = A2 (najwiekszy z DPI>=200)", () => {
  A.equal(assess(4961,3508).closeViewingMax, "A2");
});
t("A0@300: closeViewing = rec = A0, verdict excellent", () => {
  const r = assess(9933, 14043);
  A.equal(r.closeViewingMax, "A0"); A.equal(r.recommendedMaxVerdict, "excellent");
});
t("male zdjecie: oba nulle", () => {
  const r = assess(640, 480);
  A.equal(r.recommendedMax, null); A.equal(r.closeViewingMax, null); A.equal(r.recommendedMaxVerdict, null);
});

/* ── chunked TIFF (uwaga #1 Macka): IFD daleko, czytamy TYLKO slice ── */
t("chunked TIFF: probe + parse z samego slice'a IFD", () => {
  // plik "wirtualnie" 200MB: naglowek mowi IFD @ 199_000_000 — tworzymy TYLKO
  // 8B naglowka i osobno 30B slice IFD; calego pliku NIE MA w pamieci.
  const head = new Uint8Array(8);
  head.set([0x49,0x49]); new DataView(head.buffer).setUint16(2,42,true);
  new DataView(head.buffer).setUint32(4, 199_000_000, true);
  const probe = probeTiff(head);
  A.ok(probe && probe.littleEndian && probe.ifdOffset === 199_000_000);
  const ifd = new Uint8Array(tiffIfdByteLength(2));
  const dv = new DataView(ifd.buffer);
  dv.setUint16(0, 2, true);
  dv.setUint16(2, 0x0100, true); dv.setUint16(4, 4, true); dv.setUint32(6,1,true); dv.setUint32(10, 20000, true);
  dv.setUint16(14, 0x0101, true); dv.setUint16(16, 3, true); dv.setUint32(18,1,true); dv.setUint16(22, 14142, true);
  const img = parseTiffDimsFromIfd(ifd, true);
  A.equal(img.width, 20000); A.equal(img.height, 14142);
});
t("chunked TIFF: big-endian slice", () => {
  const ifd = new Uint8Array(tiffIfdByteLength(2));
  const dv = new DataView(ifd.buffer);
  dv.setUint16(0, 2, false);
  dv.setUint16(2, 0x0100, false); dv.setUint16(4, 3, false); dv.setUint32(6,1,false); dv.setUint16(10, 5000, false);
  dv.setUint16(14, 0x0101, false); dv.setUint16(16, 3, false); dv.setUint32(18,1,false); dv.setUint16(22, 4000, false);
  const img = parseTiffDimsFromIfd(ifd, false);
  A.equal(img.width, 5000); A.equal(img.height, 4000);
});
t("chunked TIFF: uciety slice -> corrupt, nie crash", () => {
  A.throws(() => parseTiffDimsFromIfd(new Uint8Array([2,0,0,0]), true), (e) => e instanceof PreflightError);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
