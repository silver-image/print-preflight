/**
 * Silver Image Print Preflight — core
 *
 * Pure, dependency-free TypeScript. Runs identically in the browser,
 * Node and the VS Code extension host. No image DECODING happens here:
 * dimensions are read straight from file headers, so a 200 MB TIFF costs
 * the same few microseconds as a thumbnail — and nothing ever needs to
 * leave the user's device.
 *
 * Reused by: web tool (silverimagelondon.com/tools/print-preflight),
 * VS Code extension, future Figma wrapper. Do not duplicate this logic
 * in wrappers — import it.
 */

export type PaperName = "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";

export interface PaperSpec {
  name: PaperName;
  /** short edge, mm (portrait width) */
  wMm: number;
  /** long edge, mm (portrait height) */
  hMm: number;
}

/** ISO 216 A-series, millimetres. */
export const PAPERS: readonly PaperSpec[] = [
  { name: "A0", wMm: 841, hMm: 1189 },
  { name: "A1", wMm: 594, hMm: 841 },
  { name: "A2", wMm: 420, hMm: 594 },
  { name: "A3", wMm: 297, hMm: 420 },
  { name: "A4", wMm: 210, hMm: 297 },
  { name: "A5", wMm: 148, hMm: 210 },
  { name: "A6", wMm: 105, hMm: 148 },
];

const MM_PER_INCH = 25.4;
const SQRT2 = Math.SQRT2;

export type Verdict =
  | "excellent"
  | "good"
  | "acceptable-large-format"
  | "low"
  | "not-recommended";

export interface FormatResult {
  paper: PaperName;
  /** effective DPI when the image fills this paper size (paper rotated to match image orientation) */
  dpi: number;
  /** true when dpi >= 300 (UI may show "300+") */
  capped: boolean;
  verdict: Verdict;
}

export interface AssessResult {
  width: number;
  height: number;
  megapixels: number;
  orientation: "portrait" | "landscape" | "square";
  /** long/short edge ratio */
  aspectRatio: number;
  /** deviation from the ISO A-series ratio (sqrt 2), percent, always >= 0 */
  aspectDeviationPct: number;
  aspectWarning: boolean;
  formats: FormatResult[];
  /** largest format printable at >= 150 DPI, or null when even A6 falls below 150 */
  recommendedMax: PaperName | null;
  /** verdict at recommendedMax — 150-199 DPI means "acceptable for large-format", not unconditionally great */
  recommendedMaxVerdict: Verdict | null;
  /** largest format at >= 200 DPI ("good" or better) — the honest answer for close-viewing work */
  closeViewingMax: PaperName | null;
  /** deterministic 0-100, see scoreBreakdown for the exact arithmetic */
  score: number;
  scoreBreakdown: string;
}

export type ImageFormat = "png" | "jpeg" | "webp" | "tiff";

export interface ParsedImage {
  format: ImageFormat;
  width: number;
  height: number;
}

export class PreflightError extends Error {
  constructor(
    public code: "unsupported" | "corrupt" | "empty" | "bounds",
    message: string
  ) {
    super(message);
  }
}

/* ────────────────────────────────────────────────────────────────────
 * Header parsers. Input is untrusted: every read is bounds-checked and
 * nothing from the file is ever executed or interpreted as markup.
 * ──────────────────────────────────────────────────────────────────── */

function u16be(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}
function u32be(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
function u16le(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function u24le(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
}
function u32le(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function parsePng(b: Uint8Array): ParsedImage | null {
  if (b.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) return null;
  // first chunk must be IHDR: length(4) type(4)=IHDR width(4) height(4)
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) {
    throw new PreflightError("corrupt", "PNG signature present but IHDR chunk missing");
  }
  return { format: "png", width: u32be(b, 16), height: u32be(b, 20) };
}

function parseJpeg(b: Uint8Array): ParsedImage | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) {
      o++; // padding/fill bytes between markers are legal
      continue;
    }
    const marker = b[o + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      o += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan — no SOF found
    const len = u16be(b, o + 2);
    if (len < 2 || o + 2 + len > b.length) {
      throw new PreflightError("corrupt", "JPEG marker segment overruns the file");
    }
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      // segment: len(2) precision(1) height(2) width(2)
      return { format: "jpeg", width: u16be(b, o + 7), height: u16be(b, o + 5) };
    }
    o += 2 + len;
  }
  throw new PreflightError("corrupt", "JPEG has no SOF frame header");
}

