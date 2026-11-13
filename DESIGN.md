# Spectra UI Design System & Instrument Direction (`DESIGN.md`)

> **Authoritative UI & Interaction Specification for All Frontend Workspaces.**  
> Grounded in astronomical FITS/HiPS instrument readouts (SAOImage DS9, ESASky, Rubin/LSST Firefly), WCAG 2.2 AA accessibility standards, and the *UI Agent Rule Guide: Avoiding the Vibe-Coded Look*. Read this file before creating or modifying any screen.

---

## 1. Product Identity, Audience & Primary Job

- **Product:** Spectra — NASA SPHEREx Quick Release 2 (`spherex_qr2`) Sky Survey Explorer & Multi-Epoch Spectrophotometric Workbench (`Community Product`).
- **Audience:** Observational astronomers, archival researchers, and trained citizen scientists inspecting high-proper-motion brown dwarfs, variable young stellar objects, and biogenic interstellar ices.
- **Primary Job:** Navigate an immersed, full-bleed infrared sky plane across all right ascensions and declinations, zoom into credible astrophysical starfields, verify multi-epoch survey coverage, and extract calibrated 32-bit floating-point cutouts and 102-channel spectra.
- **Vernacular Source:** Observatory instrument consoles and archival FITS viewers (SAOImage DS9, ESASky, Pan-STARRS, WiseView). Everything on screen serves coordinate localization, flux/wavelength inspection, or epoch comparison.

---

## 2. Primary User Decisions & Actions (Ordered by Frequency)

Every element in the UI must directly serve one of these five actions:

