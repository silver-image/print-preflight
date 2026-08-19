# Print Preflight & DPI Checker

**DPI, Print Size & Artwork Resolution Checker** — right-click any JPG, PNG,
WebP or TIFF and instantly see whether it has enough resolution for
professional printing, from A6 flyers to A0 posters.

## What it shows

- exact pixel dimensions, megapixels, orientation and aspect ratio
- effective DPI at every ISO A-series size (A0–A6)
- a clear verdict per size: Excellent / Good / Acceptable for large-format / Low / Not recommended
- the recommended maximum print size
- a deterministic print-readiness score (0–100) with the formula shown
- a warning when proportions will not fit an A-series sheet without cropping

## Privacy

**Your file never leaves your machine.** Dimensions are read from the file
header by the extension itself — nothing is uploaded, no telemetry, no
tracking of any kind.

## Installation

1. In VS Code, open the **Extensions** panel (`Ctrl+Shift+X` / `Cmd+Shift+X` on Mac)
2. Search for **"Print Preflight"** or **"DPI checker"**
3. Click **Install** — no configuration, no account, nothing else to set up

Or install from the command line:

```
code --install-extension silver-image.silver-image-print-preflight
```

## Usage

- Right-click a supported image in the Explorer → **Silver Image: Check File for Print**
- or run the same command from the Command Palette and pick a file.

## Rule of thumb

300 DPI is the standard for material read at arm's length. Banners and posters
viewed from a few metres stay sharp at 150 DPI. Acceptable resolution always
depends on viewing distance, artwork type and source-image quality.

## FAQ

**Does it upload my file anywhere?**
No. The file is read locally by the extension process. You can verify this — the
extension makes no network requests at all.

**Which formats are supported?**
JPG/JPEG, PNG, WebP and TIFF (both little- and big-endian).

**Does it work with huge files?**
Yes — only the file header is parsed, so a 200 MB TIFF is checked in
milliseconds without loading the image.

**Why does it say my photo is only good up to A2?**
DPI is pixels divided by print size. A 12 MP phone photo simply does not have
enough pixels for a sharp A0 — the verdict tells you the largest size that
will look right. The rule of thumb below explains the thresholds.

**Do I need VS Code to use the checker?**
No — the same checker runs in any browser at
[silverimagelondon.com/tools/print-preflight](https://www.silverimagelondon.com/tools/print-preflight).

---

Built by [Silver Image Print & Signs](https://www.silverimagelondon.com) —
24/7 print, signage and display production in London.
