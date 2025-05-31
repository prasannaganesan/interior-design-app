# Design System Overview

This document captures the visual design guidelines used across the application.

## Layout

- The application uses a **three‑pane layout** when there is enough horizontal space.
  - **Left panel** – upload and basic color controls.
  - **Center panel** – main canvas area that remains fixed.
  - **Right panel** – dynamic widgets such as wall groups.
- The layout uses CSS Grid with `grid-template-columns: 320px 1fr 320px` and collapses to a single column on small screens.
- Containers stretch to the full width of the viewport to support edge‑to‑edge designs.

## Spacing

- A spacing scale is defined using CSS custom properties:
  - `--spacing-xs: 4px`
  - `--spacing-sm: 8px`
  - `--spacing-md: 16px`
  - `--spacing-lg: 24px`
  - `--spacing-xl: 32px`
- Margins and paddings throughout the application reference this scale for consistent rhythm.

## Grid and Sizing

- The main grid is based on a 12‑column concept. Major columns (left, center, right) use 3 / 6 / 3 fractions respectively on large screens.
- Components should avoid fixed widths where possible and instead rely on `minmax()` or `flex: 1` so they resize proportionally.
- Headers and buttons follow the spacing scale so inline actions don’t crowd each other.

## Canvas Stability

- The image canvas is placed inside a flex container next to the sidebar so that expanding widgets do not push the canvas vertically.
- Panels that may change height should be positioned in the right pane to keep the canvas stable.