1. **Pan & zoom across an immersed sky field (`Tab 1: Celestial Navigator`):** Scroll continuously in all directions ($0^\circ\text{–}360^\circ$ RA, $-90^\circ\text{ to }+90^\circ$ Dec) and zoom smoothly from wide-field survey context ($12^\circ\text{–}45^\circ$) down to arcminute cutout patches ($1'\text{–}10'$) without ever viewing the sky as an external 3D toy ball.
2. **Jump to exact coordinates or calibration targets (`Global Header` / `⌘K`):** Enter decimal degrees, sexagesimal strings (`HHhMMmSS.Ss ±DDdMMmSS.Ss`), or object names, or select one of the 5 NASA benchmark targets (*Barnard's Star*, *WISE 0855-0714*, *Epsilon Indi B*, *RW Aurigae*, *R Draconis*).
3. **Verify field observability before extraction (`Instrument Status Strip`):** Read live cursor/center J2000 coordinates, angular FoV, SPHEREx pass count, MJD window, Gaia DR3 proper-motion vectors, and uncompressed tensor payload size (`MB`).
4. **Extract and compare multi-epoch cutouts (`Tab 2: Time-Domain Comparator`):** Open the selected sky patch in the WebGL2 Float32 blinker/differencer (fixed baseline, pairwise step, median-subtracted), inspect the 6-band mini-SED sparkline, verify optical counterparts against Pan-STARRS PS1, and measure proper motion vectors.
5. **Inspect 102-channel spectra, ice column densities, or community consensus with 1-click classification tags (`Tabs 3–5`) and share reproducible URLs.**

---

## 3. Color Tokens & Surface Hierarchy

No framework indigo/violet defaults, no gradients, no colored neon drop-shadows (`shadow-[0_0_...]`), and no decorative semantic badges.

| Token Name | Hex Value | Role & Usage Contract | Contrast Floor |
|---|---|---|---|
| `surface-sky` | `#080A0F` | Deep neutral-cool obsidian background behind astronomical canvases | Base layer |
| `surface-panel` | `#0F131A` | Flat, opaque instrument header, status strip, and sidebars (zero `backdrop-blur`) | — |
| `surface-elevated` | `#151B24` | Floating menus, command palette (`⌘K`), and active input fields | — |
| `border-hairline` | `#1E2530` | `1px` structural dividers separating instrument strips and table cells | `3.1:1` vs sky |
| `text-primary` | `#E6ECF2` | Primary labels, target names, active values | `14.2:1` on panel |
| `text-secondary` | `#94A3B8` | Field labels, units (`deg`, `arcsec`, `MB`, `MJD`), secondary metadata | `6.1:1` on panel |
| `accent-sky` | `#38BDF8` | Reserved strictly for the active tab indicator, cutout FoV reticle, and primary action | `8.5:1` on panel |
| `status-nominal` | `#22C55E` | Paired with text (`Live API`) when FastAPI engine responds | `7.8:1` on panel |
| `status-warning` | `#F59E0B` | Paired with text (`Local cache` or `High payload`) for offline fallback / $\ge 2\,\text{MB}$ | `8.9:1` on panel |

---

## 4. Typography & Numeric Discipline

- **UI Chrome & Prose (`font-sans` — Inter / system sans):**
  - Used for all navigation tabs, button labels, section headers, form labels, and descriptions.
  - **Sentence case everywhere** (`Open cutout`, `Calibration targets`, `Time-domain comparator`). Never Title Case Every Word, and never place tracked `ALL-CAPS` eyebrow labels above headings.
- **Scientific Readouts (`font-mono tabular-nums` — JetBrains Mono):**
  - Used **strictly** for coordinates (`269.44639°`, `17h 57m 47.1s`), MJD ranges (`60796–61161`), angular dimensions (`180"`), byte sizes (`0.21 MB`), and keyboard shortcuts (`⌘K`).
  - Always apply `tabular-nums` and fixed decimal places (`toFixed(5)` for degrees, `toFixed(2)` for MB) so layout never shifts during live cursor panning.

---

## 5. Layout Wireframe: Immersed Stitched Photographic Sky Viewport (`Tab 1`)

Tab 1 is an **immersed, edge-to-edge flat window looking directly into space** (gnomonic/stereographic tangent projection `TAN`/`STG`), never an external 3D sphere floating in a box. It stitches real astronomical photographic plates (DESI Legacy Survey DR10 for resolved galaxies down to $24\,\text{mag}$, unWISE NEO7 infrared, IRSA 2MASS, and AllWISE) rather than looping over procedural dots, with SPHEREx Level-2 Linear Variable Filter (LVF) detector footprints (`D1`–`D6`) and WCS telemetry cleanly overlaid:

```
+----------------------------------------------------------------------------------------------------+
| Spectra  QR2 · Community Product   [Search RA/Dec or object... ⌘K]  Survey: [DESI LS DR10 v] [All] |
+----------------------------------------------------------------------------------------------------+
| 269.60°                            269.45°                            269.30°            [ + ]     |
| [Real Photographic Plates: M31/M51 Spiral Arms, Dust Lanes, Real Galaxies]               [ − ]     |
|     ·          *                 ·                    *       ·                          [18°]     |
|                  ·       +4.80° ───────────────────────────────                          [6°]      |
|         *                                 │                                              [1.2°]    |
|                                       ┌───┴───┐  SPHEREx Footprint: D4 (2.4–3.8 µm)                |
|     ·                 ·            ───│   +   │───  λ = 3.12 µm · Pass 1 MJD 60810.2               |
|                                       └───┬───┘                                                    |
|          *               +4.70° ──────────┼────────────────────                  ·                 |
|                                         180" FoV                                                   |
|                  ·                                                    *                            |
|                                                        ·                                           |
|                                                                                  |────── 15.0' ────|
+----------------------------------------------------------------------------------------------------+
| Cursor J2000: 269.44639° +4.76676° | 17h 57m 47.1s +04° 46' 00" | WCS-WAVE λ=3.120 µm | [Extract]  |
+----------------------------------------------------------------------------------------------------+
```

---

## 6. Hard Anti-Vibe-Coding Rules (Enforced Before Merge)

1. **No External 3D Toy Spheres:** The sky navigator fills 100% of the canvas edge-to-edge (`projection: 'TAN'` / `'STG'`, continuous pan in all directions, continuous zoom from wide-field degrees down to arcminutes).
2. **Zero Emoji as UI Icons:** Never render `⚠️`, `🔗`, `🔍`, `▶`, `✓`, `ℹ`, or `✨` in JSX. Use clean inline SVG geometric strokes (`1.5px` stroke width, `aria-hidden="true"`) or plain text.
3. **Zero Colored Glows or Neon Shadows:** Never use `shadow-[0_0_...]` or canvas `shadowBlur` for UI chrome. Use `1px` borders (`border-[#1E2530]`) and high-contrast hairlines.
4. **Zero Unjustified Glassmorphism:** Do not stack `backdrop-blur`, `shadow-2xl`, translucent fills, and borders on resting HUD panels. Dock telemetry into a solid `1px`-bordered bottom instrument strip (`bg-[#0F131A]`).
5. **Zero Template Chrome:** No `SPECTRA // QR2` double-slash dividers, no `[CATEGORY]` bracketed uppercase prefixes, and no trailing `→` or `↗` arrows appended to every button.
6. **Zero `animate-pulse` or `transition-all`:** Use explicit property transitions (`transition-colors duration-150 ease-out`) and honor `prefers-reduced-motion`.
7. **WCAG 2.2 AA & Semantic HTML Floor:**
   - Every interactive item uses `<button type="button">`, `<a>`, `<input>`, or `<select>` (never `<div onClick>`).
   - Visible `:focus-visible` outlines (`focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#38BDF8]`) — never bare `focus:outline-none`.
   - Use dynamic viewport height (`100dvh`) rather than `100vh`.

### Mechanical Pre-Commit Scan (Must Return 0 Hits in `web-client/src/`)
```bash
grep -rnE "from-purple|from-indigo|via-violet|bg-clip-text|text-transparent|backdrop-blur|shadow-\[0_0|border-l-4|border-l-\[|rounded-3xl|hover:scale-|animate-pulse|transition-all|outline-none|alert\(|Math\.random|⚠️|🔗|🔍|✨" web-client/src/
```
