# Print Preflight & DPI Checker

Check whether an image has enough resolution for professional printing —
**before** it goes to press. Reads only the file header (PNG, JPEG, WebP,
TIFF — both endians), so a 200 MB TIFF is checked in milliseconds, and
**the file never leaves your machine**: no upload, no telemetry, no network
requests at all.

For every ISO A-series size (A0–A6) it reports the effective DPI, a verdict
(Excellent / Good / Acceptable for large-format / Low / Not recommended),
the recommended maximum print size, and a deterministic print-readiness
score with the formula shown.

## Where it runs

| Surface | Where |
|---|---|
| **Browser** (no install) | [silverimagelondon.com/tools/print-preflight](https://www.silverimagelondon.com/tools/print-preflight) |
| **VS Code extension** | [Marketplace: Print Preflight & DPI Checker](https://marketplace.visualstudio.com/items?itemName=silver-image.silver-image-print-preflight) |

Both run the same core — one set of parsers, one scoring formula, identical
answers.

## Repository layout

```
core/               shared TypeScript core: header parsers + DPI math + scoring
  src/core.ts
  test/test.mjs     29 tests incl. a golden vector (4961×3508 → A1, score 82)
vscode-extension/   thin VS Code wrapper around the core
web/                browser UI used on the website
```

## Build

```
# core (dual ESM/CJS build)
cd core && npx tsc -p tsconfig.esm.json && npx tsc -p tsconfig.cjs.json
node test/test.mjs

# extension
cd vscode-extension && npm install && npx @vscode/vsce package
```

## Why header-only parsing?

Print preflight needs pixel dimensions, not pixels. Reading IHDR/SOF/VP8/IFD
directly means huge files cost nothing, and nothing needs to be decoded,
uploaded or cached — which is the whole privacy story: verify it yourself in
the browser's network tab while the web tool runs.

## Related guides and templates

The guides below, from Silver Image Print & Signs, work through the numbers the tool reports:

- [What DPI do you need for an A0 poster?](https://www.silverimagelondon.com/guides/what-dpi-for-a0-poster-printing)
- [How many pixels does a photo need for a canvas print?](https://www.silverimagelondon.com/guides/how-many-pixels-for-a-canvas-print)
- [What file format is best to send to a printer?](https://www.silverimagelondon.com/guides/what-file-format-for-printing)
- [How much bleed does each print product need?](https://www.silverimagelondon.com/guides/how-much-bleed-does-each-print-product-need)

Artwork templates at 1:1 in millimetres, with bleed, cut line and safe zone marked, are in
[silver-image/print-templates](https://github.com/silver-image/print-templates).

## License

MIT — see [LICENSE](LICENSE).

---

Built and maintained by [Silver Image Print & Signs](https://www.silverimagelondon.com),
a 24/7 print production house in London. The thresholds in the verdicts
(150 DPI for large-format viewing distance, 200 for close viewing, 300 in
hand) are the ones our own press floor quotes to clients every day.
