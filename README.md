# Spectra (SPHEREx Spectral Explorers)

[![Live Demo: Vercel](https://img.shields.io/badge/Live%20Demo-spectra--seven--opal.vercel.app-black.svg)](https://spectra-seven-opal.vercel.app/)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Target Mission: NASA SPHEREx](https://img.shields.io/badge/Mission-NASA%20SPHEREx-red.svg)](https://spherex.caltech.edu/)
[![Archive: NASA IRSA SPHEREx QR2 and QR3](https://img.shields.io/badge/Archive-IRSA%20SPHEREx%20QR2%20%2F%20QR3-orange.svg)](https://irsa.ipac.caltech.edu/Missions/spherex.html)
[![Backend: FastAPI + uv](https://img.shields.io/badge/Backend-FastAPI%20%2B%20uv-009688.svg)](backend/)
[![Database: Supabase Postgres](https://img.shields.io/badge/Database-Supabase%20Postgres-3ECF8E.svg)](https://supabase.com)
[![Frontend: React 18 + WebGL2](https://img.shields.io/badge/Frontend-React%2018%20%2B%20WebGL2%20%2B%20Aladin-61DAFB.svg)](web-client/)
[![Hosting: HF Spaces + Cloudflare Pages](https://img.shields.io/badge/Hosting-HF%20Spaces%20%2B%20Cloudflare-yellow.svg)](https://huggingface.co/spaces)

> **Finite minds trying to understand an infinite universe.**  
> An open-source, no-login workbench for seeing how the sky changes over time and for reading 102-channel spectra from NASA's SPHEREx mission.

**Live demo:** [https://spectra-seven-opal.vercel.app/](https://spectra-seven-opal.vercel.app/)

---

## 1. What Spectra Is

Spectra is a web workbench built for the NASA Space Apps Challenge prompt:

> **"Display images of the sky from the SPHEREx mission, making it easy for anyone to quickly see how they change over time."**

It has two portals:

- **`/explore` — public explorer suite.** Five tabs for browsing the sky, blinking between observation dates, reading spectra, mapping ices, and discussing findings.
- **`/admin` — mission control.** Five read-only-by-default tabs for inspecting model training, activations, decision boundaries, triage queues, and data exports.

There is no sign-up or password wall. Each browser creates a local observer identity the first time it loads the app, so visitors can take part without friction.

### The mission behind the data

NASA's **SPHEREx** telescope (launched in early 2025) maps the entire sky every six months in **102 near-infrared channels** covering **0.75 µm to 5.00 µm**. Its native resolution is about **6.2 arcseconds per pixel**. It observes more than a billion objects across four all-sky passes and more than 50 deeper passes over the ecliptic poles.

### Why SPHEREx time-domain data is hard to use

Blinking raw SPHEREx images is not enough. Four problems get in the way:

1. **Sky projections distort shapes.** Wide 2D sky maps stretch and bend objects, especially near survey edges.
2. **The spacecraft rolls between exposures.** Each 2040 × 2040 detector frame has a different rotation angle, so a naive blink makes the star field appear to spin.
3. **The filter is not one color.** SPHEREx uses a Linear Variable Filter (LVF) whose wavelength changes continuously along the detector's Y axis. A raw cutout is therefore not monochromatic.
4. **Pixels are large.** At 6.2 arcseconds per pixel, crowded star fields blend several sources into one pixel.

### How Spectra solves them

- **North-up tangent-plane navigation.** Aladin Lite v3 with WebGL2, plus a procedural astrometric starfield fallback, gives a full-viewport sky navigator. Detector footprints are reprojected into north-up tangent planes so objects stay put between epochs.
- **GPU-native float math.** Asinh stretching and wavelength-matched difference subtraction run directly on raw IEEE-754 32-bit float buffers in WebGL2 shaders, with no extra copy into 8-bit images.
- **Smile-aware spectra.** The HDU 6 `WCS-WAVE` table is inverted to turn the LVF shift into calibrated 102-channel spectra.
- **Fast spectral matching.** An in-memory NumPy cosine search compares spectra without a vector database.

### Real data, not fake pixels

Spectra queries the **NASA/IPAC Infrared Science Archive (IRSA)** through SIA2 and the IRSA Cutout API.

- The time-domain viewer uses `IRSA_COLLECTION` (default `spherex_qr3`; set `spherex_qr2` for QR2).
- Observation passes are built from the exposure MJDs returned by the archive.
- Only verified archive cutouts are rendered. If a release returns no usable data, the UI shows an unavailable state instead of inventing pixels.
- The checked-in benchmark `.f32` bundles are simulated fixtures. The time-domain viewer does not use them as live data.

---

## 2. Architecture: 5 Public Tabs + 5 Admin Tabs

```
                           +-------------------------------------------------------+
                           |                   SPECTRA WORKBENCH                   |
                           +-------------------------------------------------------+
                                    |                                       |
                +---------------------------------------+   +---------------------------------------+
                |    PORTAL A: PUBLIC EXPLORER SUITE    |   |     PORTAL B: ADMIN MISSION CONTROL   |
                |               (/explore)              |   |               (/admin)                |
                +---------------------------------------+   +---------------------------------------+
                | Tab 1: Celestial Navigator (3D Dome)  |   | Tab 1: Training Dynamics & Loss Studio|
                | Tab 2: Time-Domain Comparator (Blink) |   | Tab 2: Parameter & Activation Inspector|
                | Tab 3: Spectrophotometric Lab (102-ch)|   | Tab 3: Decision Boundary Animator (3D)|
                | Tab 4: Molecular & Ice Mapping Studio |   | Tab 4: Disagreement & Escalation Queue|
                | Tab 5: Observation Discussions (Feed) |   | Tab 5: Calibration & Data Product Hub |
                +---------------------------------------+   +---------------------------------------+
```

### Public explorer (`/explore`)

- **Tab 1 — Celestial Navigator** (`/explore?tab=navigator`): A full-window sky survey view. Uses a `TAN` projection in Aladin Lite v3 WebGL2, with a continuous procedural starfield fallback. Supports panning in any direction, zooming from 60° to 1 arcminute, the SPHEREx coverage MOC, Gaia DR3 proper-motion vectors, universal coordinate input, and a docked instrument strip. See [`DESIGN.md`](DESIGN.md).
- **Tab 2 — Time-Domain Comparator** (`/explore?tab=comparator`): A WebGL2 player for multiple observation epochs. Includes an Asinh stretch slider, pairwise difference subtraction (`t_N - t_0`), inverse-variance co-addition for faint brown dwarfs, sub-pixel Gaia DR3 centroid pins (0.77 px/yr deblending), discrete six-month survey-epoch stepping, and a live hover HUD.
- **Tab 3 — Spectrophotometric Lab** (`/explore?tab=spectrophotometer`): A `uPlot` canvas chart of 102 calibrated flux channels with `VARIANCE` error bars at 60 FPS. Supports synchronized epoch animation, two-component composite spectral unmixing (`a · T₁ + b · T₂`), an automated galaxy photo-`z` solver (`P(z)`, lookback time, Mpc distance), and an in-memory 102-band NumPy cosine similarity search that runs in under 20 ms.
- **Tab 4 — Molecular & Ice Mapping Studio** (`/explore?tab=ice_studio`): Continuum-normalized optical depth (`τ_λ`), point-source aperture photometry on background stars (seeded from the IRSA SPLICES catalog), and quantitative ice column-density integration (`N_ice` in cm⁻²). Uses verified laboratory A-values for H₂O (3.05 µm), CO₂ (4.27 µm), ¹³CO₂ (4.38 µm), CO (4.67 µm), and CH₃OH (3.54 µm).
- **Tab 5 — Observation Discussions** (`/explore?tab=discussions`): A Zooniverse Talk-style science forum with channel tags (`#movers`, `#spectra`, `#ices`, `#artifacts`, `#confirmed`), shareable deep-link state snapshots, live updates over FastAPI SSE (`/api/forum/stream`), and Bayesian consensus ranking.

### Admin mission control (`/admin`)

- **Tab 1 — Training Dynamics & Loss Studio** (`/admin/dynamics`): Live learning curves, gradient L2 norms, learning-rate annealing, and early-stopping monitors via `uPlot`.
- **Tab 2 — Parameter & Activation Inspector** (`/admin/internals`): Sequential 3D ridgeline histograms of weights and biases across epochs, layer activations, and Grad-CAM saliency heatmaps.
- **Tab 3 — Decision Boundary Animator** (`/admin/boundaries`): 3D decision-boundary surfaces that morph across epochs in physical and UMAP latent space, rendered with `react-plotly.js` WebGL surfaces.
- **Tab 4 — Hard-Negative & Escalation Queue** (`/admin/triage`): AI-versus-human disagreement mining (`|P_AI − P_Human|`), raw Multi-Extension FITS inspection (MEF HDUs 1–6), and one-click candidate promotion.
- **Tab 5 — Calibration & Data Product Hub** (`/admin/exports`): Volunteer Bayesian reliability audits (`w_u`), gold-standard controls, and one-click export of the four official SPHEREx community data products (CSV, VOTable, JSON, and PyTorch HDF5 training tensors).

---

## 3. NASA Benchmark Targets

All coordinates, proper motions, and spectral features below are propagated to the SPHEREx mission midpoint (`t = 2025.5`).

| Target | Class | Coordinates (2025.5) | What Tab 2 should show | What Tabs 3 & 4 should show |
|---|---|---|---|---|
| **Barnard's Star** | M4V red dwarf | `269.44639°, +4.76676°` | Moves `+10.39″/yr = 1.68 px/yr` north; saturation handling | Peaks at 1.1 µm; deep H₂O steam absorption |
| **WISE 0855-0714** | Y4 sub-brown dwarf | `133.73712°, -7.24038°` | Faint below 3.5 µm; moves west in D5 (`8.15″/yr`); honest non-detection when absent | Deep CH₄ (3.3 µm) and H₂O (3.05 µm) valleys; 4.5 µm peak |
| **Epsilon Indi B** | T1 + T6 binary | `331.09566°, -56.80031°` | Moves `4.68″/yr = 0.76 px/yr` southeast; `1/cos δ` correction fixes a 46″ error; blended in one 6.2″ pixel | Blended 6.2″ pixel unmixes into T1 + T6 brown-dwarf templates |
| **RW Aurigae** | T Tauri variable | `76.95647°, +30.40130°` | Stationary (`<0.3 px`); flashing monopole ring with `>1.5 mag` dimming | Multi-epoch spectrum dims in D1; thermal infrared dust excess in D4/D5 |
| **R Draconis** | Mira AGB variable | `248.16773°, +66.75504°` | Stationary pulsating monopole (`245 d` period; `8.61°` from the North Ecliptic Pole) | Animated spectrum shows H₂O and CO bands turning on at different phases |

---

## 4. Identity and Privacy Without Login Walls

To keep the hackathon experience frictionless while still supporting attribution and moderation:

- **No blocking sign-in.** `/explore` and `/admin` open directly; there are no passwords or sign-up forms.
- **Local browser identity.** On first load the browser creates and stores:
  1. `spx_observer_id` — a public UUIDv4 in `localStorage`.
  2. `spx_observer_key` — a secret 32-byte cryptographic string in `localStorage`.
  3. A human-readable celestial callsign, for example `Observer-Vega-409`.
- **Headers on mutating requests.**
  ```http
  X-Observer-ID: 7b3d1f8a-4092-4e8c-a1e9-5cf287a911e3
  X-Observer-Key: <secret_32_byte_string>
  ```
- **Hashed storage.** The backend stores only `sha256(observer_key)` in the `observers` table (`key_hash`). Raw keys and internal observer IDs never appear in read endpoints or public discussions.
- **Admin safety.** `/admin` is read-only by default (`ADMIN_MUTATIONS_ENABLED=false`). Mutations require a server-held `ADMIN_TOKEN`. Verified admin replies get the gold `[Moderator]` badge.
- **Data honesty.** Every catalog, candidate, and artifact is labelled `Community Product`; nothing implies NASA endorsement.

---

## 5. Technology Stack

| Layer | Technologies | Responsibility |
|---|---|---|
| **Frontend UI** | React 18, Vite 5, TypeScript 5.5, Tailwind CSS | Single-page app with route-level code splitting. |
| **Sky Visualizer** | Aladin Lite v3 (WebGL2), Canvas 2D | Full-window north-up tangent-plane sky view with SPHEREx coverage MOC and astrometric starfield. |
| **Float32 Comparator** | WebGL2 fragment shaders, IEEE-754 `Float32Array` | Zero-copy Asinh stretch, wavelength-matched differencing, and coverage matrix. |
| **URL State** | `nuqs` query strings | Type-safe URL parameters (`tab`, `ra`, `dec`, `band`, `win`, `mode`, `epoch`, `px`, `py`, `z`, `embed`). |
| **Async Caching** | `@tanstack/react-query` v5 | Prefetch on hover, 30-minute stale time, request deduplication. |
| **Fast Plotting** | `uPlot` (Canvas 2D) | 60 FPS rendering under 1.5 ms per frame for spectra and MJD scatter points. |
| **UI Primitives** | Radix UI, `cmdk` (Ctrl+K palette), TanStack Virtual | Accessible primitives, instant command bar, virtualized feeds. |
| **Backend Service** | Python 3.11, FastAPI, `uv`, Ruff | One service on port 7860, native to Hugging Face Spaces, with sub-3-second environment resolution from `uv.lock`. |
| **Astro Pipeline** | `astropy`, `pyvo`, `reproject`, `scipy`, `numpy` | IRSA Cutout API client, SIA2 discovery, WAVE-TAB smile evaluation, `reproject_exact`, PSF centroid fitting. |
| **Vector Similarity** | In-memory NumPy cosine search | Sub-20 ms spectral template matching without a vector database. |
| **Database** | Supabase Postgres 16 (Session Pooler) | IPv4 session-mode pooler on port 5432, RLS on every table, zero anon policies. |
| **Dev Runner** | `Taskfile.yml` + Supabase CLI | One command to orchestrate Python, React, and the local database. |

---

## 6. Run It Locally

**Live demo:** [https://spectra-seven-opal.vercel.app/](https://spectra-seven-opal.vercel.app/)

### Prerequisites

- **Docker** and **Docker Compose** for local Supabase PostgreSQL 16.
- **Python 3.11+** and **`uv`**: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- **Node.js 20+** and **npm**.
- **Task**: `sh -c "$(curl --location https://taskfile.dev/install.sh) -- -d"`
- **Supabase CLI**: `npm install -g supabase`

See [`prerequisites.md`](prerequisites.md) for the full rationale.

### One-command setup

```bash
# 1. Install Python and React dependencies (usually under 10 seconds)
task setup

# 2. Start local Supabase Postgres, apply the schema, and seed the 5 NASA benchmarks
task db:up

# 3. Synchronize OpenAPI TypeScript definitions
task types:sync

# 4. Start everything (FastAPI on :7860, Vite client on :3000)
task dev
```

Open **`http://localhost:3000/explore`**.

---

## 7. Roadmap: Four Sequential, Priority-Gated Phases

Each phase ends with a self-contained, demonstrable milestone before the next one begins.

1. **Phase 1 (P0 — Core NASA Challenge Foundation)**
   - FastAPI backend on port 7860 with an IRSA SIA2 client, IRSA Cutout API ingestion, north-up WCS reprojection, and Float32 binary streaming.
   - Pre-seeded database containing the five NASA benchmark targets (`seed_benchmarks.sql`).
   - In-memory benchmark cache with sub-10 ms responses.
   - Tab 1 (Navigator / Aladin dome) and Tab 2 (Comparator / WebGL2 Float32 blinker, difference subtraction, Asinh slider, discrete survey-epoch snapping).
   - **Gate 1:** 100% of the NASA challenge prompt is satisfied and shippable.

2. **Phase 2 (P1 — Scientific Differentiator and Community Intelligence)**
   - HDU 6 `WCS-WAVE` smile lookup and 102-channel hyperspectral extraction.
   - In-memory NumPy cosine similarity: 10,000 spectra in under 20 ms.
   - Tab 3 (Spectrophotometric Lab with a 60 FPS 102-band `uPlot` chart, composite unmixing, and photo-`z` solver).
   - Tab 5 (Observation Discussions with embedded deep-link snapshots and a live FastAPI SSE feed).
   - **Gate 2:** Hyperspectral analysis and live community peer review are operational.

3. **Phase 3 (P2 — Institutional Polish and Mission Control)**
   - Tab 4 (Molecular & Ice Studio with the quantitative column-density integrator `N_ice` for SPLICES background stars).
   - Admin mission control (`/admin`): five isolated tabs (Dynamics, Internals, Boundaries 3D, Triage, Exports).
   - PyTorch live-training WebSocket feed (`/api/admin/ws/training`) with pre-trained diagnostic weights.
   - **Gate 3:** The 10-tab flagship suite works with live machine-learning observability.

4. **Phase 4 (Deployment, Hardening, and Compliance)**
   - Hugging Face Spaces single-container deployment (FastAPI on port 7860 via `uv`, 16 GB RAM Docker).
   - Cloudflare Pages CDN with edge-cached `/benchmarks/*.json` and `*.f32` fallback cutouts.
   - Supabase Cloud with Session Pooler (port 5432, IPv4) and Row Level Security (RLS) policies.
   - Dual keep-alive for `/api/health` via cron-job.org (every 5 minutes) plus a GitHub Actions backup.
   - Offline demo-laptop mirror (`task dev`) and a 24-hour pre-judging code freeze.
   - **Gate 4:** 24/7 warm cloud deployment plus a 100% offline venue presentation guarantee.

---

## 8. Documentation

- **[`SPECIFICATION.md`](SPECIFICATION.md):** Authoritative technical specification (v3.0.0-PROD): formulas, WCS reprojection pipelines, database DDL, component wireframes, and deployment runbooks.
- **[`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md):** Systems architecture and design document (v3.0.0-PROD): 4+1 view model, 10 SDD sections, ADRs, and verification matrices.
- **[`docs/PLAIN_LANGUAGE_GUIDE.md`](docs/PLAIN_LANGUAGE_GUIDE.md):** A plain-but-technical explanation of how Spectra works, what the terms mean, and where the code lives.
- **[`prerequisites.md`](prerequisites.md):** Build essentials, runtimes, and developer acceleration tools (`uv`, Taskfile, `nuqs`, and others).
- **[`.agents/CONTEXT.md`](.agents/CONTEXT.md):** Chronological architectural log covering Exchanges #1 through #42 of the project ideation.

---

## 9. Data Acknowledgement and Citations

This platform uses data products from the **NASA SPHEREx** mission:

- **Primary archive:** NASA/IPAC Infrared Science Archive (IRSA), SPHEREx Quick Release 3 by default (`spherex_qr3`); set `IRSA_COLLECTION=spherex_qr2` to use QR2.
- **Archive documentation:** [IRSA SPHEREx Mission Portal](https://irsa.ipac.caltech.edu/Missions/spherex.html) and the [SPLICES Ice Catalog](https://irsa.ipac.caltech.edu/data/SPHEREx/SPLICES/).
- **External catalogs:** ESA Gaia DR3, NASA/IPAC AllWISE, and Pan-STARRS1 (STScI).
- **Sky engine:** Aladin Lite v3, developed by CDS, Observatoire Astronomique de Strasbourg, France, under GNU GPL-3.0.

---

## 10. License

Spectra is released under the **GNU General Public License v3.0 (GPL-3.0)** to stay compatible with astronomical libraries including Aladin Lite v3. See [`LICENSE`](LICENSE).
