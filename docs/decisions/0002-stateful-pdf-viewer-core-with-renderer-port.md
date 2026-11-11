# Stateful PDF viewer core with renderer port

Status: accepted (generated, pending human review)

## Context

Embedding a PDF usually means the browser's built-in viewer, which cannot be styled or reached by deep links reliably, or a heavy viewer application. The part that breaks most often is not drawing the page but the state around it: page clamping, fit-to-width math after rotation, keyboard handling, screen reader announcements and renders that finish out of order.

## Decision

Implement a framework-free TypeScript core that encapsulates page and zoom state, RFC 8118 fragment parsing, fit scale computation with rotation, keyboard navigation, announcement generation, and stale-render cancellation. The core accepts a PdfRenderer interface for actual page drawing, decoupling it from any specific PDF engine.

## Consequences

Any PDF rendering library can be adapted by implementing three methods. The core remains lightweight (no runtime dependencies), testable, and usable in any host environment. Rendering engine failures are surfaced as typed events and state, not exceptions. Out-of-order rendering is handled via generation counters.
