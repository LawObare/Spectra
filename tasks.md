# Spectra Developer Task Breakdown & Role-Lock Ledger (`tasks.md`)

> **AUTHORITATIVE WORK ALLOCATION FOR THE 6-ENGINEER SPECTRA TEAM.**  
> Work is partitioned by **functional relevance, zero file collisions, and equal engineering weight (`~16.6%–16.7%` per developer)** across all 30 issues (`E1`: 5, `E2`: 5, `E3`: 4, `E4`: 4, `E5`: 5, `E6`: 7 = **30 issues total**). Every developer builds substantive production code, and every GitHub issue (`#1`–`#30`) and source file has **one sole owner**.

---

## 0. Role Governance: 1-to-1 Developer-to-Role Bijection & Zero Cross-Role Poaching

### 0.1 The 1-to-1 Developer-to-Role Bijection Rule (No Two Devs on the Same Role)

To prevent two developers (or their AI agents) from accidentally claiming and working the same role (`E1`–`E6`) in parallel, every role is locked **1-to-1** to a single developer's GitHub identity (`gh api user --jq .login`) and Git email (`git config user.email`) in the **Official Role Lock Roster** below:

| Role ID | GitHub Role Label | Locked GitHub Username (`@handle`) | Locked Git Email (`git config user.email`) | Assigned Issues |
|---|---|---|---|---|
| **`E1`** | `role:E1-astro` | `<CLAIM_WITH_SINGLE_GITHUB_HANDLE>` | `<CLAIM_WITH_GIT_EMAIL>` | `#3, #9, #10, #11, #19` (5) |
| **`E2`** | `role:E2-backend` | `<CLAIM_WITH_SINGLE_GITHUB_HANDLE>` | `<CLAIM_WITH_GIT_EMAIL>` | `#5, #7, #8, #12, #22` (5) |
| **`E3`** | `role:E3-webgl` | `<CLAIM_WITH_SINGLE_GITHUB_HANDLE>` | `<CLAIM_WITH_GIT_EMAIL>` | `#1, #17, #18, #27` (4) |
| **`E4`** | `role:E4-frontend` | `@LawObare` | `obarelawrence.acc@gmail.com` | `#14, #15, #16, #23` (4) |
| **`E5`** | `role:E5-datasci` | `<CLAIM_WITH_SINGLE_GITHUB_HANDLE>` | `<CLAIM_WITH_GIT_EMAIL>` | `#2, #20, #21, #25, #26` (5) |
| **`E6`** | `role:E6-devops` | `@Musaamanipeace` | `amanimosespeace@gmail.com` | `#4, #6, #13, #24, #28, #29, #30` (7) |

**Mandatory Bijection Enforcement Rules:**
1. **Strictly One Human Per Role (`|Devs(E_k)| = 1`):** Each row (`E1`–`E6`) in the table above may contain **only one** GitHub username and **only one** Git email. Committing two usernames/emails into one role row (e.g., `@alice, @bob`) is forbidden.
2. **Strictly One Role Per Human (`|Roles(Dev_i)| = 1`):** A developer's GitHub username and Git email may appear in **at most one row** across `E1`–`E6`.
3. **Mandatory Pre-Flight Identity Check by AI Agents:** Before executing any code change on any issue `#<N>`, the AI agent **must run**:
   ```bash
   gh api user --jq .login && git config user.email
   gh issue view <N> --json labels,assignees
   ```
   and verify three conditions:
   - **Check A (Roster Match):** The active developer's GitHub handle and Git email match the single owner recorded in §0.1 for the role label on Issue `#<N>`.
   - **Check B (No Duplicate Role Claim on GitHub):** No other GitHub user is assigned to any issue carrying that `role:E*` label (`gh issue list --label <role_label> --json assignees`).
   - **Check C (Agent Refusal on Role Collision):** If the role is already claimed by a different GitHub handle in §0.1 or on GitHub Issues, the agent **must halt and refuse immediately**:
     > *"STOP: Role `<E_k>` (`<role:E_k-*>`) is already locked to `@<existing_owner>`. Under the 1-to-1 Developer-to-Role Bijection Rule (`tasks.md` §0.1 & `AGENTS.md` §6.1), two developers cannot share or execute the same role."*

### 0.2 The Zero Cross-Role Poaching Rule (No Doing Another Role's Issues)

