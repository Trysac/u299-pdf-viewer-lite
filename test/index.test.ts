import { describe, expect, it, vi } from "vitest";
import {
  computeScale,
  createViewer,
  type PdfRenderer,
  parsePdfFragment,
  renderToolbar,
  ViewerError,
  type ViewerEvent,
} from "../src/index.js";

const createMockRenderer = (overrides: Partial<PdfRenderer> = {}) => {
  const render = vi.fn(async () => {});
  const pageCount = vi.fn(() => 10);
  const pageSize = vi.fn(() => ({ width: 612, height: 792 }));
  const renderer: PdfRenderer = {
    pageCount,
    pageSize,
    render,
    ...overrides,
  };
  return { renderer, render, pageCount, pageSize };
};

describe("parsePdfFragment", () => {
  it("parses page and zoom from a fragment with leading #", () => {
    expect(parsePdfFragment("#page=3&zoom=150,0,0")).toEqual({ page: 3, zoom: 150 });
  });

  it("parses nameddest from a fragment", () => {
    expect(parsePdfFragment("#nameddest=intro")).toEqual({ nameddest: "intro" });
  });

  it("ignores page=0, page=abc and unknown parameters, returning {}", () => {
    expect(parsePdfFragment("#page=0")).toEqual({});
    expect(parsePdfFragment("#page=abc")).toEqual({});
    expect(parsePdfFragment("#unknown=value&foo=bar")).toEqual({});
  });

  it("returns {} for fragments longer than 2048 characters", () => {
    const long = `#${"a".repeat(2049)}`;
    expect(parsePdfFragment(long)).toEqual({});
  });

  it("percent-decodes parameter names and values", () => {
    expect(parsePdfFragment("#na%6Deddest=chapter%201")).toEqual({ nameddest: "chapter 1" });
  });

  it("drops parameters with malformed percent-encoding", () => {
    expect(parsePdfFragment("#nameddest=%E0%A4%A")).toEqual({});
  });

  it("ignores zoom scales below 1 or above 6400", () => {
    expect(parsePdfFragment("#zoom=0")).toEqual({});
    expect(parsePdfFragment("#zoom=6401")).toEqual({});
  });

  it("keeps the scale from zoom with extra coordinates", () => {
    expect(parsePdfFragment("#zoom=75,10,20")).toEqual({ zoom: 75 });
  });

  it("allows fragment without leading #", () => {
    expect(parsePdfFragment("page=5&zoom=80")).toEqual({ page: 5, zoom: 80 });
  });

  it("handles empty fragment and components", () => {
    expect(parsePdfFragment("")).toEqual({});
    expect(parsePdfFragment("#")).toEqual({});
    expect(parsePdfFragment("#&page=3")).toEqual({ page: 3 });
  });

  it("last occurrence wins for repeated parameters", () => {
    expect(parsePdfFragment("#page=1&page=2")).toEqual({ page: 2 });
  });
});

describe("computeScale", () => {
  const page = { width: 612, height: 792 };
  const container = { width: 918, height: 600 };

  it("matches the acceptance values", () => {
    expect(computeScale(page, container, "fit-width", 0)).toBe(1.5);
    expect(computeScale(page, container, "fit-page", 0)).toBe(0.7575757575757576);
    expect(computeScale(page, container, "fit-width", 90)).toBe(1.1590909090909092);
    expect(computeScale(page, container, "fit-page", 90)).toBe(0.9803921568627451);
  });

  it("returns percent / 100 for numeric zoom", () => {
    expect(computeScale(page, container, 150, 0)).toBe(1.5);
    expect(computeScale(page, container, 75, 180)).toBe(0.75);
  });
});

describe("ViewerError", () => {
  it("has the correct code", () => {
    const err = new ViewerError("invalid_document");
    expect(err.code).toBe("invalid_document");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ViewerError");
  });

  it("supports custom message", () => {
    const err = new ViewerError("invalid_layout", "bad container");
    expect(err.message).toBe("bad container");
  });
});

