# pdf-viewer-lite

[![npm version](https://img.shields.io/npm/v/@trysac/pdf-viewer-lite.svg)](https://www.npmjs.com/package/@trysac/pdf-viewer-lite)
[![license: MIT](https://img.shields.io/npm/l/@trysac/pdf-viewer-lite.svg)](LICENSE)
[![CI](https://github.com/Trysac/u299-pdf-viewer-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u299-pdf-viewer-lite/actions/workflows/ci.yml)

Framework-free core for an accessible PDF viewer: RFC 8118 fragment parsing, page and zoom state, fit scales, keyboard map, stale-render cancelling and toolbar markup

## Problem

Embedding a PDF usually means the browser's built-in viewer, which cannot be styled or reached by deep links
reliably, or a heavy viewer application. The part that breaks most often is not drawing the page but the state
around it: page clamping, fit-to-width math after rotation, keyboard handling, screen reader announcements and
renders that finish out of order. This library provides that core behind a renderer port, so any rendering
engine can sit underneath. It does not parse or draw PDFs itself, and it never touches DOM globals: events and
containers are plain objects that the host wires to the real DOM.

## Install

```sh
npm install @trysac/pdf-viewer-lite
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations and has no runtime
dependencies.

## Usage

```ts
import { createViewer, parsePdfFragment, renderToolbar, type PdfRenderer } from "@trysac/pdf-viewer-lite";

// Deep link: "#page=3&zoom=150,0,0" -> { page: 3, zoom: 150 }
const fragment = parsePdfFragment(window.location.hash);

const viewer = createViewer(renderer, {
  container: { width: 918, height: 600 },
  initialPage: fragment.page,
  initialZoom: fragment.zoom ?? "fit-width",
  onChange: (state) => toolbarElement.innerHTML = renderToolbar(state),
  onEvent: (event) => console.error(event.type, event.page),
});

toolbarElement.addEventListener("click", (event) => {
  const action = (event.target as HTMLElement).dataset.action;
  if (action === "next") viewer.dispatch({ type: "next" });
  if (action === "prev") viewer.dispatch({ type: "prev" });
  if (action === "zoomIn") viewer.dispatch({ type: "zoomIn" });
  if (action === "zoomOut") viewer.dispatch({ type: "zoomOut" });
});

document.addEventListener("keydown", (event) => {
  if (viewer.handleKey({ key: event.key, ctrlKey: event.ctrlKey })) event.preventDefault();
});
```

The `renderer` is any object implementing the port; here is a pdf.js adapter used as a docs example (pdf.js is
not a dependency of this package):

```ts
import * as pdfjs from "pdfjs-dist";
import type { PdfRenderer, Rotation } from "@trysac/pdf-viewer-lite";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";

export function pdfjsRenderer(document: pdfjs.PDFDocumentProxy): PdfRenderer {
  return {
    pageCount: () => document.numPages,
    pageSize: (page) => {
      // pdf.js page sizes are async; prefetch them before calling this port synchronously.
      const viewport = cachedViewports.get(page);
      if (!viewport) throw new Error(`page ${page} not loaded`);
      return { width: viewport.width, height: viewport.height };
    },
    render: async (page: number, scale: number, rotation: Rotation) => {
      const pdfPage = await document.getPage(page);
      const viewport = pdfPage.getViewport({ scale, rotation });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await pdfPage.render({ canvasContext: context, viewport }).promise;
    },
  };
}
```

## API

| Export | Signature | Description |
|---|---|---|
| `parsePdfFragment` | `(fragment: string) => { page?: number; nameddest?: string; zoom?: number }` | Parses an RFC 8118 fragment (`#page=3&nameddest=intro&zoom=150,0,0`); invalid values and unknown parameters are dropped, and input longer than 2048 characters returns `{}`. |
| `createViewer` | `(renderer: PdfRenderer, opts: ViewerOptions) => Viewer` | Creates the state core. Throws `ViewerError` with code `invalid_document` for a non-positive or non-integer `pageCount`, and `invalid_layout` for a zero or negative container size. |
| `computeScale` | `(page, container, zoom: Zoom, rotation: Rotation) => number` | Computes `fit-width`, `fit-page` or percent scale, swapping width and height for rotations 90 and 270. |
| `renderToolbar` | `(state: { page: number; pageCount: number; zoom: number }, labels?: Partial<ToolbarLabels>) => string` | Returns the accessible toolbar markup with all label text and attribute values HTML-escaped. |
| `ViewerError` | `class ViewerError extends Error` | Error with a readonly `code` of `'invalid_document'` or `'invalid_layout'`. |

### Types

```ts
type Rotation = 0 | 90 | 180 | 270;
type Zoom = "fit-width" | "fit-page" | number; // number is a percentage

type Action =
  | { type: "goto"; page: number }
  | { type: "next" }
  | { type: "prev" }
  | { type: "first" }
  | { type: "last" }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "setZoom"; zoom: Zoom }
  | { type: "rotate" }
  | { type: "resize" };

interface ViewerState {
  page: number;
  pageCount: number;
  zoom: Zoom;
  scale: number;
  rotation: Rotation;
  announcement: string;
  renderedPage: number;
  error: "render_failed" | null;
}

interface PdfRenderer {
  pageCount(): number;
  pageSize(page: number): { width: number; height: number };
  render(page: number, scale: number, rotation: Rotation): Promise<void>;
}

interface ViewerOptions {
  container: { width: number; height: number };
  initialPage?: number;
  initialZoom?: Zoom;
  onChange?: (state: ViewerState) => void;
  onEvent?: (event: ViewerEvent) => void;
}

type ViewerEvent = { type: "render_error"; page: number };

interface Viewer {
  state: ViewerState;
  dispatch(action: Action): void;
  handleKey(e: { key: string; ctrlKey?: boolean; targetIsEditable?: boolean }): boolean;
}

interface ToolbarLabels {
  previous?: string;
  next?: string;
  zoomOut?: string;
  zoomIn?: string;
  controlsLabel?: string;
}
```

### Behaviour

- Page navigation clamps to `1..pageCount`; `next` on the last page and `prev` on the first page are no-ops.
- Zoom in/out step through `[25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500]`;
  fit modes use `round(scale * 100)` as the starting percentage.
- `announcement` receives `Page <n> of <total>` after page changes and `<percent>% zoom` after zoom changes,
  ready for an `aria-live` region.
- Keyboard map: `ArrowRight`/`PageDown`/`j` next, `ArrowLeft`/`PageUp`/`k` prev, `Home` first, `End` last,
  `+`/`=` zoom in, `-` zoom out, `0` fit-width, `r` rotate clockwise. Keys with `ctrlKey` or
  `targetIsEditable` are ignored.
- Every page, scale or rotation change increments an internal generation counter and calls `renderer.render`
  once; completions from older generations are ignored, so an out-of-order render cannot overwrite
  `renderedPage`. A failed latest render sets `error` to `"render_failed"` and emits
  `{ type: "render_error", page }`.

## Development

```sh
npm install
npm run check   # lint, format, types, tests with coverage, docs, secrets
```

See [AGENTS.md](AGENTS.md) for the full command list and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License

[MIT](LICENSE) © 2026 Miguel Gomez
