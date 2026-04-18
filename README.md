# FlowForge

FlowForge is a browser-based visual production planner, graph editor, flow calculator, and routing visualizer.

It is intentionally generic. The app does not ship with a hardcoded game database, item list, or recipe set. Users define:

- items
- item colors
- per-item input belts
- machine classes / recipes
- process graph relationships
- allowed splitter sizes
- allowed merger sizes
- belt speeds
- clock range
- power limits

The application then calculates item flow, machine requirements, bottlenecks, approximate or exact routing feasibility, and renders the resulting graph on a dedicated visual board.

## Project Structure

- [index.html](D:/GitHub/FlowForge/index.html): minimal document shell
- [styles.css](D:/GitHub/FlowForge/styles.css): application layout and visual styling
- [app.js](D:/GitHub/FlowForge/app.js): state, calculations, rendering, persistence, and interaction logic

## Current Features

- Dark control area and always-visible beige visual board
- Item definition system with:
- name
- CSS-valid color value
- random color generation
- Item card grid with self-expanding per-item belt inputs
- Commit-based numeric normalization:
- typing is not reformatted live
- normalization happens on `Enter` or blur
- Global settings for:
- belt speeds
- splitter sizes
- merger sizes
- max power
- dual-handle clock interval slider
- User-defined machine classes / recipes with:
- dropdown-only item references
- per-craft inputs
- per-craft outputs
- output rate
- craft time
- power at 100% clock
- output rate and craft time synchronization
- Process-line editor with auto-expanding rows
- Merge detection in the visual graph
- Click-to-delete merge edges
- SVG graph rendering with:
- item nodes
- arrows
- belt labels
- machine summary boxes
- Flow and routing summary panels
- Split / merge feasibility analysis
- Machine count and clock calculation
- Power usage summary
- JSON save / load
- Local persistence via `localStorage`

## Running The App

This is a static frontend. No build step is currently required.

Open [index.html](D:/GitHub/FlowForge/index.html) in a browser.

If your browser blocks some local file behaviors, serve the folder with a simple static server instead.

Examples:

```powershell
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Usage Overview

1. Define items in the item definition area.
2. Enter one or more input belt values on each item card.
3. Configure belt speeds, splitter sizes, merger sizes, power, and allowed clock interval.
4. Define machine classes / recipes using dropdown-selected items.
5. Define process graph rows in the process-line section.
6. Inspect the graph and summaries on the visual board and result panels.
7. Save the current state to JSON if needed.

## Notes On Calculations

- Primary flow unit is `item/min`.
- Machine clock is calculated from required throughput.
- Clock is rounded up to two decimals.
- If a single machine would exceed the allowed max clock, machine count increases.
- Split and merge analysis uses the user-defined allowed topology sizes.
- When exact distribution is not possible within the configured limits, the app prefers balanced approximation over one heavily underfed remainder belt.

## Known Structural Status

The app is now split into HTML, CSS, and JavaScript, but `app.js` is still a large single module.

The next sensible refactor would be splitting `app.js` into:

- state / persistence
- calculations
- graph layout / SVG rendering
- UI rendering
- event wiring

## Repo Scope

Everything is kept inside this repo. No external packages, frameworks, or generated assets are required for the current version.
