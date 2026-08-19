/**
 * Print Preflight — browser UI.
 * Bundled AFTER core.ts with `export` statements stripped, so core's
 * functions are plain globals here. All processing is local: the file is
 * read with FileReader into memory, parsed, and never sent anywhere.
 */

interface PfResult {
  width: number; height: number; megapixels: number;
  orientation: string; aspectRatio: number; aspectDeviationPct: number;
  aspectWarning: boolean;
  formats: { paper: string; dpi: number; capped: boolean; verdict: string }[];
  recommendedMax: string | null; recommendedMaxVerdict: string | null;
  closeViewingMax: string | null; score: number; scoreBreakdown: string;
}
interface PfAnalysis { image: { format: string; width: number; height: number }; result: PfResult; }
declare function analyzeBytes(bytes: Uint8Array): PfAnalysis;
declare function assess(width: number, height: number): PfResult;
declare function probeTiff(head: Uint8Array): { littleEndian: boolean; ifdOffset: number } | null;
declare function parseTiffDimsFromIfd(ifdBytes: Uint8Array, littleEndian: boolean): { format: string; width: number; height: number };
declare function tiffIfdByteLength(entryCount: number): number;

(function () {
  const root = document.getElementById("preflight-app");
  if (!root) return;

  const VERDICT_LABEL: Record<string, [string, string]> = {
    "excellent": ["Excellent", "sil-pf-ok"],
    "good": ["Good", "sil-pf-ok"],
    "acceptable-large-format": ["Acceptable for large-format", "sil-pf-warn"],
    "low": ["Low resolution", "sil-pf-warn"],
    "not-recommended": ["Not recommended", "sil-pf-bad"],
  };

  function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
    );
  }

  root.innerHTML =
    '<div class="sil-pf-drop" id="silPfDrop" tabindex="0" role="button" aria-label="Choose or drop an image file to check">' +
    '<strong>Drop your artwork here</strong><span>or click to choose a file &mdash; JPG, PNG, WebP or TIFF</span>' +
    '<em>Your artwork never leaves your device. The check runs entirely in your browser.</em>' +
    "</div>" +
    '<input type="file" id="silPfFile" accept=".jpg,.jpeg,.png,.webp,.tif,.tiff,image/jpeg,image/png,image/webp,image/tiff" hidden>' +
    '<div id="silPfOut" aria-live="polite"></div>';

  const drop = document.getElementById("silPfDrop") as HTMLElement;
  const input = document.getElementById("silPfFile") as HTMLInputElement;
  const out = document.getElementById("silPfOut") as HTMLElement;

  function render(name: string, data: PfAnalysis): void {
    const r = data.result;
    const rows = r.formats
      .map((f) => {
        const [label, cls] = VERDICT_LABEL[f.verdict];
        const dpi = f.capped ? "300+" : String(f.dpi);
        const rec = f.paper === r.recommendedMax ? ' <span class="sil-pf-rec">recommended max</span>' : "";
        return `<tr class="${cls}"><td>${f.paper}</td><td>${dpi} DPI</td><td>${label}${rec}</td></tr>`;
      })
      .join("");
    const aspect = r.aspectWarning
      ? '<p class="sil-pf-note sil-pf-warn-note">This image&rsquo;s proportions do not match the A-series sheet (ratio &radic;2). ' +
        "Printing at a standard size will need cropping or white borders.</p>"
      : "";
    let recLine: string;
    if (r.recommendedMax) {
      const [qualityLabel] = VERDICT_LABEL[r.recommendedMaxVerdict ?? "excellent"];
      recLine =
        `<p class="sil-pf-max">Recommended maximum size: <strong>${r.recommendedMax}</strong>` +
        ` <span class="sil-pf-quality">&middot; quality at ${r.recommendedMax}: ${qualityLabel}</span></p>`;
      if (r.closeViewingMax && r.closeViewingMax !== r.recommendedMax) {
        recLine += `<p class="sil-pf-close">For close viewing (read in hand): <strong>${r.closeViewingMax}</strong> recommended</p>`;
      }
    } else {
      recLine = '<p class="sil-pf-max sil-pf-bad-note">This file is below 150 DPI even at A6. For print, a higher-resolution original is needed.</p>';
    }
    out.innerHTML =
      `<div class="sil-pf-result">` +
      `<h3>${esc(name)}</h3>` +
      `<p class="sil-pf-meta">${r.width.toLocaleString()} &times; ${r.height.toLocaleString()} px &middot; ` +
      `${r.megapixels} MP &middot; ${r.orientation} &middot; aspect ${r.aspectRatio}:1</p>` +
      `<table class="sil-pf-table"><thead><tr><th>Size</th><th>Effective DPI</th><th>Verdict</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>` +
      recLine + aspect +
      `<p class="sil-pf-score"><span>Print readiness: <strong>${r.score} / 100</strong></span>` +
      `<span class="sil-pf-meter" role="img" aria-label="Print readiness ${r.score} out of 100"><span style="width:${r.score}%"></span></span>` +
      `<small title="${esc(r.scoreBreakdown)}">how is this scored?</small></p>` +
      `<p class="sil-pf-note">Acceptable DPI depends on viewing distance and artwork type &mdash; a banner read from ` +
      `five metres forgives far more than an A4 brochure in hand. Final print quality also depends on the source ` +
      `image itself: sharpness, compression and colour.</p>` +
      `<p class="sil-pf-cta">Need this printed today in London? ` +
      `<a href="/contact">Get a quote from Silver Image Print &amp; Signs</a></p>` +
      `</div>`;
  }

  function fail(msg: string): void {
    out.innerHTML = `<div class="sil-pf-result sil-pf-error"><p>${esc(msg)}</p></div>`;
  }

  function readSlice(file: File, start: number, end: number): Promise<Uint8Array> {
    return file
      .slice(start, Math.min(end, file.size))
      .arrayBuffer()
      .then((buf) => new Uint8Array(buf));
  }

  const HEAD_BYTES = 256 * 1024;      // nagłówki PNG/WebP/TIFF i ~każdy JPEG
  const JPEG_FALLBACK = 8 * 1024 * 1024; // JPEG z gigantycznym preambułem — rzadkość

  /**
   * Czytanie plasterkowe: NIGDY nie ładujemy całego pliku bez potrzeby.
   * TIFF z IFD na końcu 200 MB pliku = 256 KB nagłówka + kilkaset bajtów IFD.
   */
  async function analyzeFile(file: File): Promise<PfAnalysis> {
    const head = await readSlice(file, 0, HEAD_BYTES);
    const probe = probeTiff(head);
    if (probe && probe.ifdOffset + 2 > head.length) {
      // IFD poza nagłówkiem — doczytujemy wyłącznie licznik i sam IFD.
      const cntB = await readSlice(file, probe.ifdOffset, probe.ifdOffset + 2);
      if (cntB.length < 2) throw new Error("TIFF directory is truncated");
      const count = probe.littleEndian ? cntB[0] | (cntB[1] << 8) : (cntB[0] << 8) | cntB[1];
      const ifdB = await readSlice(
        file, probe.ifdOffset, probe.ifdOffset + tiffIfdByteLength(count)
      );
      const image = parseTiffDimsFromIfd(ifdB, probe.littleEndian);
      return { image, result: assess(image.width, image.height) };
    }
    try {
      return analyzeBytes(head);
    } catch (e: any) {
      // JPEG potrafi mieć SOF za dużym preambułem — eskalujemy odczyt.
      const truncatable = head.length < file.size && e && e.code === "corrupt";
      if (!truncatable) throw e;
    }
    const more = await readSlice(file, 0, JPEG_FALLBACK);
    try {
      return analyzeBytes(more);
    } catch (e: any) {
      if (!(more.length < file.size && e && e.code === "corrupt")) throw e;
    }
    return analyzeBytes(await readSlice(file, 0, file.size));
  }

  function handle(file: File): void {
    out.innerHTML = '<div class="sil-pf-busy">Analysing your artwork&hellip; nothing is being uploaded.</div>';
    analyzeFile(file)
      .then((data) => render(file.name, data))
      .catch((e: any) =>
        fail(e && e.message ? e.message : "This file could not be read as an image.")
      );
  }

  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => { if (input.files && input.files[0]) handle(input.files[0]); });
  ["dragover", "dragenter"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("sil-pf-over"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("sil-pf-over"); })
  );
  drop.addEventListener("drop", (e: Event) => {
    const dt = (e as DragEvent).dataTransfer;
    if (dt && dt.files && dt.files[0]) handle(dt.files[0]);
  });
})();
