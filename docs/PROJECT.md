# Project record: pdf-viewer-lite

## Objective

Give any rendering engine a small, tested, framework-free state core for an accessible PDF viewer, so hosts do
not have to reimplement page clamping, fit-to-width math after rotation, keyboard handling, screen reader
announcements and stale-render cancellation. The measurable outcome is a public library whose quality gates
(typecheck, tests with coverage, docs and security checks) pass on every change.

## Scope

In scope:

- RFC 8118 fragment parsing, including the Adobe `zoom` extension.
- Page and zoom state with clamping and step-based zoom in/out.
- Fit-width and fit-page scale computation, including rotated pages.
- Keyboard map for navigation, zoom and rotation.
- Stale-render cancellation through a generation counter and the `PdfRenderer` port.
- Accessible toolbar markup with escaped labels.
- A success announcement string suitable for an `aria-live` region.

Out of scope:

- Parsing or drawing PDFs (a renderer such as pdf.js sits underneath the port).
- Text selection, search, annotations and thumbnails.
- Continuous scroll mode.
- DOM globals in the library: events and containers are plain objects wired by the host.

## Timeline

| Date | Milestone |
|---|---|
| 2026-01-01 | Public API, tests and documentation completed for the current release. |

## Effort metrics

Measured values only. Leave "pending measurement" until a real figure is recorded; never estimate here.

| Metric | Value | Source |
|---|---|---|
| Tokens (input / output) | 734215 / 62279 | factory ledger |
| Hours (human) | pending measurement | time log |
| Cost (USD) | 0.0747 | factory ledger |

## Factory run u299 (measured from API usage)

| Date (UTC) | Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|---|
| 2026-11-11 | generation | deepseek-v4-pro | yes | 4160 | 16468 | 0 | 1280 | 0.0354 |
| 2026-11-11 | fix-1 | deepseek-flash | no | 16980 | 5537 | 0 | 196224 | 0.0065 |
| 2026-11-11 | audit | deepseek-flash | no | 20862 | 18799 | 0 | 309760 | 0.0153 |
| 2026-11-11 | fix-2 | deepseek-flash | no | 11609 | 5475 | 0 | 157056 | 0.0055 |
| 2026-11-11 | docs | deepseek-flash | no | 16028 | 16000 | 0 | 256 | 0.0120 |

Total: $0.0747. Prices: deepseek line, as measured by its adapter. Providers serve the current version of each model id, so the date tells which version answered; versions, launch stages and price sources per line are in the factory's model register (docs/MODELS.md).