describe("createViewer", () => {
  it("clamps initialPage to pageCount", () => {
    const { renderer } = createMockRenderer();
    const viewer = createViewer(renderer, {
      container: { width: 100, height: 100 },
      initialPage: 12,
    });
    expect(viewer.state.page).toBe(10);
  });

  it("throws ViewerError for invalid pageCount (0)", () => {
    const { renderer } = createMockRenderer({ pageCount: () => 0 });
    expect(() => createViewer(renderer, { container: { width: 100, height: 100 } })).toThrowError(
      new ViewerError("invalid_document"),
    );
  });

  it("throws ViewerError for non-integer pageCount (2.5)", () => {
    const { renderer } = createMockRenderer({ pageCount: () => 2.5 });
    expect(() => createViewer(renderer, { container: { width: 100, height: 100 } })).toThrowError(
      new ViewerError("invalid_document"),
    );
  });

  it("throws ViewerError for container width 0", () => {
    const { renderer } = createMockRenderer();
    expect(() => createViewer(renderer, { container: { width: 0, height: 100 } })).toThrowError(
      new ViewerError("invalid_layout"),
    );
  });

  it("throws ViewerError for container height 0", () => {
    const { renderer } = createMockRenderer();
    expect(() => createViewer(renderer, { container: { width: 100, height: 0 } })).toThrowError(
      new ViewerError("invalid_layout"),
    );
  });

  it("throws ViewerError when pageSize cannot be read", () => {
    const { renderer } = createMockRenderer({
      pageSize: () => {
        throw new Error("boom");
      },
    });
    expect(() => createViewer(renderer, { container: { width: 100, height: 100 } })).toThrowError(
      new ViewerError("invalid_document"),
    );
  });

  it("ignores non-finite goto pages and truncates fractional ones", () => {
    const { renderer } = createMockRenderer();
    const viewer = createViewer(renderer, { container: { width: 100, height: 100 } });
    viewer.dispatch({ type: "goto", page: Number.NaN });
    expect(viewer.state.page).toBe(1);
    viewer.dispatch({ type: "goto", page: 2.5 });
    expect(viewer.state.page).toBe(2);
  });

  it("falls back to page 1 for a non-finite initialPage", () => {
    const { renderer } = createMockRenderer();
    const viewer = createViewer(renderer, {
      container: { width: 100, height: 100 },
      initialPage: Number.NaN,
    });
    expect(viewer.state.page).toBe(1);
  });

  it("clamps goto page and keeps page on next at last page", () => {
    const { renderer } = createMockRenderer();
    const viewer = createViewer(renderer, { container: { width: 100, height: 100 } });
    viewer.dispatch({ type: "goto", page: 12 });
    expect(viewer.state.page).toBe(10);
    expect(viewer.state.announcement).toBe("Page 10 of 10");
    viewer.dispatch({ type: "next" });
    expect(viewer.state.page).toBe(10);
  });

  it("zoomIn and zoomOut follow steps correctly", () => {
    const { renderer } = createMockRenderer();
    const viewer = createViewer(renderer, {
      container: { width: 100, height: 100 },
      initialZoom: 100,
    });
    viewer.dispatch({ type: "zoomIn" });
    expect(viewer.state.zoom).toBe(110);
    viewer.dispatch({ type: "zoomOut" });
    expect(viewer.state.zoom).toBe(100);
    viewer.dispatch({ type: "setZoom", zoom: 25 });
    viewer.dispatch({ type: "zoomOut" });
    expect(viewer.state.zoom).toBe(25); // stays clamped
  });

  it("zoomIn from fit-width uses computed percent and goes to next higher step", () => {
    const { renderer } = createMockRenderer({
      pageSize: () => ({ width: 100, height: 100 }),
    });
    const viewer = createViewer(renderer, {
      container: { width: 137, height: 200 },
      initialZoom: "fit-width",
    });
    expect(viewer.state.scale).toBeCloseTo(1.37);
    viewer.dispatch({ type: "zoomIn" });
    expect(viewer.state.zoom).toBe(150);
  });

  it("handleKey maps navigation and zoom actions, ignores editable and ctrl", () => {
    const { renderer } = createMockRenderer();
    const viewer = createViewer(renderer, { container: { width: 100, height: 100 } });

    expect(viewer.handleKey({ key: "ArrowRight" })).toBe(true);
    expect(viewer.state.page).toBe(2);
    expect(viewer.handleKey({ key: "End" })).toBe(true);
    expect(viewer.state.page).toBe(10);
    expect(viewer.handleKey({ key: "+" })).toBe(true);
    // zoom changed from default fit-width? we need set explicit zoom for predictable
    // Instead test on a viewer with numeric zoom
    const viewer2 = createViewer(renderer, {
      container: { width: 100, height: 100 },
      initialZoom: 100,
    });
    expect(viewer2.handleKey({ key: "r" })).toBe(true);
    expect(viewer2.state.rotation).toBe(90);
    expect(viewer2.handleKey({ key: "ArrowRight", targetIsEditable: true })).toBe(false);
    expect(viewer2.handleKey({ key: "ArrowRight", ctrlKey: true })).toBe(false);
  });

  it("resize recomputes a fit scale from the current container", () => {
    const container = { width: 100, height: 100 };
    const { renderer } = createMockRenderer({ pageSize: () => ({ width: 100, height: 100 }) });
    const viewer = createViewer(renderer, { container, initialZoom: "fit-width" });
    expect(viewer.state.scale).toBe(1);
    container.width = 200;
    viewer.dispatch({ type: "resize" });
    expect(viewer.state.scale).toBe(2);
  });

  it("rotates through 270 and back to 0, recomputing the fit scale", () => {
    const { renderer } = createMockRenderer({ pageSize: () => ({ width: 100, height: 200 }) });
    const viewer = createViewer(renderer, {
      container: { width: 100, height: 100 },
      initialZoom: "fit-width",
    });
    expect(viewer.state.scale).toBe(1);
    viewer.dispatch({ type: "rotate" });
    expect(viewer.state.rotation).toBe(90);
    expect(viewer.state.scale).toBe(0.5);
    viewer.dispatch({ type: "rotate" });
    viewer.dispatch({ type: "rotate" });
    expect(viewer.state.rotation).toBe(270);
    viewer.dispatch({ type: "rotate" });
    expect(viewer.state.rotation).toBe(0);
    expect(viewer.state.scale).toBe(1);
  });

  it("ignore no-op dispatches and clamps zoom at the ends", () => {
    const { renderer, render } = createMockRenderer();
    const onChange = vi.fn();
    const viewer = createViewer(renderer, {
      container: { width: 100, height: 100 },
      initialZoom: 500,
      onChange,
    });
    expect(render).toHaveBeenCalledTimes(1);
    viewer.dispatch({ type: "goto", page: 1 });
    viewer.dispatch({ type: "prev" });
    viewer.dispatch({ type: "first" });
    viewer.dispatch({ type: "zoomIn" });
    expect(viewer.state.zoom).toBe(500);
    expect(render).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    viewer.dispatch({ type: "setZoom", zoom: 500 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("handleKey covers prev, Home, zoom out, fit-width and unknown keys", () => {
    const { renderer } = createMockRenderer();
    const viewer = createViewer(renderer, {
      container: { width: 100, height: 100 },
      initialZoom: 150,
    });
    expect(viewer.handleKey({ key: "ArrowRight" })).toBe(true);
    expect(viewer.handleKey({ key: "ArrowLeft" })).toBe(true);
    expect(viewer.handleKey({ key: "PageDown" })).toBe(true);
    expect(viewer.handleKey({ key: "PageUp" })).toBe(true);
    expect(viewer.handleKey({ key: "k" })).toBe(true);
    expect(viewer.handleKey({ key: "j" })).toBe(true);
    expect(viewer.handleKey({ key: "Home" })).toBe(true);
    expect(viewer.state.page).toBe(1);
    expect(viewer.handleKey({ key: "-" })).toBe(true);
    expect(viewer.state.zoom).toBe(125);
    expect(viewer.handleKey({ key: "0" })).toBe(true);
    expect(viewer.state.zoom).toBe("fit-width");
    expect(viewer.handleKey({ key: "x" })).toBe(false);
  });

  it("announces page and zoom changes", () => {
    const { renderer } = createMockRenderer();
    const viewer = createViewer(renderer, {
      container: { width: 100, height: 100 },
      initialZoom: 100,
    });
    viewer.dispatch({ type: "next" });
    expect(viewer.state.announcement).toBe("Page 2 of 10");
    viewer.dispatch({ type: "zoomIn" });
    expect(viewer.state.announcement).toBe("110% zoom");
    viewer.dispatch({ type: "last" });
    expect(viewer.state.announcement).toBe("Page 10 of 10");
  });

  it("keeps the latest renderedPage when stale renders resolve last", async () => {
    const resolvers: Array<() => void> = [];
    const render = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolvers.push(res);
        }),
    );
    const renderer: PdfRenderer = {
      pageCount: () => 10,
      pageSize: () => ({ width: 612, height: 792 }),
      render,
    };
    const viewer = createViewer(renderer, { container: { width: 100, height: 100 } });
    // Initial render (generation 1) is still pending; jump to pages 2 and 3.
    viewer.dispatch({ type: "goto", page: 2 });
    viewer.dispatch({ type: "goto", page: 3 });
    expect(render).toHaveBeenCalledTimes(3);
    expect(viewer.state.renderedPage).toBe(0);

    // Resolve the latest render (generation 3) first.
    resolvers[2]?.();
    await vi.waitFor(() => expect(viewer.state.renderedPage).toBe(3));

    // The stale page 2 render resolves last and must be ignored.
    resolvers[1]?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(viewer.state.renderedPage).toBe(3);

    // The oldest render is ignored as well.
    resolvers[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(viewer.state.renderedPage).toBe(3);
  });

  it("rejected latest render sets error and fires onEvent", async () => {
    const render = vi.fn().mockRejectedValueOnce(new Error("fail"));
    const renderer: PdfRenderer = {
      pageCount: () => 10,
      pageSize: () => ({ width: 612, height: 792 }),
      render,
    };
    const onEvent = vi.fn();
    const viewer = createViewer(renderer, { container: { width: 100, height: 100 }, onEvent });
    // Wait for initial render rejection
    await vi.waitFor(() => expect(viewer.state.error).toBe("render_failed"));
    expect(onEvent).toHaveBeenCalledWith({ type: "render_error", page: 1 } satisfies ViewerEvent);
  });
});

describe("renderToolbar", () => {
  it("matches the acceptance markup exactly", () => {
    const html = renderToolbar({ page: 1, pageCount: 10, zoom: 100 });
    expect(html).toBe(
      '<div role="toolbar" aria-label="PDF controls"><button type="button" data-action="prev" disabled>Previous</button><label>Page <input type="number" min="1" max="10" value="1" data-action="goto"> of 10</label><button type="button" data-action="next">Next</button><button type="button" data-action="zoom-out" aria-label="Zoom out">-</button><output aria-live="polite">100%</output><button type="button" data-action="zoom-in" aria-label="Zoom in">+</button></div>',
    );
  });

  it("disables prev on page 1 and next on last page", () => {
    const html1 = renderToolbar({ page: 1, pageCount: 10, zoom: 100 });
    expect(html1).toContain('data-action="prev" disabled');
    expect(html1).not.toContain('data-action="next" disabled');
    const html2 = renderToolbar({ page: 10, pageCount: 10, zoom: 100 });
    expect(html2).toContain('data-action="next" disabled');
    expect(html2).not.toContain('data-action="prev" disabled');
  });

  it("escapes custom labels", () => {
    const html = renderToolbar(
      { page: 2, pageCount: 5, zoom: 100 },
      {
        previous: '<Prev & "Next">',
        next: "</button><script>alert('x')</script>",
        zoomOut: "Zoom'Out",
        zoomIn: '"Zoom"In"',
        controlsLabel: "<b>Controls</b>",
      },
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;Prev &amp; &quot;Next&quot;&gt;");
    expect(html).toContain("&lt;/button&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(html).toContain("Zoom&#39;Out");
    expect(html).toContain("&quot;Zoom&quot;In&quot;");
    expect(html).toContain("&lt;b&gt;Controls&lt;/b&gt;");
  });
});
