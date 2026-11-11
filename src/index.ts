export type Rotation = 0 | 90 | 180 | 270;
export type Zoom = "fit-width" | "fit-page" | number;

export type Action =
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

export interface ViewerState {
  page: number;
  pageCount: number;
  zoom: Zoom;
  scale: number;
  rotation: Rotation;
  announcement: string;
  renderedPage: number;
  error: "render_failed" | null;
}

export interface PdfRenderer {
  pageCount(): number;
  pageSize(page: number): { width: number; height: number };
  render(page: number, scale: number, rotation: Rotation): Promise<void>;
}

export interface ViewerOptions {
  container: { width: number; height: number };
  initialPage?: number;
  initialZoom?: Zoom;
  onChange?: (state: ViewerState) => void;
  onEvent?: (event: ViewerEvent) => void;
}

export type ViewerEvent = { type: "render_error"; page: number };

export interface Viewer {
  state: ViewerState;
  dispatch(action: Action): void;
  handleKey(e: { key: string; ctrlKey?: boolean; targetIsEditable?: boolean }): boolean;
}

export interface ToolbarLabels {
  previous?: string;
  next?: string;
  zoomOut?: string;
  zoomIn?: string;
  controlsLabel?: string;
}

export class ViewerError extends Error {
  readonly code: "invalid_document" | "invalid_layout";

  constructor(code: "invalid_document" | "invalid_layout", message?: string) {
    super(message ?? code);
    this.name = "ViewerError";
    this.code = code;
  }
}

export function parsePdfFragment(fragment: string): {
  page?: number;
  nameddest?: string;
  zoom?: number;
} {
  if (fragment.length > 2048) {
    return {};
  }
  const trimmed = fragment.trim();
  let str = trimmed;
  if (str.startsWith("#")) {
    str = str.slice(1);
  }

  const result: { page?: number; nameddest?: string; zoom?: number } = {};
  if (str === "") {
    return result;
  }

  const decode = (s: string): string | null => {
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  };

  for (const part of str.split("&")) {
    if (part === "") {
      continue;
    }
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const rawKey = part.slice(0, eqIndex);
    const rawValue = part.slice(eqIndex + 1);
    const key = decode(rawKey);
    const value = decode(rawValue);
    if (key === null || value === null) {
      continue;
    }

    switch (key) {
      case "page": {
        if (/^\d+$/.test(value)) {
          const pageNum = Number(value);
          if (Number.isInteger(pageNum) && pageNum >= 1) {
            result.page = pageNum;
          }
        }
        break;
      }
      case "nameddest": {
        if (value !== "") {
          result.nameddest = value;
        }
        break;
      }
      case "zoom": {
        const [scaleStr] = value.split(",");
        if (scaleStr !== undefined) {
          const scale = Number(scaleStr);
          if (Number.isFinite(scale) && scale >= 1 && scale <= 6400) {
            result.zoom = scale;
          }
        }
        break;
      }
      default:
        // Unknown parameter: ignore silently.
        break;
    }
  }
  return result;
}

export function computeScale(
  page: { width: number; height: number },
  container: { width: number; height: number },
  zoom: Zoom,
  rotation: Rotation,
): number {
  let w = page.width;
  let h = page.height;
  if (rotation === 90 || rotation === 270) {
    [w, h] = [h, w];
  }
  if (zoom === "fit-width") {
    return container.width / w;
  }
  if (zoom === "fit-page") {
    return Math.min(container.width / w, container.height / h);
  }
  return zoom / 100;
}

const ZOOM_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];

export function renderToolbar(
  state: { page: number; pageCount: number; zoom: number },
  labels: Partial<ToolbarLabels> = {},
): string {
  const previous = labels.previous ?? "Previous";
  const next = labels.next ?? "Next";
  const zoomOut = labels.zoomOut ?? "Zoom out";
  const zoomIn = labels.zoomIn ?? "Zoom in";
  const controlsLabel = labels.controlsLabel ?? "PDF controls";

  const escapeHtml = (s: string): string =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
    );

  const prevDisabled = state.page <= 1;
  const nextDisabled = state.page >= state.pageCount;
  const zoomPercent = Math.round(state.zoom);

  return `<div role="toolbar" aria-label="${escapeHtml(controlsLabel)}"><button type="button" data-action="prev"${prevDisabled ? " disabled" : ""}>${escapeHtml(previous)}</button><label>Page <input type="number" min="1" max="${state.pageCount}" value="${state.page}" data-action="goto"> of ${state.pageCount}</label><button type="button" data-action="next"${nextDisabled ? " disabled" : ""}>${escapeHtml(next)}</button><button type="button" data-action="zoom-out" aria-label="${escapeHtml(zoomOut)}">-</button><output aria-live="polite">${zoomPercent}%</output><button type="button" data-action="zoom-in" aria-label="${escapeHtml(zoomIn)}">+</button></div>`;
}

