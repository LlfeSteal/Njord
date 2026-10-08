# Njord style guide

Everything needed to rebuild Njord's look elsewhere: another app, another framework, or a design tool. This guide covers the visual design only; for behavior, see `docs/ARCHITECTURE.md`.

It is adapted from the Nornir style guide: §1–7 and §9–13 follow it; §8 (Nornir's Gantt chart) is replaced by Njord's own screens, and the semantic tokens of §2.3 are Njord's.

The source of truth is `frontend/src/styles/theme.css` (every token is a CSS custom property), the per-component stylesheets `frontend/src/ui/*.css`, and `frontend/src/ui/Icons.tsx`. Every value below is copied from those files. **Keep this guide in sync when they change.**

---

## 1. Principles

Njord transposes **Apple's Human Interface Guidelines** (macOS / iOS) to the web.

- **Native feel**: system font, Apple system colors, and a light **and** a dark appearance. Separators are hairlines (0.5 px). Bars use a translucent material, cards are rounded, and motion is short and soft.
- **Sober**: meaning comes from contrast, position and shape, not from extra hues, outlines or badges. When in doubt, take something away.
- **Self-contained**: no web fonts, no CSS framework and no icon font. The app must look the same offline.
- **Colors carry meaning, and only one meaning each**:
  - **Green** only ever means *conforming* / *on track* / *active*.
  - **Orange** means *needs attention*: out of plan, warnings, unsecured budget.
  - **Red** means *over the plan*, *error*, *dropped* or *destructive*.
  - **Purple** means *under the plan* (sous-imputation), and nothing else.
  - **Gray** means *absent*, *archived*, *unclassified* or *purged*.
  - **Blue** is the accent: links, pressed toggles, selection, focus, and the neutral data series.
- **No color in code**: components only expose states (`data-tone`, `data-flag`, `data-statut`…), and the stylesheets map those states to tokens.

---

## 2. Color

### 2.1 Neutrals

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#f5f5f7` | `#000000` | Page (grouped) background, dialog sheet |
| `--card` | `#ffffff` | `#1c1c1e` | Cards, table rows |
| `--row-alt` | `#fafafc` | `#202022` | Every other table row (striped tables) |
| `--row-hover` | `rgba(0,0,0,0.035)` | `rgba(255,255,255,0.05)` | Row hover tint |
| `--text` | `#1d1d1f` | `#f5f5f7` | Primary text |
| `--text-secondary` | `rgba(60,60,67,0.6)` | `rgba(235,235,245,0.6)` | Secondary text, labels, legend |
| `--text-tertiary` | `rgba(60,60,67,0.3)` | `rgba(235,235,245,0.3)` | Placeholders, scrollbars, details |
| `--separator` | `rgba(60,60,67,0.12)` | `rgba(84,84,88,0.45)` | Hairlines (0.5 px) |
| `--fill` | `rgba(120,120,128,0.12)` | `rgba(118,118,128,0.24)` | Control backgrounds (buttons, fields, segmented controls) |
| `--fill-pressed` | `rgba(120,120,128,0.2)` | `rgba(118,118,128,0.36)` | Hover / pressed controls |
| `--material` | `rgba(255,255,255,0.72)` | `rgba(28,28,30,0.72)` | Translucent toolbar and tooltip (with blur, see §5) |
| `--menu-bg` | `rgba(246,246,248,0.97)` | `rgba(44,44,46,0.97)` | Menus and popovers (near opaque) |
| `--segment-thumb` | `#ffffff` | `#636366` | Selected segment, pressed toggle |

### 2.2 System hues

These are Apple system colors, with a brighter variant in dark mode.

| Token | Light | Dark |
|---|---|---|
| `--blue` | `#007aff` | `#0a84ff` |
| `--purple` | `#af52de` | `#bf5af2` |
| `--green` | `#34c759` | `#30d158` |
| `--orange` | `#ff9500` | `#ff9f0a` |
| `--teal` | `#30b0c7` | `#40c8e0` |
| `--red` | `#ff3b30` | `#ff453a` |
| `--gray` | `#8e8e93` | `#98989d` |

**Blue** is also the accent color: links, pressed toggles, active filters, the menu highlight and the focus ring.

### 2.3 Semantic tokens (Njord)

| Token | Value | Meaning |
|---|---|---|
| `--success` | `--green` | Action succeeded, active version |
| `--warning` | `--orange` | Parsing `warn`, row warning, quality check |
| `--danger` | `--red` | Error, parsing `drop`, destructive action |
| `--flag-conforme` | `--green` | Analysis flag: conforming |
| `--flag-hors-plan` | `--orange` | Analysis flag: out of plan |
| `--flag-sur-imputation` | `--red` | Analysis flag: over-charged |
| `--flag-sous-imputation` | `--purple` | Analysis flag: under-charged |
| `--flag-absence` | `--gray` | Analysis flag: no charge at all |
| `--statut-active` | `--green` | Version status: active |
| `--statut-archivee` | `--gray` | Version status: archived |
| `--statut-purgee` | `--text-tertiary` | Version status: purged (struck through) |
| `--series-planned` | `--blue` at 0.3 | Chart series: planned (the track) |
| `--series-actual` | `--blue` | Chart series: actual (the solid layer) |
| `--series-provision` | `--teal` at 0.16 (dark: 0.26) | Remaining provisions (DECISIONS n° 16): band between the plan total and the budget max, provision part of a budget track, legend swatch |
| `--budget-secured` | `--green` | Budget: secured |
| `--budget-unsecured` | `--orange` | Budget: unsecured |
| `--budget-unclassified` | `--gray` | Budget: unclassified |
| `--uncovered` | `--gray` at 0.22 | Period not covered by the plan de charge: hatch stroke, swatch outline |
| `--uncovered-hatch` | 135° stripes of `--uncovered`, 2 px every 7 px | Period not covered by the plan de charge: background of headers, cells, legend swatch |

### 2.4 Derived colors

These are always mixed from tokens with `color-mix(in srgb, …)` and never written out as literal values:

| Recipe | Where |
|---|---|
| `var(--red) 10%, var(--card)` | Error banner background |
| `var(--orange) 12%, var(--card)` | Warning banner background |
| `var(--blue) 8%, var(--card)` | Info banner background |
| `var(--blue) 50%, transparent` | Focus ring |
| `var(--blue) 45%, transparent` | Field focus ring |
| `var(--blue) 14%, transparent` | Active pop-up button background, selected row |
| `var(--blue) 88%, #000` | Primary button hover |
| `var(--red) 88%, #000` | Destructive primary button hover |
| `var(--blue) 30%, transparent` | Planned chart series (track) |
| `var(--gray) 22%, transparent` | Uncovered period (`--uncovered`, hatch stripes) |
| `var(--teal) 16%, transparent` (dark: 26 %) | Remaining provisions (`--series-provision`) |

The literal colors allowed outside tokens are white (`#fff`), for text and glyphs on colored fills, and the modal backdrop (§5).

---

## 3. Typography

**Font stack**, system only:

```css
-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif
```

Monospace (codes, matricules, CT): `ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace`.

The base is **14 px / 1.4**, `-webkit-font-smoothing: antialiased`, in color `--text`.

| Role | Size | Weight | Notes |
|---|---|---|---|
| KPI value | 28 px | 600 | Tabular, tracking −0.02em |
| App title, page title, empty-state heading | 17 px | 600 | Title tracking −0.01em |
| Dialog title, section title | 15 px | 600 | Ellipsis on one line |
| Body: controls, table cells, menu items | 13 px | 400 (buttons and segments 500) | |
| Emphasis (active version, totals) | 13 px | 600 | |
| Secondary: legend, subtitles, tooltip lines, field descriptions | 12 px | 400 | Secondary color; tooltip title 13 / 600 |
| Small: details, pills, menu headers | 11 px | 400 (pills and headers 600) | |
| Column header | 11 px | 600 | Uppercase, +0.06em, secondary |

Numbers that change or line up (counts, hours, amounts, periods) use `font-variant-numeric: tabular-nums`. Numeric columns are right-aligned.

---

## 4. Layout, sizing, spacing

**Spacing scale**: 2, 4, 6, 8, 12, 16, 24, 32, 48, 64 px.
- Page content: padding **16 × 24**, vertical gap 12, max width 1440 px.
- Toolbar: padding 12 × 24, gaps 12 (vertical) × 24 (horizontal); actions 8 apart.
- Filter bar and control groups: gap 8. Legend: gap 16.

**Radius scale**:

| Radius | Element |
|---|---|
| 1–3 px | Legend swatches, 4 px progress bar (2) |
| 5–6 px | Segments, menu items, checkboxes (5), skeleton bars |
| 7–8 px | Buttons (7), segmented control, fields, toggle group, app icon (8) |
| 9 px | Pills (18 px high) |
| 10 px | Menus, tooltips, toasts |
| 12 px | Cards, banner, drop zone (`--radius`) |
| 14 px | Modal sheet |
| 50 % | Dots, switch knob, clear button |

**Control heights**: buttons, fields, menu items and pop-up buttons are **28 px**. Segments and toggles are **24 px** inside a 2 px inset. Icon buttons are 28 × 28. Switches are 38 × 22.

**Tables**:

| Measure | Value |
|---|---|
| Row height | 36 px (compact: 28 px) |
| Cell padding | 0 12 px |
| Header | 32 px, column-header style (§3), 0.5 px bottom separator, sticky in scrolling tables |
| Row separators | 0.5 px `--separator` (none when striped) |

**Dialogs**: sheet width `sm` 440 · `md` 560 · `lg` 800 · `xl` `min(1100px, 100vw − 32px)`; side sheet 480 px.

---

## 5. Elevation and materials

| Token / rule | Light | Dark |
|---|---|---|
| `--shadow` (cards) | `0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)` | `0 0 0 0.5px rgba(255,255,255,0.08)`: a hairline ring instead of a shadow |
| `--popover-shadow` (menus, tooltips, sheets, toasts) | `0 8px 30px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.08)` | `0 8px 30px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.12)` |
| `--raised-shadow` (segment thumb, switch knob) | `0 1px 3px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.04)` | same |
| `--backdrop` (modal) | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.65)` |

- **Translucent material** (sticky toolbar, tooltip, toast): `background: var(--material); backdrop-filter: saturate(180%) blur(20px)`, with a 0.5 px `--separator` bottom border on the toolbar.
- **Menus are near opaque** (`--menu-bg`, 97 %, laid over an opaque `--bg` underlay: without it Chromium lets page text show through). A menu inside the blurred toolbar can't blur the page behind it: nested `backdrop-filter` only sees its parent.
- Layering, bottom to top: content → sticky table header (z 2) → filter bar (z 5) → toolbar (z 10) → menus and popovers (z 20) → tooltip (z 30) → toasts (z 40). Modals use the native `<dialog>` top layer.

---

## 6. Motion

- **Easing**: `cubic-bezier(0.25, 0.1, 0.25, 1)` (`--ease`) everywhere.
- **Durations**:

| Duration | Use |
|---|---|
| 0.1 s | Press: buttons scale to 0.97 |
| 0.12 s | Menu appears: fade in and scale from 0.96, from its anchor corner |
| 0.15 s | Hover backgrounds, dialog in, backdrop fade, toast in |
| 0.2 s | Chevron rotation (0 → 90°), collapse |
| 0.22 s | Segmented control thumb slide, switch knob |
| 0.9 s linear, infinite | Spinner |
| 1.4 s, infinite | Skeleton shimmer |

- **Reduced motion**: under `prefers-reduced-motion: reduce`, every animation and transition is off, including the dialog backdrop.

---

## 7. Components

All components live in `frontend/src/ui/` (one `.tsx` + one `.css` per component, exported from `src/ui/index.ts`). Pages never style controls themselves.

**States, everywhere**: hover darkens the fill (`--fill` → `--fill-pressed`). Active presses down (`scale(0.97)`). Disabled is `opacity 0.5`, with no press. Focus uses the focus ring (§12). "On" toggles use `aria-pressed='true'`.

| Component | Recipe |
|---|---|
| **Button** | 28 px high (`sm`: 24), padding 0 12, radius 7, no border, `--fill`, 13 px / 500, icon gap 6 |
| **Button, pressed toggle** | `--fill-pressed` background, **blue** text |
| **Icon button** | 28 × 28, centered 15 px icon, no background until hover; label is the help tag |
| **Plain button / link** | No background, blue text, padding 0 8; hover shows `--fill` |
| **Primary button** | Blue background, white text; hover is blue mixed 88 % with black |
| **Destructive** | Red text (default / plain); red background with white text (primary) |
| **Segmented control** | 2 px padding, radius 8, `--fill`; equal-width segments (min 64 px, 24 px high, radius 6); a sliding white thumb (`--segment-thumb`) with the raised shadow; unselected text secondary. Used for the main navigation and sub-tabs |
| **Toggle group** | Same shell; each pressed button is raised like a thumb; text secondary, `--text` when pressed or hovered |
| **Pop-up button** (Select, MultiSelect) | A button with a 12 px chevron-down; when a filter is set, the selection replaces the title and the button is tinted (blue 14 % background, blue text) |
| **Text field** | 28 px, radius 8, `--fill`, no border; focus shows a 3 px blue ring at 45 %; label 12 / 500 secondary above, description 12 px secondary, error 12 px red |
| **Search field** | 240 × 28 text field with a 13–14 px magnifier and a circular clear button (filled tertiary circle with a cross in `--card`) |
| **Checkbox** | 16 px, radius 5, `--fill` with a 0.5 px separator ring; checked is blue with a white tick |
| **Switch** | 38 × 22 capsule, `--fill-pressed` off, green on (HIG); 18 px white knob with the raised shadow |
| **Menu / popover** | Radius 10, padding 5, `--menu-bg`, popover shadow, min width 190 (filters 290); 11 px / 600 secondary header; 28 px items with radius 6; hover is **solid blue with white text** (macOS); a check mark on selected items; sections and footer separated by a hairline; inner search field radius 6 |
| **Tooltip** | Material with blur, radius 10, padding 8 × 12 (rich: 12 × 14), max 320 px; 12 px text; 13 / 600 title |
| **Card** | `--card`, radius 12, `--shadow`, content clipped; padding 16 (`lg`: 24) |
| **Banner** (error / warning / info) | Radius 12, padding 12 × 16, tone mixed into the card (§2.4); status glyph in the tone; bold 13 px title with a 13 px secondary line |
| **Toast** | Material with blur, radius 10, padding 12 × 14, popover shadow, 320 px; status glyph + 13 / 600 title + 12 px secondary message; bottom-right, auto-dismiss 4 s (errors 8 s) |
| **Empty state** | Centered, padding 64 × 24; 40 px tertiary icon; 17 / 600 heading; secondary text; an action button 16 px below |
| **Skeleton** | 10 px bars with radius 5 and a `--fill` → `--fill-pressed` shimmer |
| **Spinner** | 16 px ring, 2 px stroke, `--text-tertiary` with a `--text-secondary` arc, 0.9 s |
| **Pill** (counts) | 18 px high, padding 0 6, radius 9, `--fill`, 11 / 600 tabular secondary text |
| **Tag** (statuses, flags) | No background, no outline: a status glyph or 8 px dot in the tone, then the label in `--text` 13 px |
| **Table** | See §8 |
| **Pagination** | Plain chevron icon buttons around a 13 px tabular "Page n / N"; current page in a segmented look when numbered |
| **Steps** | A row of 20 px numbered circles joined by hairlines: done = blue with a tick, current = blue ring, upcoming = `--fill`; label 13 / 500, description 12 px secondary |
| **Drop zone** | Radius 12, 1.5 px dashed `--separator`, `--card`, padding 32; drag-over: blue dashed border and blue 8 % tint |
| **Modal** | Native `<dialog>`, `--card`, radius 14, popover shadow; header 15 / 600 title with a close icon button, body padding 16 × 20, footer actions right-aligned 8 apart; enters with fade + scale from 0.96 |
| **Side sheet** | Native `<dialog>` docked right, full height, 480 px, `--card`, popover shadow |
| **Disclosure** | `<details>`: 13 / 600 summary with a rotating 14 px chevron, hairline between items |
| **Toolbar** | Sticky, translucent; left: app icon, title "Njord" (17 / 600) and the subtitle (12 px secondary) below; center: the main segmented navigation; right: appearance menu |

---

## 8. Njord screens

### Page template (controller-first)

Njord is organised by the **controller's tasks**, not by data source. A page is always the same frame:

```
┌ Sidebar 220 ┬ Toolbar: [back] Title · subtitle            actions  ⋯ ┐
│ Pilotage    ├──────────────────────────────────────────────┬─────────┤
│  Vue d'ens. │ content (padding 16 × 24, gap 16)            │Inspector│
│  Anomalies 3│                                              │  360 px │
│  Écarts     │                                              │         │
│  Budget     │                                              │         │
│  Prévisions │                                              │         │
│ Données     │                                              │         │
│  Plan …     │                                              │         │
│ Réglages    │                                              │         │
└─────────────┴──────────────────────────────────────────────┴─────────┘
```

- **Sidebar** (`AppShell`, `Sidebar`): source list on `--material`, items 28 px, radius 6; active item = `--accent-tint` background, `--accent` text and icon; section titles 11/600 secondary; badge = Pill. Collapses under 900 px.
- **Toolbar** (`PageToolbar`): sticky, translucent, 0.5 px bottom hairline; title 17/600, one subtitle line 12 px secondary; **one** primary action at most, everything else in the `⋯` menu (exports, secondary actions). An optional bottom row carries search + `FilterButton` + `ActiveFilters`, or a segmented control.
- **Inspector** (`Inspector`, `InspectorSection`, `KeyValue`): opens on row click, 360 px, `--card`, left hairline; details that do not deserve a column live here (full group path, cost line, unit, raw label, parsing reason, breakdowns, actions).
- **Filters**: never more than one row. A search field and a `Filtres` button with a count; criteria live in its popover; active filters show as removable accent pills.
- **Pilotage context**: one compact control in the toolbar (« Dernier plan × Réalisé · S36 → S40 ▾ »), shared by every Pilotage page. The plan select is « Plan connu au » (the plan **timeline** known at the date of that version, DECISIONS n° 13); its default is « Dernier plan (timeline complète) » and each version shows its date d'effet. Week options carry « · verrouillée » / « · non couverte ».

### Density rules

- **At most 6 columns** by default in a table (the rest in the inspector or a column chooser).
- **No two-line cells** in a list: one row = one line (36 px), secondary data goes to the inspector.
- **At most 3 key figures** at the top of a screen (`Metric`, no card around them).
- One chart per idea; no chart without a reading key in one sentence.
- Explanatory paragraphs belong in empty states or help text, not above content.
- Settings use **grouped inset lists** (`GroupedList`, `ListRow`: label left, control right), one column, 720 px max.

### Anomaly rows (the one tinted background)

A row in anomaly gets `data-tone="warning|danger"`: background tinted 8 % of the tone (`color-mix(in srgb, var(--warning) 8%, var(--card))`) and a 24 px leading cell (`data-glyph`) with the `StatusGlyph`. Its reason appears in the inspector and as the glyph's help tag. No status column.


### Tables

- Native `<table>` in a card, full width; horizontal scroll inside the card when narrow.
- Rows 36 px, hairline separators; `striped` alternates `--card` / `--row-alt`; `hover` adds `--row-hover`; clickable rows show a pointer.
- Header: column-header style (§3), sticky when the table scrolls vertically.
- Numeric cells right-aligned and tabular; codes in monospace.
- Sort header: the label, then a 12 px chevron (up / down) when sorted, a faint up-down chevron otherwise; `aria-sort` on the `<th>`.
- Row states: `data-muted` (archived: secondary text), `data-strike` (purged: tertiary, struck through), `data-selected` (blue 14 %), `data-emphasis` (600, e.g. the active version or a total row).
- Actions sit at the trailing end of the row as icon buttons, 4 px apart, like a macOS table cell.

### Statuses and flags

Statuses are **tags**: a glyph whose **shape** carries the meaning, colored by its token, then the label. No emoji, no filled badge.

| Kind | Glyph | Token |
|---|---|---|
| Version active | 8 px dot | `--statut-active` |
| Version archived | 8 px dot | `--statut-archivee` |
| Version purged | 8 px ring | `--statut-purgee`, label struck through |
| Parsing `warn` | Rounded triangle with `!` | `--warning` |
| Parsing `drop` | Octagon with `!` | `--danger` |
| Flag conforme | Circle with a tick | `--flag-conforme` |
| Flag hors plan | Rounded triangle with `!` | `--flag-hors-plan` |
| Flag sur-imputation | Octagon with `!` | `--flag-sur-imputation` |
| Flag sous-imputation | Circle with `!` | `--flag-sous-imputation` |
| Flag absence | Stroked circle with a slash | `--flag-absence` |

A signed gap (écart) is colored with its flag token; the `+` / `−` sign carries the same information without color.

### Uncovered periods (plan timeline)

Days covered by no plan version produce no écart, no flag and no anomaly: they are **not analysed**, never "hors plan". Everywhere they appear they use the neutral hatch (`--uncovered-hatch`) and the words « non couvert(e) par le plan de charge »:

- Heat map (Capacité): week header and cells `data-uncovered`, hatched tile, cell text « non couvert » (secondary 11 px), legend line with a hatched swatch.
- Charts: hatched band + legend entry (see Charts).
- Hours imputed on uncovered days (`kpis.heures_non_couvertes`): one discreet line « X h imputées sur des périodes non couvertes par le plan (non analysées) » with a hatched 10 px swatch (`.pil-uncovered`) — in the Écarts synthesis footer, and short (« X h non couvertes par le plan », full sentence in the tooltip) in Pilotage subtitles. Never a KPI card, never a flag tone.

### KPI cards

Card, padding 16; label 12 px secondary; value 28 / 600 tabular; sub-line 12 px secondary. A KPI never gets a colored border: a status glyph before the label gives its tone.

### Charts

- Recharts, drawn with tokens only (`var(--…)`): no axis lines, no tick lines, horizontal grid in `--separator`, ticks 11 px `--text-secondary`.
- Planned vs actual: planned is the **track** (`--series-planned`), actual is **solid** (`--series-actual`), bars radius 3.
- Budget: stacked `--budget-secured`, `--budget-unsecured`, `--budget-unclassified`.
- Tooltip uses the kit tooltip look (material, radius 10). Legend: 12 px secondary with 10 px swatches radius 3.
- Every chart has a "show as table" toggle.
- **Budget max et provisions (DECISIONS n° 16).** The cumulative chart never plots provisions at their dates: the `budget_cumul` area stays the **plan de charge cumulé** (legend « Plan de charge cumulé »). The budget (charge max = Σ PPS + remaining provisions) is a horizontal reference line « Budget max X k€ » (`--text-secondary`, dotted 2/3, 1.5 px; legend « Budget max (PDC + provisions) », dotted swatch) and, between the plan total (`pps`) and the budget max, a flat band in `--series-provision` (Recharts `ReferenceArea`, fill applied as a CSS `style` so the token resolves per theme) labelled « Provisions restantes » inside its top-right corner only when the band is at least 30 px tall (legend entry otherwise carries it). Without provisions: the former single dashed « Budget X » line in `--text-tertiary`, no band, no extra legend entries. Budget-by-nature bars: grey track = PPS, then a 2 px surface gap and the provision part in `--series-provision`, réalisé fills on top; legend shown only when provisions exist. In CT tables the budget column is headed « Charge max ».
- **Période non couverte par le plan de charge = hachure neutre (`--uncovered-hatch`), jamais une couleur de flag ; légende obligatoire.** Weeks with `couverture = aucune` get a hatched band behind the marks (SVG `<pattern>` resolved from `--gray`, same 135° / 2-in-7 px geometry, Recharts `ReferenceArea` over the run of weeks) and a legend entry « Non couvert par le plan de charge » (hatched swatch) shown only when such weeks exist; the tooltip of those weeks says it too (partially covered weeks: tooltip mention only, no shading).

### Import wizard

A modal with **Steps** on top (Dépôt → Aperçu → Confirmation), the drop zone, then the report: counts as KPI cards, warnings as a banner, details in disclosures.

---

## 9. Iconography

**Line icons**, in the spirit of SF Symbols, all in `frontend/src/ui/Icons.tsx`:

| Property | Value |
|---|---|
| ViewBox | 24 × 24 |
| Default size | 16 px |
| Common sizes | 12, 13, 14, 15, 18, 20, 40 px |
| Stroke | 1.8 (2–2.4 for small or emphasized glyphs) |
| Caps / joins | Round |
| Fill | None |
| Color | `currentColor` |
| Accessibility | `aria-hidden` |

| Icon | Use |
|---|---|
| `IconChevronRight` / `Left` / `Down` / `Up`, `IconSelector` | Disclosure, pagination, pop-up, sort |
| `IconSearch`, `IconClear`, `IconClose`, `IconCheck` | Search fields, dialogs, menu selection |
| `IconPlus`, `IconPencil`, `IconTrash`, `IconArchive`, `IconRestore`, `IconUndo` | Edit and lifecycle actions |
| `IconImport`, `IconUpload`, `IconDownload`, `IconSave`, `IconFileSpreadsheet` | Files |
| `IconEye`, `IconExternalLink`, `IconArrowLeft`, `IconCornerDownRight`, `IconMerge` | Navigation, aliases |
| `IconFilterOff`, `IconColumns`, `IconSliders`, `IconHistory` | Filters, settings, audit |
| `IconUser`, `IconUsers`, `IconUserPlus` | Référentiels |
| `IconInfo`, `IconWarning` | Banners |
| `IconSun`, `IconMoon`, `IconAuto` | Appearance Light / Dark / Automatic |
| `IconTimeline` | App icon, empty states |
| `IconRefresh`, `IconCalendar` | Refresh, dates |

**Status glyphs** (`StatusGlyph`): a filled shape with a **white** mark (an exclamation bar 2.3–2.4 px plus a dot, or a tick), 15 px in tables and 12 px in tooltips. **The shape carries the meaning**, so they can be told apart without color:

| Glyph | Shape |
|---|---|
| `warning` | Rounded triangle (`exclamationmark.triangle.fill`) |
| `danger` | Octagon (`exclamationmark.octagon.fill`) |
| `attention` | Circle (`exclamationmark.circle.fill`) |
| `success` | Circle with a tick (`checkmark.circle.fill`) |
| `none` | **Stroked** circle with a slash (`nosign`, stroke 2.2): stroked, so it never reads as the filled octagon |
| `info` | Circle with an `i` |

**App icon**: a 32 px tile with radius 8, a 135° gradient from `--blue` to `--purple`, and an 18 px white timeline glyph.

---

## 10. Dark mode

- The user picks **Automatic** (follows the system), **Light** or **Dark** from the toolbar's appearance menu; the choice is stored in `localStorage` (`njord.appearance`).
- The choice sets `data-theme="light|dark"` on `<html>`. A **single** `:root[data-theme='dark']` block overrides the tokens; there is no `prefers-color-scheme` query in the CSS (Automatic listens to `matchMedia` in JS).
- A tiny inline script in `index.html` applies the theme **before first paint**, so the page never flashes the wrong theme.
- `<meta name="color-scheme" content="light dark">` and `theme-color` meta tags: `#f5f5f7` light, `#000000` dark.
- Besides the palette:
  - card shadows become a 0.5 px light ring;
  - the segmented thumb is gray (`#636366`);
  - the hues switch to their brighter dark variants;
  - the backdrop goes from 50 % to 65 %.
