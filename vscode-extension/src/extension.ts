/**
 * Silver Image Print Preflight — VS Code wrapper.
 * Thin shell over the shared core (out/core.js, copied at build time from
 * core/dist/cjs). All analysis is local to the extension host process;
 * the file is read from disk and never transmitted anywhere.
 */
import * as vscode from "vscode";

// Wspolny rdzen — ten sam plik liczy na stronie /tools/print-preflight.
// eslint-disable-next-line @typescript-eslint/no-var-requires
declare function require(id: string): unknown;
const core = require("./core") as {
  analyzeBytes(bytes: Uint8Array): import("./core-types").AnalyzeReturn;
};

const IMAGE_EXT = /\.(jpe?g|png|webp|tiff?)$/i;
const TOOL_URL = "https://www.silverimagelondon.com/tools/print-preflight";
const SITE_URL = "https://www.silverimagelondon.com";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}

const VERDICT: Record<string, [string, string]> = {
  "excellent": ["Excellent", "ok"],
  "good": ["Good", "ok"],
  "acceptable-large-format": ["Acceptable for large-format", "warn"],
  "low": ["Low resolution", "warn"],
  "not-recommended": ["Not recommended", "bad"],
};

function resultHtml(fileName: string, data: import("./core-types").AnalyzeReturn): string {
  const r = data.result;
  const rows = r.formats
    .map((f) => {
      const [label, cls] = VERDICT[f.verdict];
      const dpi = f.capped ? "300+" : String(f.dpi);
      const rec = f.paper === r.recommendedMax ? ' <span class="rec">recommended max</span>' : "";
      return `<tr class="${cls}"><td>${f.paper}</td><td>${dpi} DPI</td><td>${label}${rec}</td></tr>`;
    })
    .join("");
  let recLine: string;
  if (r.recommendedMax) {
    const [qualityLabel] = VERDICT[r.recommendedMaxVerdict ?? "excellent"];
    recLine = `<p class="max">Recommended maximum size: <strong>${r.recommendedMax}</strong> <span class="quality">&middot; quality at ${r.recommendedMax}: ${qualityLabel}</span></p>`;
    if (r.closeViewingMax && r.closeViewingMax !== r.recommendedMax) {
      recLine += `<p class="close">For close viewing (read in hand): <strong>${r.closeViewingMax}</strong> recommended</p>`;
    }
  } else {
    recLine = `<p class="max bad-note">Below 150 DPI even at A6 — a higher-resolution original is needed for print.</p>`;
  }
  const aspect = r.aspectWarning
    ? `<p class="note warn-note">Proportions do not match the A-series sheet (&radic;2) — printing at a standard size will need cropping or borders.</p>`
    : "";
  return `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px 18px;max-width:640px}
h2{font-size:16px;margin:0 0 2px} .meta{opacity:.75;font-size:12px;margin:0 0 10px}
table{border-collapse:collapse;width:100%;margin:8px 0}
th,td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--vscode-editorWidget-border,#444);font-size:13px}
.ok td{color:var(--vscode-testing-iconPassed,#4ec96f)}
.warn td{color:var(--vscode-editorWarning-foreground,#cca700)}
.bad td{color:var(--vscode-editorError-foreground,#f14c4c)}
.rec{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-radius:9px;padding:1px 8px;font-size:11px;margin-left:6px}
.brand{font-size:10px;letter-spacing:.12em;opacity:.6;margin:0 0 10px} .brand span{letter-spacing:.02em;text-transform:none}
.max{font-size:14px} .quality{opacity:.7;font-size:12px;font-weight:400} .close{font-size:13px} .note{opacity:.75;font-size:12px;line-height:1.5}
h2{overflow-wrap:anywhere}
.warn-note{color:var(--vscode-editorWarning-foreground,#cca700)}
.bad-note{color:var(--vscode-editorError-foreground,#f14c4c)}
.privacy{color:var(--vscode-testing-iconPassed,#4ec96f);font-size:12px;font-weight:600}
.links{font-size:12px;margin-top:14px} .score{font-size:14px}
</style></head><body>
<p class="brand">SILVER IMAGE PRINT PREFLIGHT <span>&middot; DPI, Print Size &amp; Artwork Resolution Checker</span></p>
<h2>${esc(fileName)}</h2>
<p class="meta">${r.width.toLocaleString()} &times; ${r.height.toLocaleString()} px &middot; ${r.megapixels} MP &middot; ${r.orientation} &middot; aspect ${r.aspectRatio}:1</p>
<table><thead><tr><th>Size</th><th>Effective DPI</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table>
${recLine}${aspect}
<p class="score">Print readiness: <strong>${r.score} / 100</strong></p>
<p class="note">Acceptable DPI depends on viewing distance and artwork type — large-format work viewed from metres away forgives far more than in-hand print. Score: ${esc(r.scoreBreakdown)}.</p>
<p class="privacy">This file was analysed locally. It never left your machine.</p>
<p class="links">Need it printed today in London? <a href="${SITE_URL}/contact">Get a quote</a> &middot; <a href="${TOOL_URL}">Full web tool</a> &middot; <a href="${SITE_URL}">Silver Image Print &amp; Signs</a></p>
</body></html>`;
}

export function activate(context: vscode.ExtensionContext): void {
  const cmd = vscode.commands.registerCommand(
    "silverImagePreflight.checkFile",
    async (uri?: vscode.Uri) => {
      let target = uri;
      if (!target) {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: "Check for print",
          filters: { Images: ["jpg", "jpeg", "png", "webp", "tif", "tiff"] },
        });
        if (!picked || !picked[0]) return;
        target = picked[0];
      }
      if (!IMAGE_EXT.test(target.path)) {
        vscode.window.showWarningMessage(
          "Print Preflight supports JPG, PNG, WebP and TIFF files."
        );
        return;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(target);
        const data = core.analyzeBytes(bytes);
        const fileName = target.path.split("/").pop() ?? target.path;
        const panel = vscode.window.createWebviewPanel(
          "silverImagePreflight",
          `Preflight: ${fileName}`,
          vscode.ViewColumn.Beside,
          { enableScripts: false }
        );
        panel.webview.html = resultHtml(fileName, data);
      } catch (e: unknown) {
        const msg =
          e instanceof Error ? e.message : "The file could not be analysed.";
        vscode.window.showErrorMessage(`Print Preflight: ${msg}`);
      }
    }
  );
  context.subscriptions.push(cmd);
}

export function deactivate(): void {
  /* nothing to clean up */
}