function parseWebp(b: Uint8Array): ParsedImage | null {
  if (b.length < 30) return null;
  if (b[0] !== 0x52 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x46) return null; // RIFF
  if (b[8] !== 0x57 || b[9] !== 0x45 || b[10] !== 0x42 || b[11] !== 0x50) return null; // WEBP
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (fourcc === "VP8X") {
    // canvas size: 24-bit LE minus one, at offsets 24 and 27
    return { format: "webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  if (fourcc === "VP8 ") {
    // lossy: frame tag 3B, sync 9D 01 2A, then 16-bit LE dims (14 bits used)
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) {
      throw new PreflightError("corrupt", "WebP VP8 sync code missing");
    }
    return {
      format: "webp",
      width: u16le(b, 26) & 0x3fff,
      height: u16le(b, 28) & 0x3fff,
    };
  }
  if (fourcc === "VP8L") {
    if (b[20] !== 0x2f) throw new PreflightError("corrupt", "WebP VP8L signature missing");
    const bits = u32le(b, 21);
    return {
      format: "webp",
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  throw new PreflightError("corrupt", "WebP chunk layout not recognised");
}

/**
 * Probe the first 8 bytes for a TIFF header. Lets callers (the web tool)
 * read ONLY the IFD slice of a huge file instead of the whole file.
 */
export function probeTiff(
  head: Uint8Array
): { littleEndian: boolean; ifdOffset: number } | null {
  if (head.length < 8) return null;
  const le = head[0] === 0x49 && head[1] === 0x49;
  const be = head[0] === 0x4d && head[1] === 0x4d;
  if (!le && !be) return null;
  const u16 = le ? u16le : u16be;
  const u32 = le ? u32le : u32be;
  if (u16(head, 2) !== 42) return null;
  return { littleEndian: le, ifdOffset: u32(head, 4) };
}

/** Parse dimensions from an IFD slice whose byte 0 is the start of the IFD. */
export function parseTiffDimsFromIfd(
  ifdBytes: Uint8Array,
  littleEndian: boolean
): ParsedImage {
  const u16 = littleEndian ? u16le : u16be;
  const u32 = littleEndian ? u32le : u32be;
  if (ifdBytes.length < 2) throw new PreflightError("corrupt", "TIFF IFD slice too short");
  const count = u16(ifdBytes, 0);
  let width = 0,
    height = 0;
  for (let i = 0; i < count; i++) {
    const e = 2 + i * 12;
    if (e + 12 > ifdBytes.length) {
      throw new PreflightError("corrupt", "TIFF IFD entry out of bounds");
    }
    const tag = u16(ifdBytes, e);
    const type = u16(ifdBytes, e + 2);
    if (tag !== 0x0100 && tag !== 0x0101) continue;
    let val: number;
    if (type === 3) val = u16(ifdBytes, e + 8); // SHORT, left-justified
    else if (type === 4) val = u32(ifdBytes, e + 8); // LONG
    else continue;
    if (tag === 0x0100) width = val;
    else height = val;
  }
  if (!width || !height) {
    throw new PreflightError("corrupt", "TIFF is missing ImageWidth/ImageLength tags");
  }
  return { format: "tiff", width, height };
}

/** How many bytes of IFD slice are needed once the entry count is known. */
export function tiffIfdByteLength(entryCount: number): number {
  return 2 + entryCount * 12 + 4;
}

function parseTiff(b: Uint8Array): ParsedImage | null {
  const probe = probeTiff(b);
  if (!probe) return null;
  const ifd = probe.ifdOffset;
  if (ifd + 2 > b.length) throw new PreflightError("corrupt", "TIFF IFD offset out of bounds");
  return parseTiffDimsFromIfd(b.subarray(ifd), probe.littleEndian);
}

/** Read pixel dimensions from raw file bytes. Throws PreflightError. */
export function parseImage(bytes: Uint8Array): ParsedImage {
  if (!bytes || bytes.length === 0) {
    throw new PreflightError("empty", "The file is empty");
  }
  const parsed =
    parsePng(bytes) ?? parseJpeg(bytes) ?? parseWebp(bytes) ?? parseTiff(bytes);
  if (!parsed) {
    throw new PreflightError(
      "unsupported",
      "Unsupported file type — supported: JPG, PNG, WebP, TIFF"
    );
  }
  if (
    parsed.width < 1 ||
    parsed.height < 1 ||
    parsed.width > 1_000_000 ||
    parsed.height > 1_000_000
  ) {
    throw new PreflightError("bounds", "Image dimensions are outside a sane range");
  }
  return parsed;
}

/* ────────────────────────────────────────────────────────────────────
 * Print maths
 * ──────────────────────────────────────────────────────────────────── */

export function verdictFor(dpi: number): Verdict {
  if (dpi >= 300) return "excellent";
  if (dpi >= 200) return "good";
  if (dpi >= 150) return "acceptable-large-format";
  if (dpi >= 100) return "low";
  return "not-recommended";
}

/** Effective DPI when the image fills the paper, paper rotated to match image orientation. */
export function dpiForPaper(width: number, height: number, paper: PaperSpec): number {
  const imgLandscape = width >= height;
  const paperW = imgLandscape ? paper.hMm : paper.wMm;
  const paperH = imgLandscape ? paper.wMm : paper.hMm;
  const dpiX = width / (paperW / MM_PER_INCH);
  const dpiY = height / (paperH / MM_PER_INCH);
  return Math.round(Math.min(dpiX, dpiY));
}

/**
 * Deterministic readiness score.
 *   base  = round( mean over A0..A6 of min(dpi,300)/300 × 100 )
 *   bonus = +3 when the aspect ratio is within 1.5% of √2 (prints edge-to-edge
 *           on A-series with no crop), 0 within 7%, −8 beyond that.
 * Clamped to 0..100. No model, no randomness — same file, same score, forever.
 */
export function assess(width: number, height: number): AssessResult {
  if (width < 1 || height < 1) {
    throw new PreflightError("bounds", "Dimensions must be positive");
  }
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const aspectRatio = long / short;
  const aspectDeviationPct = Math.abs(aspectRatio - SQRT2) / SQRT2 * 100;

  const formats: FormatResult[] = PAPERS.map((p) => {
    const dpi = dpiForPaper(width, height, p);
    return { paper: p.name, dpi, capped: dpi >= 300, verdict: verdictFor(dpi) };
  });

  let recommendedMax: PaperName | null = null;
  let recommendedMaxVerdict: Verdict | null = null;
  let closeViewingMax: PaperName | null = null;
  for (const f of formats) {
    // PAPERS is ordered A0 (largest) → A6; first hit is the largest qualifying size.
    if (recommendedMax === null && f.dpi >= 150) {
      recommendedMax = f.paper;
      recommendedMaxVerdict = f.verdict;
    }
    if (closeViewingMax === null && f.dpi >= 200) {
      closeViewingMax = f.paper;
    }
    if (recommendedMax !== null && closeViewingMax !== null) break;
  }

  const mean =
    formats.reduce((s, f) => s + Math.min(f.dpi, 300) / 300, 0) / formats.length;
  const base = Math.round(mean * 100);
  const bonus = aspectDeviationPct <= 1.5 ? 3 : aspectDeviationPct <= 7 ? 0 : -8;
  const score = Math.max(0, Math.min(100, base + bonus));

  return {
    width,
    height,
    megapixels: Math.round((width * height) / 10_000) / 100,
    orientation: width === height ? "square" : width > height ? "landscape" : "portrait",
    aspectRatio: Math.round(aspectRatio * 1000) / 1000,
    aspectDeviationPct: Math.round(aspectDeviationPct * 10) / 10,
    aspectWarning: aspectDeviationPct > 7,
    formats,
    recommendedMax,
    recommendedMaxVerdict,
    closeViewingMax,
    score,
    scoreBreakdown:
      `base ${base} (mean of min(DPI,300)/300 across A0-A6)` +
      (bonus ? ` ${bonus > 0 ? "+" : ""}${bonus} aspect-ratio ${bonus > 0 ? "bonus" : "penalty"}` : ""),
  };
}

/** One-call convenience for wrappers: bytes in, full result out. */
export function analyzeBytes(bytes: Uint8Array): { image: ParsedImage; result: AssessResult } {
  const image = parseImage(bytes);
  return { image, result: assess(image.width, image.height) };
}