- Every component must be checked in both appearances.

---

## 11. Do / don't

| Don't | Do |
|---|---|
| Filled colored badges for statuses | A tag: glyph in the tone + plain label |
| Emoji as status markers (🟢 🔴…) | Status glyphs: the shape carries the meaning |
| Colored left borders on cards | A status glyph before the label |
| Use orange or blue for a chart series "just to differ" | Planned = track, actual = solid, same hue |
| Use green for anything but conforming / active / success | Gray or blue for neutral states |
| Hard-code colors in components | Expose `data-*` states and map them to tokens in CSS |
| Load a web font or a UI framework | Use the system font stack and plain CSS |

---

## 12. Accessibility

- **Focus ring**: `outline: 3px solid color-mix(in srgb, var(--blue) 50%, transparent); outline-offset: 2px; border-radius: 6px` on `:focus-visible`.
- **Shape before color**: status glyphs differ by shape; strike-through and dashes carry states without relying on hue.
- Meaningful icons have `role="img"` with an `aria-label` and a native `title` (help tag). Decorative ones are `aria-hidden`.
- Toggles expose `aria-pressed`, segments `role="radio"` with `aria-checked`, disclosures and pop-ups `aria-expanded`, sortable headers `aria-sort`.
- Menus and dialogs: Escape closes, focus returns to the trigger, arrow keys move in menus.
- Motion is off under reduced motion (§6).

---

## 13. Starter kit

The token block is the top of `frontend/src/styles/theme.css`; copy it as is. Base rules:

```css
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.4 var(--font); color: var(--text); background: var(--bg); -webkit-font-smoothing: antialiased; }
a { color: var(--blue); text-decoration: none; }
a:hover { text-decoration: underline; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 3px solid color-mix(in srgb, var(--blue) 50%, transparent); outline-offset: 2px; border-radius: 6px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after, ::backdrop { animation: none !important; transition: none !important; }
}
```

The segmented thumb is sized `calc((100% - 4px) / <number of segments>)` and moved with `transform: translateX(<index> × 100%)`. For everything else, copy the matching `frontend/src/ui/*.css`.

**In a design tool** (Figma…), create:
- one color style per token in §2, in two modes (Light / Dark);
- the text styles of §3;
- effect styles for `--shadow`, `--popover-shadow` and `--raised-shadow`;
- a 4 px-based spacing grid (§4: 2, 4, 6, 8, 12, 16, 24).
