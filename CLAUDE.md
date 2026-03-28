# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Moodex is a **vanilla JavaScript PWA** for emotional wellness tracking. Users log moods with intensity ratings (1–10) and optional journal notes, then visualize patterns via charts and calendar. Data is stored in Firebase Firestore with real-time sync.

**No build step.** There is no package.json, bundler, or compile step. Open `index.html` in a browser or serve the directory with any static server (e.g. `python3 -m http.server`).

## External Dependencies (CDN only)

- **Firebase 12.11.0** — Auth + Firestore
- **GSAP 3.12.2** — Animations and page transitions
- **Feather Icons** — Icon system (call `feather.replace()` after DOM changes)
- **Lottie Web 5.12.2** — Splash screen animation

## Architecture

Everything lives in three files:

- `index.html` — HTML structure with all page/section shells (`#page-log`, `#page-track`, `#page-settings`, `#login-screen`, `#splash-screen`)
- `moodex.js` — All application logic (~900 lines)
- `moodex.css` — All styles with CSS custom properties for dark/light theming

### State

```js
let entries = []              // Synced from Firestore in real-time
let currentUser = null        // Firebase Auth user
let unsubscribeEntries = null // Firestore listener cleanup
let pickedMoods = new Map()   // Mood selection state for the log form
let curPage = 'log'
let curTrackTab = 'overview'
let calY, calM                // Calendar display month/year
```

### Navigation

`goPage(name)` drives all page transitions with GSAP animations. `switchTrackTab(tab)` handles the Overview / Calendar / History tabs inside the Track page.

### Data Model (Firestore)

```
users/{uid}/entries/{docId}
{
  id: number,           // Date.now()
  moods: [{ id: string, intensity: 1–10 }],
  note: string,         // optional, max 300 chars
  ts: ISO string
}
```

Local storage keys: `moodex` (legacy entries, auto-migrated on first login), `moodex_theme` (light/dark preference).

### Charts

All charts are drawn on `<canvas>` elements using the Canvas 2D API — no charting library:

- `renderRadar()` — spider chart with 8 mood axes
- `renderWeekBars()` — 7-day bar chart
- `renderDistribution()` — top 5 moods with percentages

### PWA

`sw.js` uses a cache-first strategy for all same-origin assets. `manifest.json` and Apple-specific meta tags handle home screen installation on iOS and Android.

## Firebase Config

The Firebase config object is hardcoded in `moodex.js` (around line 14). This is intentional for client-side web apps — security is enforced by Firestore security rules, not by hiding the keys.
