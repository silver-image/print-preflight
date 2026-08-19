"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreflightError = exports.PAPERS = void 0;
exports.parseImage = parseImage;
exports.verdictFor = verdictFor;
exports.dpiForPaper = dpiForPaper;
exports.assess = assess;
exports.analyzeBytes = analyzeBytes;
/** ISO 216 A-series, millimetres. */
exports.PAPERS = [
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
class PreflightError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
exports.PreflightError = PreflightError;
/* ────────────────────────────────────────────────────────────────────
 * Header parsers. Input is untrusted: every read is bounds-checked and
 * nothing from the file is ever executed or interpreted as markup.
 * ──────────────────────────────────────────────────────────────────── */
function u16be(b, o) {
    return (b[o] << 8) | b[o + 1];
}
function u32be(b, o) {
    return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
function u16le(b, o) {
    return b[o] | (b[o + 1] << 8);
}
function u24le(b, o) {
    return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
}
function u32le(b, o) {
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}
function parsePng(b) {
    if (b.length < 24)
        return null;
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < 8; i++)
        if (b[i] !== sig[i])
            return null;
    // first chunk must be IHDR: length(4) type(4)=IHDR width(4) height(4)
    if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) {
        throw new PreflightError("corrupt", "PNG signature present but IHDR chunk missing");
    }
    return { format: "png", width: u32be(b, 16), height: u32be(b, 20) };
}
function parseJpeg(b) {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8)
        return null;
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
        if (marker === 0xd9 || marker === 0xda)
            break; // EOI / start of scan — no SOF found
        const len = u16be(b, o + 2);
        if (len < 2 || o + 2 + len > b.length) {
            throw new PreflightError("corrupt", "JPEG marker segment overruns the file");
        }
        const isSof = (marker >= 0xc0 && marker <= 0xc3) ||
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
function parseWebp(b) {
    if (b.length < 30)
        return null;
    if (b[0] !== 0x52 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x46)
        return null; // RIFF
    if (b[8] !== 0x57 || b[9] !== 0x45 || b[10] !== 0x42 || b[11] !== 0x50)
        return null; // WEBP
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
        if (b[20] !== 0x2f)
            throw new PreflightError("corrupt", "WebP VP8L signature missing");
        const bits = u32le(b, 21);
        return {
            format: "webp",
            width: (bits & 0x3fff) + 1,
            height: ((bits >> 14) & 0x3fff) + 1,
        };
    }
    throw new PreflightError("corrupt", "WebP chunk layout not recognised");
}
function parseTiff(b) {
    if (b.length < 8)
        return null;
    const le = b[0] === 0x49 && b[1] === 0x49;
    const be = b[0] === 0x4d && b[1] === 0x4d;
    if (!le && !be)
        return null;
    const u16 = le ? u16le : u16be;
    const u32 = le ? u32le : u32be;
    if (u16(b, 2) !== 42)
        return null;
    const ifd = u32(b, 4);
    if (ifd + 2 > b.length)
        throw new PreflightError("corrupt", "TIFF IFD offset out of bounds");
    const count = u16(b, ifd);
    let width = 0, height = 0;
    for (let i = 0; i < count; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > b.length)
            throw new PreflightError("corrupt", "TIFF IFD entry out of bounds");
        const tag = u16(b, e);
        const type = u16(b, e + 2);
        if (tag !== 0x0100 && tag !== 0x0101)
            continue;
        let val;
        if (type === 3)
            val = u16(b, e + 8); // SHORT, left-justified in value field
        else if (type === 4)
            val = u32(b, e + 8); // LONG
        else
            continue;
        if (tag === 0x0100)
            width = val;
        else
            height = val;
    }
    if (!width || !height) {
        throw new PreflightError("corrupt", "TIFF is missing ImageWidth/ImageLength tags");
    }
    return { format: "tiff", width, height };
}
/** Read pixel dimensions from raw file bytes. Throws PreflightError. */
function parseImage(bytes) {
    if (!bytes || bytes.length === 0) {
        throw new PreflightError("empty", "The file is empty");
    }
    const parsed = parsePng(bytes) ?? parseJpeg(bytes) ?? parseWebp(bytes) ?? parseTiff(bytes);
    if (!parsed) {
        throw new PreflightError("unsupported", "Unsupported file type — supported: JPG, PNG, WebP, TIFF");
    }
    if (parsed.width < 1 ||
        parsed.height < 1 ||
        parsed.width > 1000000 ||
        parsed.height > 1000000) {
        throw new PreflightError("bounds", "Image dimensions are outside a sane range");
    }
    return parsed;
}
/* ────────────────────────────────────────────────────────────────────
 * Print maths
 * ──────────────────────────────────────────────────────────────────── */
function verdictFor(dpi) {
    if (dpi >= 300)
        return "excellent";
    if (dpi >= 200)
        return "good";
    if (dpi >= 150)
        return "acceptable-large-format";
    if (dpi >= 100)
        return "low";
    return "not-recommended";
}
/** Effective DPI when the image fills the paper, paper rotated to match image orientation. */
function dpiForPaper(width, height, paper) {
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
function assess(width, height) {
    if (width < 1 || height < 1) {
        throw new PreflightError("bounds", "Dimensions must be positive");
    }
    const long = Math.max(width, height);
    const short = Math.min(width, height);
    const aspectRatio = long / short;
    const aspectDeviationPct = Math.abs(aspectRatio - SQRT2) / SQRT2 * 100;
    const formats = exports.PAPERS.map((p) => {
        const dpi = dpiForPaper(width, height, p);
        return { paper: p.name, dpi, capped: dpi >= 300, verdict: verdictFor(dpi) };
    });
    let recommendedMax = null;
    for (const f of formats) {
        // PAPERS is ordered A0 (largest) → A6; first hit at >=150 DPI is the largest.
        if (f.dpi >= 150) {
            recommendedMax = f.paper;
            break;
        }
    }
    const mean = formats.reduce((s, f) => s + Math.min(f.dpi, 300) / 300, 0) / formats.length;
    const base = Math.round(mean * 100);
    const bonus = aspectDeviationPct <= 1.5 ? 3 : aspectDeviationPct <= 7 ? 0 : -8;
    const score = Math.max(0, Math.min(100, base + bonus));
    return {
        width,
        height,
        megapixels: Math.round((width * height) / 10000) / 100,
        orientation: width === height ? "square" : width > height ? "landscape" : "portrait",
        aspectRatio: Math.round(aspectRatio * 1000) / 1000,
        aspectDeviationPct: Math.round(aspectDeviationPct * 10) / 10,
        aspectWarning: aspectDeviationPct > 7,
        formats,
        recommendedMax,
        score,
        scoreBreakdown: `base ${base} (mean of min(DPI,300)/300 across A0-A6)` +
            (bonus ? ` ${bonus > 0 ? "+" : ""}${bonus} aspect-ratio ${bonus > 0 ? "bonus" : "penalty"}` : ""),
    };
}
/** One-call convenience for wrappers: bytes in, full result out. */
function analyzeBytes(bytes) {
    const image = parseImage(bytes);
    return { image, result: assess(image.width, image.height) };
}