export function createViewer(renderer: PdfRenderer, opts: ViewerOptions): Viewer {
  const pageCount = renderer.pageCount();
  if (!Number.isInteger(pageCount) || pageCount <= 0) {
    throw new ViewerError("invalid_document");
  }
  if (opts.container.width <= 0 || opts.container.height <= 0) {
    throw new ViewerError("invalid_layout");
  }

  const requestedPage = opts.initialPage;
  const initialPage = Number.isFinite(requestedPage)
    ? Math.max(1, Math.min(Math.trunc(requestedPage as number), pageCount))
    : 1;
  const initialZoom = opts.initialZoom ?? "fit-width";

  const getPageSize = (page: number): { width: number; height: number } => {
    try {
      return renderer.pageSize(page);
    } catch {
      throw new ViewerError("invalid_document");
    }
  };

  let currentState: ViewerState = {
    page: initialPage,
    pageCount,
    zoom: initialZoom,
    scale: computeScale(getPageSize(initialPage), opts.container, initialZoom, 0),
    rotation: 0,
    announcement: "",
    renderedPage: 0,
    error: null,
  };

  let generation = 0;

  const updateState = (patch: Partial<ViewerState>, shouldRender: boolean): void => {
    currentState = { ...currentState, ...patch };
    if (shouldRender) {
      scheduleRender();
    }
    opts.onChange?.(currentState);
  };

  const scheduleRender = (): void => {
    const page = currentState.page;
    const scale = currentState.scale;
    const rotation = currentState.rotation;
    generation += 1;
    const gen = generation;

    renderer.render(page, scale, rotation).then(
      () => {
        if (gen === generation) {
          updateState({ renderedPage: page, error: null }, false);
        }
      },
      () => {
        if (gen === generation) {
          updateState({ error: "render_failed" }, false);
          opts.onEvent?.({ type: "render_error", page });
        }
      },
    );
  };

  const getPercent = (zoom: Zoom, scale: number): number =>
    typeof zoom === "number" ? zoom : Math.round(scale * 100);

  const recomputeFitScale = (): void => {
    currentState.scale = computeScale(
      getPageSize(currentState.page),
      opts.container,
      currentState.zoom,
      currentState.rotation,
    );
  };

  const dispatch = (action: Action): void => {
    let changed = false;
    let pageChanged = false;
    let scaleChanged = false;
    let rotationChanged = false;
    let newAnnouncement = currentState.announcement;

    switch (action.type) {
      case "goto": {
        if (!Number.isFinite(action.page)) {
          break;
        }
        const newPage = Math.max(1, Math.min(Math.trunc(action.page), currentState.pageCount));
        if (newPage !== currentState.page) {
          const fitsViewport =
            currentState.zoom === "fit-width" || currentState.zoom === "fit-page";
          const newScale = fitsViewport
            ? computeScale(
                getPageSize(newPage),
                opts.container,
                currentState.zoom,
                currentState.rotation,
              )
            : currentState.scale;
          currentState.page = newPage;
          currentState.scale = newScale;
          pageChanged = true;
          changed = true;
          if (fitsViewport) {
            scaleChanged = true;
          }
          newAnnouncement = `Page ${newPage} of ${currentState.pageCount}`;
        }
        break;
      }
      case "next": {
        if (currentState.page < currentState.pageCount) {
          currentState.page += 1;
          pageChanged = true;
          changed = true;
          if (currentState.zoom === "fit-width" || currentState.zoom === "fit-page") {
            recomputeFitScale();
            scaleChanged = true;
          }
          newAnnouncement = `Page ${currentState.page} of ${currentState.pageCount}`;
        }
        break;
      }
      case "prev": {
        if (currentState.page > 1) {
          currentState.page -= 1;
          pageChanged = true;
          changed = true;
          if (currentState.zoom === "fit-width" || currentState.zoom === "fit-page") {
            recomputeFitScale();
            scaleChanged = true;
          }
          newAnnouncement = `Page ${currentState.page} of ${currentState.pageCount}`;
        }
        break;
      }
      case "first": {
        if (currentState.page !== 1) {
          currentState.page = 1;
          pageChanged = true;
          changed = true;
          if (currentState.zoom === "fit-width" || currentState.zoom === "fit-page") {
            recomputeFitScale();
            scaleChanged = true;
          }
          newAnnouncement = `Page 1 of ${currentState.pageCount}`;
        }
        break;
      }
      case "last": {
        if (currentState.page !== currentState.pageCount) {
          currentState.page = currentState.pageCount;
          pageChanged = true;
          changed = true;
          if (currentState.zoom === "fit-width" || currentState.zoom === "fit-page") {
            recomputeFitScale();
            scaleChanged = true;
          }
          newAnnouncement = `Page ${currentState.pageCount} of ${currentState.pageCount}`;
        }
        break;
      }
      case "zoomIn": {
        const percent = getPercent(currentState.zoom, currentState.scale);
        const step = ZOOM_STEPS.find((s) => s > percent);
        if (step !== undefined) {
          currentState.zoom = step;
          currentState.scale = step / 100;
          scaleChanged = true;
          changed = true;
          newAnnouncement = `${step}% zoom`;
        }
        break;
      }
      case "zoomOut": {
        const percent = getPercent(currentState.zoom, currentState.scale);
        const step = [...ZOOM_STEPS].reverse().find((s) => s < percent);
        if (step !== undefined) {
          currentState.zoom = step;
          currentState.scale = step / 100;
          scaleChanged = true;
          changed = true;
          newAnnouncement = `${step}% zoom`;
        }
        break;
      }
      case "setZoom": {
        if (action.zoom !== currentState.zoom) {
          currentState.zoom = action.zoom;
          currentState.scale = computeScale(
            getPageSize(currentState.page),
            opts.container,
            currentState.zoom,
            currentState.rotation,
          );
          scaleChanged = true;
          changed = true;
          const percent = getPercent(currentState.zoom, currentState.scale);
          newAnnouncement = `${percent}% zoom`;
        }
        break;
      }
      case "rotate": {
        currentState.rotation = ((currentState.rotation + 90) % 360) as Rotation;
        rotationChanged = true;
        changed = true;
        if (currentState.zoom === "fit-width" || currentState.zoom === "fit-page") {
          recomputeFitScale();
          scaleChanged = true;
        }
        break;
      }
      case "resize": {
        currentState.scale = computeScale(
          getPageSize(currentState.page),
          opts.container,
          currentState.zoom,
          currentState.rotation,
        );
        scaleChanged = true;
        changed = true;
        break;
      }
      default:
        break;
    }

    if (changed) {
      currentState.announcement = newAnnouncement;
      if (pageChanged || scaleChanged || rotationChanged) {
        scheduleRender();
      }
      opts.onChange?.(currentState);
    }
  };

  const handleKey = (e: {
    key: string;
    ctrlKey?: boolean;
    targetIsEditable?: boolean;
  }): boolean => {
    if (e.ctrlKey || e.targetIsEditable) {
      return false;
    }
    switch (e.key) {
      case "ArrowRight":
      case "PageDown":
      case "j":
        dispatch({ type: "next" });
        return true;
      case "ArrowLeft":
      case "PageUp":
      case "k":
        dispatch({ type: "prev" });
        return true;
      case "Home":
        dispatch({ type: "first" });
        return true;
      case "End":
        dispatch({ type: "last" });
        return true;
      case "+":
      case "=":
        dispatch({ type: "zoomIn" });
        return true;
      case "-":
        dispatch({ type: "zoomOut" });
        return true;
      case "0":
        dispatch({ type: "setZoom", zoom: "fit-width" });
        return true;
      case "r":
        dispatch({ type: "rotate" });
        return true;
      default:
        return false;
    }
  };

  scheduleRender();

  return {
    get state() {
      return currentState;
    },
    dispatch,
    handleKey,
  };
}