1. **Strict Single-Owner Lock:** Each GitHub Issue (`#1`–`#30`) belongs exclusively to the developer role (`E1`–`E6`) assigned in this document. **No developer (or their AI agent) may claim, implement, or open a PR for another developer's assigned issue.**
2. **Agent Role Self-Check:** Before executing any code change on Issue `#<N>`, the AI agent must verify that Issue `#<N>` is listed under its operator's locked role (`E1`–`E6`) in `tasks.md`. If a human prompts an agent with an issue ID belonging to another role, the agent must **refuse and halt**.
3. **File Write-Fence Enforcement:** Modifying any file in another developer's exclusive write territory (`git diff --name-only origin/develop...HEAD`) is a blocking PR violation.
4. **Mandatory Pre-Merge Code Review, 5-Block Handover, `develop` Integration & Issue Closure ([`AGENTS.md` §7](AGENTS.md#L152-L202)):**
   - All agents branch from and merge into `develop` (`feat/issue-<N>-<slug>` $\rightarrow$ `develop`).
   - Before merging into `develop`, every agent must run the dual-axis [`code-review`](.agents/skills/code-review/SKILL.md) skill against `origin/develop`, post the **5-Block Technical Handover Summary** to the PR and Issue `#<N>` (`gh issue comment <N>`), and squash-merge into `develop`.
   - **Mandatory Automated Issue Closure on Merge (All Bots):** The moment a PR is successfully merged into `develop`, the agent **must immediately close Issue `#<N>`** (`gh issue close <N>`) and verify `gh issue view <N> --json state` returns `"CLOSED"`. Leaving an issue open after its PR has merged is strictly prohibited.
   - Verified batches are promoted from `develop` $\rightarrow$ `main` at each Phase Milestone Gate.
5. **What If You Finish Your Phase Queue Early?**
   - Do **not** poach a teammate's open issue in the current phase or jump ahead to implement another developer's next-phase UI.
   - Instead: (a) write unit/integration tests within your own territory, (b) review open PRs, or (c) prepare local `.plan` drafts for **your own** next-phase issues without merging them until the current Milestone Gate passes.

---

## 1. Workload Distribution Summary (Balanced by Domain Relevance & Engineering Weight)

| Dev | Role Label | Domain Specialization | Assigned Issues | Issue Count | Est. Work Share |
|---|---|---|---|---|---|
| **Dev 1 (`E1`)** | `role:E1-astro` | **Astrophysics, FITS HDUs 1–6, WCS Reprojection, PSF Photometry & 102-Band Extraction** | `#3`, `#9`, `#10`, `#11`, `#19` | **5** | **16.7% (~1,750 LOC)** |
| **Dev 2 (`E2`)** | `role:E2-backend` | **Core FastAPI Engine, PostgreSQL `asyncpg`, IRSA/S3 Ingestion, Bounded Queue & Zero-Auth** | `#5`, `#7`, `#8`, `#12`, `#22` | **5** | **16.7% (~1,850 LOC)** |
| **Dev 3 (`E3`)** | `role:E3-webgl` | **HDU 2 `FLAGS` Audit, WebGL2 `gl.R32F` GPU Pipeline, Tab 2 Comparator & Admin 3D Isosurfaces** | `#1`, `#17`, `#18`, `#27` | **4** | **16.7% (~1,900 LOC)** |
| **Dev 4 (`E4`)** | `role:E4-frontend` | **React App Shell, `nuqs`/Zustand State, Global Header, Tab 1 3D Sky Dome & Tab 5 SSE Forum** | `#14`, `#15`, `#16`, `#23` | **4** | **16.6% (~1,800 LOC)** |
| **Dev 5 (`E5`)** | `role:E5-datasci` | **Benchmark Pass Audit, 102-Band Cosine Search, Tab 3 `uPlot` Lab, Tab 4 Ice Studio & PyTorch ML** | `#2`, `#20`, `#21`, `#25`, `#26` | **5** | **16.7% (~1,900 LOC)** |
| **Dev 6 (`E6`)** | `role:E6-devops` | **Scaffold, Benchmark `.f32` Pipeline, Synthetic PSF Injector, Admin Triage/Exporter & Cloud Deploy** | `#4`, `#6`, `#13`, `#24`, `#28`, `#29`, `#30` | **7** | **16.6% (~1,850 LOC)** |

---

## 2. Detailed Per-Developer Job Ledger

### Dev 1 (`E1` — `role:E1-astro`): Astrophysical & FITS Science Pipeline Lead
**Exclusive Territory:** `backend/science/{wave_match,reproject,centroid,wave}.py`, `backend/api/spectrum.py`, `scripts/spike_s3_cutout_vs_s3.py`, `backend/tests/test_science_{wave_match,reproject,centroid,wave}.py`  
**Forbidden Territory:** `backend/db/*`, `backend/science/{ingest,injector,similarity}.py`, `backend/api/{cutout,resolve,classify,forum,export}.py`, `web-client/*`

| Phase | Issue | Exact Job & Target Files |
|---|---|---|
| **Phase 0** | [#3](https://github.com/LawObare/Spectra/issues/3) | **[Spike S3] IRSA Cutout API vs. S3 Byte-Range Benchmark & Sub-Array WCS Offset Verification**<br>- File: `scripts/spike_s3_cutout_vs_s3.py`<br>- Benchmark IRSA server-side cutout latency vs `s3://nasa-irsa-spherex/qr2/` byte-range reads.<br>- Verify exact FITS sub-array offset keywords (`CRPIX1`/`CRPIX2` shift vs `CRPIX1A`/`CRPIX2A` vs `LTV1`/`LTV2`) so cropped cutouts map back to parent detector coordinates $(x_{\text{det}}, y_{\text{det}}) \in [0, 2040]$. |
| **Phase 1 (P0)** | [#9](https://github.com/LawObare/Spectra/issues/9) | **[Science] Pre-Reprojection HDU 6 `WAVE-TAB` Adaptive Wavelength Matcher**<br>- File: `backend/science/wave_match.py`, `backend/tests/test_science_wave_match.py`<br>- Interpolate central wavelength $\lambda(x_{\text{det}}, y_{\text{det}})$ from HDU 6 `WCS-WAVE` *before* reprojection. Filter exposures per `(Epoch, Band)` to $[\lambda_0(1-w_b), \lambda_0(1+w_b)]$ ($w_b = 1/R_b$), widening adaptively when `adaptive_window=True`. |
| **Phase 1 (P0)** | [#10](https://github.com/LawObare/Spectra/issues/10) | **[Science] Flux-Conserving Master Tangent Reprojection & Inverse-Variance Coaddition Engine**<br>- File: `backend/science/reproject.py`, `backend/tests/test_science_reproject.py`<br>- Build synthetic North-Up `RA---TAN`/`DEC--TAN` WCS ($6.2''/\text{px}$), offload `reproject_exact` (`IMAGE`, `VARIANCE`) and nearest-neighbor `reproject_interp` (`FLAGS`) to `ProcessPoolExecutor(max_workers=2)`, exclude fatal flags (`OVERFLOW`, `NONFUNC`, `TRANSIENT`), and compute inverse-variance coadds + `N_EXPOSURES` (`uint16`). |
| **Phase 1 (P0)** | [#11](https://github.com/LawObare/Spectra/issues/11) | **[Science] Native Per-Exposure HDU 5 PSF Centroiding Engine**<br>- File: `backend/science/centroid.py`, `backend/tests/test_science_centroid.py`<br>- Fit sub-pixel 2D centroids in native detector space using empirical HDU 5 3D PSF cubes indexed by $(x_{\text{parent}}, y_{\text{parent}})$, combine via inverse-covariance weighting $\vec{r}(e,b) = (\sum \mathbf{\Sigma}_i^{-1})^{-1}\sum \mathbf{\Sigma}_i^{-1}\vec{r}_i$, and compute proper motion SNR. |
| **Phase 2 (P1)** | [#19](https://github.com/LawObare/Spectra/issues/19) | **[Science] HDU 6 `WCS-WAVE` 102-Channel Smile Inversion & Forced PSF Spectrophotometry**<br>- File: `backend/science/wave.py`, `backend/api/spectrum.py`, `backend/tests/test_science_wave.py`<br>- Extract 102-channel spectra ($0.75-5.00\,\mu\text{m}$) in Janskys ($F_\nu = I_\nu \times 10^6 \times \Omega_{\text{px}}$) via HDU 5 PSF fitting, track MJD span (`is_simultaneous`), and implement $3\sigma$-clipped 4th-order Chebyshev continuum normalization (`GET /api/spectrum`). |

---

### Dev 2 (`E2` — `role:E2-backend`): Backend Platform, Database, Network I/O & API Lead
**Exclusive Territory:** `backend/main.py`, `backend/db/{schema.sql,pool.py,queries.py}`, `backend/cache/*`, `backend/science/ingest.py`, `backend/api/{resolve,cutout,auth,classify}.py`, `backend/tests/{test_sql,test_api_*,test_science_ingest}.py`  
**Forbidden Territory:** `backend/science/{wave_match,reproject,centroid,wave,injector,similarity}.py`, `backend/ml/*`, `web-client/*`

| Phase | Issue | Exact Job & Target Files |
|---|---|---|
| **Phase 1 (P0)** | [#5](https://github.com/LawObare/Spectra/issues/5) | **[DB] PostgreSQL 16 Schema, `asyncpg` Query Layer & Automated SQL `EXPLAIN` Test**<br>- Files: `backend/db/schema.sql`, `backend/db/pool.py`, `backend/db/queries.py`, `backend/tests/test_sql.py`<br>- Implement all 7 relational tables (`heartbeat`, `subjects`, `observers`, `classifications`, `discussion_threads`, `discussion_replies`, `ml_training_runs`), connection pooling, parameterized SQL queries, and `EXPLAIN` CI test. |
| **Phase 1 (P0)** | [#7](https://github.com/LawObare/Spectra/issues/7) | **[API] Universal Target & Coordinate Resolver Endpoint (`GET /api/resolve`)**<br>- Files: `backend/api/resolve.py`, `backend/tests/test_api_resolve.py`<br>- Parse decimal degrees and sexagesimal coordinates (never propagating arbitrary user coords), resolve named targets via in-memory `LOCAL_CATALOG_MAP` ($<1\,\text{ms}$) and CDS Sesame XML fallback with a strict 2.0s circuit breaker. |
| **Phase 1 (P0)** | [#8](https://github.com/LawObare/Spectra/issues/8) | **[Backend I/O] IRSA SIA2 Exposure Discovery & Server-Side MEF Cutout Ingestion Driver**<br>- Files: `backend/science/ingest.py`, `backend/tests/test_science_ingest.py`<br>- Query SIA2 cone via async `httpx`, group exposures dynamically by survey pass MJDs (`survey_passes.json`), fetch MEF cutouts (HDUs 1–6) from IRSA Cutout Service (primary) with anonymous S3 byte-range slicing (`fsspec`) as fallback. |
| **Phase 1 (P0)** | [#12](https://github.com/LawObare/Spectra/issues/12) | **[API] Bounded Cutout Queue, SSE Progress Stream & Byte-Shuffled Zstd Float32 Tensor Endpoint**<br>- Files: `backend/api/cutout.py`, `backend/cache/lru.py`, `backend/tests/test_api_cutout.py`<br>- Implement 1.0 GB byte-capped `LRUCache`, `POST /api/cutout` (`asyncio.Queue(maxsize=5)`, `202 Accepted` or `503` with `Retry-After: 15`), `GET /api/cutout/progress/{task_id}` (SSE), and `GET /api/cutout/{task_id}/tensor` (14 B/px little-endian binary stream + `zstd-shuffle`). |
| **Phase 2 (P1)** | [#22](https://github.com/LawObare/Spectra/issues/22) | **[API] Zero-Auth Observer Session Guard, Rate Limiter & Bayesian Consensus Engine**<br>- Files: `backend/api/auth.py`, `backend/api/classify.py`, `backend/tests/test_api_classify.py`<br>- Verify `X-Observer-ID` + `sha256(X-Observer-Key)` against `observers.key_hash`, enforce 60 writes/min token-bucket rate limiter, update Bayesian reliability weight $w_u$, recompute Shannon entropy $H(S)$, and serve `GET /api/queue/next`. |

---

### Dev 3 (`E3` — `role:E3-webgl`): Graphics, GLSL Shaders, Time-Domain Comparator & 3D Admin Viz Lead
**Exclusive Territory:** `scripts/spike_s1_irsa.py`, `backend/config/{flags,detectors}.json`, `web-client/src/shaders/*`, `web-client/src/workers/*`, `web-client/src/tabs/TimeDomainComparator.tsx`, `web-client/src/components/WebGLComparatorCanvas.tsx`, `web-client/src/admin/{AdminLayout,TrainingDynamics,ActivationInspector,DecisionBoundaries}.tsx`, `web-client/src/admin/hooks/useAdminTelemetry.ts`  
**Forbidden Territory:** `backend/{api,db,science,ml}/*`, `web-client/src/store/*`, `web-client/src/tabs/{CelestialNavigator,SpectrophotometricLab,MolecularIceStudio,ObservationDiscussions}.tsx`

| Phase | Issue | Exact Job & Target Files |
|---|---|---|
| **Phase 0** | [#1](https://github.com/LawObare/Spectra/issues/1) | **[Spike S1] Verify IRSA Collection, Resolving Power & Build HDU 2 `FLAGS` Table**<br>- Files: `scripts/spike_s1_irsa.py`, `backend/config/flags.json`, `backend/config/detectors.json`<br>- Query live IRSA SIA2 (`spherex_qr2`), inspect Level 2 MEF headers across D1–D6, verify zodiacal subtraction status, and generate `flags.json` (`uint32` bitmasks rendered in Tab 2) and `detectors.json` (used for 6-band RGB presets). |
| **Phase 1 (P0)** | [#17](https://github.com/LawObare/Spectra/issues/17) | **[Tab 2 Shaders] WebGL2 `gl.R32F` Floating-Point Shaders for Asinh Stretch, Signed Diff & Co-Add**<br>- Files: `web-client/src/shaders/float32_stretch.vert`, `web-client/src/shaders/float32_stretch.frag`, `web-client/src/components/WebGLComparatorCanvas.tsx`, `web-client/src/workers/tensorWorker.ts`<br>- Implement off-thread `zstd-wasm` un-shuffling worker (`Transferable` `Float32Array`), upload `FLUX` and `VARIANCE` planes to `gl.R32F` textures (`OES_texture_float_linear` probe + `gl.NEAREST`), and execute GPU Mode 0 (Asinh stretch), Mode 1 (symmetric signed difference around 0.5 mid-grey), Mode 2 (inverse-variance coadd), and 6-band RGB presets at 60 FPS. |
| **Phase 1 (P0)** | [#18](https://github.com/LawObare/Spectra/issues/18) | **[Tab 2 UI] `<TimeDomainComparator />`: Discrete Epoch Scrubber, Coverage Matrix, Gaia Pins & Aperture Light Curve**<br>- Files: `web-client/src/tabs/TimeDomainComparator.tsx`<br>- Build the 65%/35% Time-Domain Comparator deck: discrete MJD pass scrubber with Frame-0 cyan border, `(Epoch x Band)` coverage matrix with wavelength-matched differencing guard and `[Not Detected at Pass Depth]` states, HDU 2 `FLAGS` bitmask overlays, Raw vs. Rectified LVF smile toggle, sub-pixel Gaia DR3 centroid pins, forced $3\times 3$ aperture light curve (D1 vs D5), 2-click motion vector calculator, and live hover HUD. |
| **Phase 3 (P2)** | [#27](https://github.com/LawObare/Spectra/issues/27) | **[Admin Tabs 1–3] `<TrainingDynamics />`, `<ActivationInspector />` & WebGL 3D `<DecisionBoundaries />`**<br>- Files: `web-client/src/admin/{AdminLayout,TrainingDynamics,ActivationInspector,DecisionBoundaries}.tsx`, `web-client/src/admin/hooks/useAdminTelemetry.ts`<br>- Build `/admin/dynamics` (`uPlot` loss/F1/grad-norm curves + overfitting alert), `/admin/internals` (3D weight ridgelines + Grad-CAM heatmap overlay), and `/admin/boundaries` (lazy-loaded `plotly.js-gl3d-dist` WebGL 3D decision isosurfaces). |

---

### Dev 4 (`E4` — `role:E4-frontend`): Frontend Architecture, 3D Sky Navigator & Live Forum Lead
**Exclusive Territory:** `web-client/src/App.tsx`, `web-client/src/store/*`, `web-client/src/hooks/*`, `web-client/src/components/{GlobalCommandHeader,CommandPalette}.tsx`, `web-client/src/tabs/{CelestialNavigator,ObservationDiscussions}.tsx`, `backend/api/forum.py`, `backend/tests/test_api_forum.py`  
**Forbidden Territory:** `backend/science/*`, `backend/db/*`, `web-client/src/shaders/*`, `web-client/src/admin/*`, `web-client/src/tabs/{TimeDomainComparator,SpectrophotometricLab,MolecularIceStudio}.tsx`

| Phase | Issue | Exact Job & Target Files |
|---|---|---|
| **Phase 1 (P0)** | [#14](https://github.com/LawObare/Spectra/issues/14) | **[Frontend Core] App Shell, `nuqs` URL State, Zustand Telemetry Store & Keyboard Shortcuts**<br>- Files: `web-client/src/App.tsx`, `web-client/src/hooks/useSpectraUrlState.ts`, `web-client/src/store/useTelemetryStore.ts`, `web-client/src/hooks/useKeyboardTelemetry.ts`<br>- Implement code-split routing (`/explore/*` vs `/admin/*`), `nuqs` query parameter sync (`?embed=1` headless mode), frozen `TelemetryState` store, and global keyboard bindings (`Space`, `Arrows`, `1/2/3`, `R`, `I`, `Cmd+K`). |
| **Phase 1 (P0)** | [#15](https://github.com/LawObare/Spectra/issues/15) | **[Frontend UI] `<GlobalCommandHeader />`, Universal Coordinate Search, 5 Benchmark Pills & `cmdk` Palette**<br>- Files: `web-client/src/components/GlobalCommandHeader.tsx`, `web-client/src/components/CommandPalette.tsx`<br>- Build fixed `56px` header with live status dot, debounced coordinate/name input, 5 benchmark quick-launch pills with hover prefetching, FoV selector + 14 B/px payload gauge, Data Honesty Badges, Share/Embed modal, and `cmdk` palette. |
| **Phase 1 (P0)** | [#16](https://github.com/LawObare/Spectra/issues/16) | **[Tab 1] `<CelestialNavigator />`: Aladin Lite v3 WebGL2 3D Sky Dome, SPHEREx MOC & 3-Stage Camera Dive**<br>- Files: `web-client/src/tabs/CelestialNavigator.tsx`<br>- Mount Aladin Lite v3 in 3D `SIN` globe projection (`P/allWISE/color`), load `#00f0ff` SPHEREx MOC + `#ff0055` NEP/SEP deep-field rings, overlay VizieR Gaia DR3 proper motion vectors + SkyBot asteroids (2.0s circuit breaker), and implement 1.2s `animateToRaDec` dive into Tab 2. |
| **Phase 2 (P1)** | [#23](https://github.com/LawObare/Spectra/issues/23) | **[Tab 5] `<ObservationDiscussions />` & FastAPI Live SSE Forum Hub**<br>- Files: `web-client/src/tabs/ObservationDiscussions.tsx`, `web-client/src/hooks/useRealtimeDiscussions.ts`, `backend/api/forum.py`, `backend/tests/test_api_forum.py`<br>- Build `GET /api/forum/stream` (SSE), `POST /api/forum/threads`, `POST /api/forum/replies` (`[Moderator]` badge verification), and 3-column forum UI with `#hashtags`, embedded snapshot cards, `[Load in Workbench ->]` state rehydration, and SIMBAD/Gaia/LegacySurvey/WiseView deep links. |

---

### Dev 5 (`E5` — `role:E5-datasci`): Spectrophotometry, Astrochemistry Ice Lab & PyTorch ML Lead
**Exclusive Territory:** `scripts/spike_s2_benchmarks.py`, `backend/config/survey_passes.json`, `backend/science/similarity.py`, `backend/ml/*`, `backend/admin_ws.py`, `web-client/src/tabs/{SpectrophotometricLab,MolecularIceStudio}.tsx`  
**Forbidden Territory:** `backend/db/*`, `backend/api/*`, `web-client/src/store/*`, `web-client/src/admin/*`, `web-client/src/tabs/{CelestialNavigator,TimeDomainComparator,ObservationDiscussions}.tsx`

| Phase | Issue | Exact Job & Target Files |
|---|---|---|
| **Phase 0** | [#2](https://github.com/LawObare/Spectra/issues/2) | **[Spike S2] Audit 5 NASA Benchmark Coverage Matrices, Survey Pass MJDs & Saturation**<br>- Files: `scripts/spike_s2_benchmarks.py`, `backend/config/survey_passes.json`<br>- Query SIA2 for all 5 NASA benchmarks at Epoch 2025.5 coordinates, cluster exposure MJDs into survey pass boundaries, and document `(Epoch x Band)` coverage & saturation (used directly in Tab 3 spectral modeling). |
| **Phase 2 (P1)** | [#20](https://github.com/LawObare/Spectra/issues/20) | **[Science] OpenBLAS In-Memory NumPy Cosine Similarity Engine (`POST /api/subjects/similar`)**<br>- Files: `backend/science/similarity.py`, `backend/tests/test_similarity.py`<br>- Pre-normalize 10,000 102-channel reference spectra in C-contiguous `float32` RAM ($\approx 4.08\,\text{MB}$) and evaluate exact top-5 cosine matches via SIMD `np.dot` + `np.argpartition` in `<8 ms`. |
| **Phase 2 (P1)** | [#21](https://github.com/LawObare/Spectra/issues/21) | **[Tab 3] `<SpectrophotometricLab />`: 60 FPS `uPlot` 102-Channel Plotter, NNLS Unmixing & Galaxy Photo-$z$ Solver**<br>- Files: `web-client/src/tabs/SpectrophotometricLab.tsx`<br>- Build 60 FPS `uPlot` 102-channel chart with D1–D6 band shading, `VARIANCE` error bars, flagged channel amber triangles, MJD color coding (R Draconis non-simultaneity), ARIA table, 2-component NNLS unmixing (Epsilon Indi B T1+T6), and galaxy photo-$z$ solver ($z \in [0, 2.5]$) with rest-frame line ruler slider. |
| **Phase 3 (P2)** | [#25](https://github.com/LawObare/Spectra/issues/25) | **[Tab 4] `<MolecularIceStudio />`: SPLICES Point-Source Photometry & Lab $A$-Value Ice Column Density Integrator**<br>- Files: `web-client/src/tabs/MolecularIceStudio.tsx`<br>- Implement SPLICES background star workflow (aperture + sky annulus subtraction), 4th-order Chebyshev continuum fit, optical depth $\tau(\lambda) = -\ln(F/F_{\text{cont}})$, and wavenumber integration $N_{\text{ice}} = \frac{1}{A}\int \tau(\nu)d\nu$ using verified lab $A$-values for $\text{H}_2\text{O}$ ($3.05\,\mu\text{m}$), $\text{CO}_2$ ($4.27\,\mu\text{m}$), $^{13}\text{CO}_2$ ($4.38\,\mu\text{m}$), $\text{CO}$ ($4.67\,\mu\text{m}$), and $\text{CH}_3\text{OH}$ ($3.54\,\mu\text{m}$). |
| **Phase 3 (P2)** | [#26](https://github.com/LawObare/Spectra/issues/26) | **[ML Engine] PyTorch Models, Forward/Backward Hooks & Admin WebSocket Telemetry Hub**<br>- Files: `backend/ml/{models,trainer,telemetry,meshgrid,dataset}.py`, `backend/ml/weights/*`, `backend/admin_ws.py`<br>- Implement `DipoleConvNet3D`, `SpectralResNet102`, `AstroFeatureSVM`, forward/backward hooks, 40-bin weight histograms, Grad-CAM saliency, $25\times 25\times 25$ meshgrid evaluator, pre-computed demo replay checkpoints, and 100-frame ring-buffer `WS /api/admin/ws/training`. |

---

### Dev 6 (`E6` — `role:E6-devops`): Platform Scaffold, Benchmark Data Pipeline, Calibration Injector, Admin Triage/Exports & Cloud Deploy Lead
**Exclusive Territory:** `backend/science/injector.py`, `backend/tests/test_science_injector.py`, `web-client/src/admin/{HardNegativeTriage,DataProductExports}.tsx`, `backend/api/export.py`, `backend/tests/test_api_export.py`, `scripts/{build_benchmark_bundle,verify_bundle_security,smoke_test}.py`, `benchmarks/*`, `backend/db/{seed_benchmarks,rls_lockdown}.sql`, `web-client/public/benchmarks/*`, `web-client/public/{_redirects,_headers}`, `Dockerfile`, `start.sh`, `Taskfile.yml`, `.github/workflows/*`  
**Forbidden Territory:** `backend/science/{ingest,wave_match,reproject,centroid,wave,similarity}.py`, `backend/api/{resolve,cutout,auth,classify,forum,spectrum}.py`, `web-client/src/tabs/*`

| Phase | Issue | Exact Job & Target Files |
|---|---|---|
| **Phase 0** | [#4](https://github.com/LawObare/Spectra/issues/4) | **[Scaffold] Initialize `backend/` (`uv` + FastAPI) and `web-client/` (React 18 + Vite 5 + TS) Monorepo**<br>- Files: `backend/pyproject.toml`, `backend/uv.lock`, `backend/main.py` (stub), `web-client/package.json`, `web-client/vite.config.ts`, `web-client/tailwind.config.js`<br>- Scaffold both workspaces and lock all dependencies so `task setup` passes in `<10s`. |
| **Phase 1 (P0)** | [#6](https://github.com/LawObare/Spectra/issues/6) | **[DB Seed] Create 5 NASA Benchmark Seeds at Epoch 2025.5 & Astrometric CI Grounding Check**<br>- Files: `backend/db/seed_benchmarks.sql`, `benchmarks/build.py`<br>- Propagate J2000 coordinates to Epoch 2025.5 ($\Delta\alpha = \mu_\alpha^* \Delta t / \cos\delta_0$), seed `subjects`/`discussion_threads`, and enforce $<1''$ Gaia DR3 astrometric verification in CI. |
| **Phase 1 (P0)** | [#13](https://github.com/LawObare/Spectra/issues/13) | **[Static Cache] Generate Offline Benchmark `.f32` Tensor & JSON Bundles for All 5 NASA Targets**<br>- Files: `scripts/build_benchmark_bundle.py`, `web-client/public/benchmarks/*.{f32,json}`, `backend/cache/benchmarks/*.{f32,json}`<br>- Generate canonical 14 B/px `.f32` binary tensors and `.json` metadata/spectra for Barnard's Star, WISE 0855, Epsilon Indi B, RW Aurigae, and R Draconis. |
| **Phase 3 (P2)** | [#24](https://github.com/LawObare/Spectra/issues/24) | **[Science & Calibration] Synthetic Proper-Motion Source Injector & Calibration Loop**<br>- Files: `backend/science/injector.py`, `backend/tests/test_science_injector.py`<br>- Propagate synthetic mover vectors (`synth_a`, `synth_b`) to exposure epoch $t_k$, convolve template flux with HDU 5 empirical PSF into HDU 1 `IMAGE`, propagate Poisson variance into HDU 3 `VARIANCE`, and tag `source_badge: "Synthetic Injection"`. |
| **Phase 3 (P2)** | [#28](https://github.com/LawObare/Spectra/issues/28) | **[Admin Tabs 4–5 & Export API] `<HardNegativeTriage />` & Community Data Product Exporter**<br>- Files: `web-client/src/admin/{HardNegativeTriage,DataProductExports}.tsx`, `backend/api/export.py`, `backend/tests/test_api_export.py`<br>- Build `/admin/triage` ($|P_{\text{AI}} - P_{\text{Community}}|$ disagreement table + raw HDU 1–6 viewer) and `/admin/exports` (`GET /api/admin/export/{format}` generating `Community Product`-stamped CSV, VOTable, JSON, FITS, and HDF5 bundles). |
| **Phase 4** | [#29](https://github.com/LawObare/Spectra/issues/29) | **[Deploy] Build Single-Stage `uv` Dockerfile, Supabase Lockdown RLS & Dual-Action Keep-Alive Workflows**<br>- Files: `Dockerfile`, `start.sh`, `backend/db/rls_lockdown.sql`, `.github/workflows/{ci,deploy-backend,heartbeat}.yml`<br>- Package `python:3.11-slim-bookworm` container (`--workers 1`, `:7860`), lock down RLS on all 7 tables (zero `anon` policies), and wire CI + 15-min backup keep-alive workflow. |
| **Phase 4** | [#30](https://github.com/LawObare/Spectra/issues/30) | **[Deploy] Configure Cloudflare Pages Edge CDN, Offline Venue Demo Mirror & End-to-End Smoke Test Suite**<br>- Files: `web-client/public/{_redirects,_headers}`, `scripts/verify_bundle_security.py`, `scripts/smoke_test.py`<br>- Configure CDN edge caching, verify zero DB keys in compiled JS bundle, and run E2E smoke tests across live and offline modes. |
