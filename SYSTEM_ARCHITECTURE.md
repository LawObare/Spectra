# Spectra: Systems Architecture & Design Document (SDD)
**SPHEREx Spectral Explorers Platform**  
**Document Version:** `1.0.0-PROD` (Aligned with `SPECIFICATION.md` v3.0.0-PROD)  
**Status:** Authoritative Architectural Blueprint & System Design Specification  
**Classification:** Open-Source Scientific Citizen Discovery Infrastructure  

---

## 1. Overview & Scope

### 1.1 Executive Summary
**Spectra (SPHEREx Spectral Explorers)** is an institutional-grade citizen science discovery platform and scientific visualization engine tailored to NASA's SPHEREx (*Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer*) mission. SPHEREx conducts an all-sky spectral survey across 102 near-infrared bands ($0.75-5.00\,\mu\text{m}$) using six Hawaii-2RG detector arrays equipped with Linear Variable Filters (LVF).

Spectra bridges raw Level 2 Multi-Extension FITS (MEF) archive products from the NASA/IPAC Infrared Science Archive (IRSA) to citizen scientists, professional astronomers, and machine learning evaluators. It enables interactive time-domain blinking, wavelength-matched image differencing, smile-corrected hyperspectral cube extraction, biogenic ice optical depth modeling, and real-time active-learning candidate classification.

```
+----------------------------------------------------------------------------------------------------+
|                                    SPECTRA PLATFORM SCOPE                                          |
|                                                                                                    |
|  [Citizen Science Suite: /explore]                 [Mission Control Suite: /admin]                |
|  - Tab 1: Celestial Navigator (Aladin Lite v3)    - Tab 1: Training Dynamics & Loss Studio        |
|  - Tab 2: Time-Domain Comparator (WebGL2 Float32) - Tab 2: Parameter Updates & Weight Ridgelines  |
|  - Tab 3: Spectrophotometric Lab (102 Channels)   - Tab 3: 3D Decision Boundary Animator          |
|  - Tab 4: Point-Source Ice Studio (SPLICES)       - Tab 4: Disagreement Triage & Hard Negatives   |
|  - Tab 5: Observation Forum & Candidate Feed      - Tab 5: Community Data Product Exporters       |
|                                                                                                    |
|  [Unified Science Engine: FastAPI :7860] <======> [Persistent Relational Ledger: Supabase Postgres]|
+----------------------------------------------------------------------------------------------------+
```

### 1.2 System Objectives & Problem Statement
1. **The SPHEREx Data Challenge:** Each SPHEREx pointing generates a 2040×2040 pixel Level 2 MEF file comprising six distinct Header Data Units (IMAGE, FLAGS, VARIANCE, ZODI, PSF, WCS-WAVE), totaling ~16 MB per exposure. Across 102 channels and multiple sky passes, transferring raw FITS to client browsers is prohibitive.
2. **The Time-Domain False Positive Trap:** In conventional surveys, differencing is computed across time irrespective of detector wavelength. Because SPHEREx uses Linear Variable Filters, different exposures place different wavelengths on the same sky pixel. Differencing mismatched wavelengths produces severe false-positive dipoles. Spectra enforces **adaptive wavelength-matched differencing**.
3. **The Zero-Auth Evaluator Mandate:** Evaluators and hackathon judges will not navigate registration walls or solve CAPTCHAs. Spectra guarantees **instant zero-auth access** while maintaining volunteer cryptographic attribution via client-side key generation (`spx_observer_id` + `spx_observer_key`).
4. **The $0 Always-Warm Operational Target:** Spectra runs indefinitely on free-tier infrastructure (Hugging Face Spaces + Cloudflare Pages + Supabase Cloud) without cold-start failures, database pause timeouts, or memory crashes.

### 1.3 Project Scope & Deliverables
- **Core Public Workspace (`/explore`):** 5-tab responsive web application providing celestial navigation, multi-epoch blinking, 102-band spectral plotting, ice column density integration, and collaborative discussion.
- **Mission Control Suite (`/admin`):** Token-gated ML observability portal visualizing real-time training dynamics, weight ridgelines, 3D decision boundaries, and candidate triage.
- **Unified Backend Mission Engine (`backend/`):** FastAPI application executing WCS reprojection, smile inversion, PSF centroiding, in-memory cosine similarity, and bounded task queuing.
- **Pre-Baked Benchmark Ground Truth:** Instant $<10\,\text{ms}$ loading for the 5 mandatory NASA benchmark systems (Barnard's Star, WISE 0855-0714, Epsilon Indi B, RW Aurigae, R Draconis).
- **Export Engine:** One-click generation of community data products (CSV, VOTable, JSON, FITS) and PyTorch HDF5 training datasets.

### 1.4 Sequential Priority-Gated Implementation Roadmap & Strict Cut Order
To prevent engineering sprawl and guarantee that the hackathon challenge prompt is 100% satisfied on Day 1, implementation proceeds in **four strictly sequential, priority-gated phases** preceded by mandatory Day-0 spikes:

| Phase | Priority | Scope & Milestone Gate | Rule for Engineers & Agents |
|---|---|---|---|
| **Day-0 Spikes** | **Gating** | **Feasibility & Ground-Truth Verification:** S1 (IRSA collection & parameter resolution), S2 (Benchmark exposure coverage matrices & saturation check), S3 (IRSA Cutout API vs S3 byte-range latency benchmark). | Complete before locking final network drivers. |
| **Phase 1** | **P0 (Must-Have)** | **Core NASA Challenge Foundation:** Tab 1 (Navigator/Aladin Lite v3 dome with MOC), Tab 2 (Time-Domain Comparator/WebGL2 Float32 multi-epoch player, Asinh stretch, wavelength-matched difference mode, coverage matrix), 5 NASA Benchmark Targets, universal coordinate input, single FastAPI backend (`uv`) on port 7860, local Supabase DB. | **FOCUS HERE FIRST.** Delivers 100% prompt compliance. Do not build Tab 3, Tab 4, or Admin tabs until Phase 1 passes Gate 1. |
| **Phase 2** | **P1 (Differentiator)** | **Science & Community Intelligence:** HDU 6 `WCS-WAVE` 102-channel spectral extraction, in-memory NumPy cosine similarity (<20 ms), Tab 3 (Spectrophotometric Lab with uPlot), Tab 5 (Discussions with backend SSE stream). | Start ONLY after Phase 1 is fully tested and verified against the 5 NASA benchmark targets. |
| **Phase 3** | **P2 (Polish)** | **Institutional Polish & Mission Control:** Tab 4 (Molecular & Ice Studio on point sources with verified lab A-values), Admin Mission Control Tabs 1–5 (`/admin`, read-only default), synthetic injection calibration loop. | Start ONLY after Phase 2 is verified. |
| **Phase 4** | **Deploy** | **Production Deployment & Hardening:** Hugging Face Space Dockerfile (single service, port 7860), Cloudflare Pages CDN, Supabase Session Pooler RLS, cron-job keep-alive, offline venue demo mirror. | Final packaging & judging freeze. |

#### Strict Cut Order if Time Runs Short:
```
P3 Model Lab -> Tab 4 Molecular Studio -> Admin triage -> Tab 5 forum polish -> Tab 3 template overlays. NEVER CUT P0.
```
On completion of each phase, the system reaches a 100% self-contained, testable, and demonstrable milestone before work begins on the next phase.

### 1.5 Stakeholders & Evaluator Personas
- **Citizen Scientist / Volunteer:** Explores sky cutouts, toggles difference modes, classifies transient/mover anomalies, and participates in discussion threads.
- **Professional Astronomer / Science Team:** Inspects smile-corrected 102-channel spectra, verifies high-proper-motion candidates, fits stellar continua, and exports VOTables.
- **Hackathon Evaluator / Judge:** Evaluates application performance, tests benchmark targets, assesses responsive design, and inspects architectural rigor under zero-auth conditions.
- **Mission Operator / Admin:** Observes active-learning classifier convergence, inspects hard-negative triage queues, and manages archive data pipelines.

---

## 2. Requirements & Constraints

### 2.1 Functional Requirements (FR)

| ID | Requirement | Description |
|---|---|---|
| **FR-01** | **Universal Coordinate & Target Resolution** | Accept arbitrary RA/Dec coordinates (decimal degrees, sexagesimal) or common astronomical target names (via in-memory map or CDS Sesame resolver with 2.0s circuit breaker). |
| **FR-02** | **5 NASA Benchmark Verification** | Pre-embed and correctly resolve the 5 NASA benchmark targets (Barnard's Star, WISE 0855, Epsilon Indi B, RW Aurigae, R Draconis) with Gaia DR3 proper motions propagated to epoch 2025.5. |
| **FR-03** | **Wavelength-Matched Image Differencing** | Restrict difference subtraction ($I_{\text{epoch } N} - I_{\text{epoch } 0}$) strictly to exposures matching within the band's resolving-power wavelength window $[\lambda_0(1-w), \lambda_0(1+w)]$. |
| **FR-04** | **Zero-Copy Float32 WebGL2 Streaming** | Stream raw IEEE-754 32-bit float buffers (`application/octet-stream`) directly to WebGL2 `gl.R32F` textures for GPU-accelerated Asinh stretching and signed differencing. |
| **FR-05** | **HDU 6 WCS-WAVE Spectral Extraction** | Query tabular 2D wavelength grids in HDU 6, invert spatial smile across exposures, and extract forced point-source PSF photometry in Janskys across all 102 channels. |
| **FR-06** | **Point-Source Ice Column Density Lab** | Fit 4th-order Chebyshev continua to SPLICES background stars and integrate optical depths across verified laboratory $A$-values ($\text{H}_2\text{O}$, $\text{CO}_2$, $^{13}\text{CO}_2$, $\text{CO}$, $\text{CH}_3\text{OH}$). |
| **FR-07** | **Zero-Auth Cryptographic Attribution** | Generate client-side UUIDv4 and secret 32-byte keys; verify via `sha256(key)` on the backend without passwords or modal login barriers. |
| **FR-08** | **Active-Learning Consensus Engine** | Recompute Bayesian volunteer reliability weights $w_u$, class consensus $P(c\|s)$, and Shannon entropy $H(s)$ upon classification submission. |

### 2.2 Non-Functional Requirements (NFR)

| Category | ID | Requirement & Metric |
|---|---|---|
| **Performance** | **NFR-01** | **Pre-Cached Target Latency:** Benchmark targets (cutouts, spectra, light curves) must load and render in $<15\,\text{ms}$. |
| **Performance** | **NFR-02** | **Vector Search Throughput:** In-memory NumPy cosine similarity must evaluate 10,000 102-channel spectra in $<20\,\text{ms}$. |
| **Rendering** | **NFR-03** | **Interactive Framerate:** WebGL2 multi-epoch player and Canvas 2D `uPlot` spectral visualizer must maintain a locked 60 FPS without garbage-collection drops. |
| **Scalability** | **NFR-04** | **Bounded Concurrency:** The cutout pipeline must manage concurrent evaluator traffic via `asyncio.Queue(maxsize=5)` without exceeding 4.0 GB process memory. |
| **Reliability** | **NFR-05** | **Offline Venue Resilience:** In the event of venue Wi-Fi failure, all benchmark targets, WebGL2 shaders, and 3D boundary visualizations must run 100% locally from static fallbacks. |
| **Availability** | **NFR-06** | **$0 Tier Always-Warm Guarantee:** Database pause timers (7 days) must be continuously reset via automated 5-minute health pings hitting PostgreSQL. |

### 2.3 Technical & Platform Constraints

```
+---------------------------------------------------------------------------------------------------+
|                                   PLATFORM RESOURCE BOUNDARIES                                    |
|                                                                                                   |
|  [Hugging Face Spaces: cpu-basic]             [Supabase Managed Cloud: Free Tier]                 |
|  - 2 vCPU (Intel Xeon / AMD EPYC)            - 500 MB PostgreSQL Database Limit                  |
|  - 16 GB Host RAM (Max 4.0 GB for Spectra)   - Session Pooler: 15 concurrent IPv4 connections    |
|  - Single Container Port: 7860               - Auto-pause after 7 days of inactivity             |
|  - Ephemeral Disk (Wiped on restart)         - Zero direct browser PostgREST access              |
|                                                                                                   |
|  [Cloudflare Pages CDN]                      [External Archive Constraints]                      |
|  - Static asset distribution                 - IRSA SIA2 latency: 4 - 15 s per cold query        |
|  - 25 MB max individual file size            - External VO endpoints (Sesame, SkyBot): flaky     |
+---------------------------------------------------------------------------------------------------+
```

- **Hugging Face Spaces Constraints:** Container exposes strictly **one public port (`7860`)**. Running multi-container or multi-process loopback bridges (such as Go gateway + Python worker) introduces unnecessary IPC failure points and duplicates memory.
- **Supabase Free Tier Constraints:** Database capacity is capped at 500 MB. Storing full-sky FITS files or unbounded million-vector `pgvector` indexes inside Postgres would exhaust quotas immediately. Cutouts remain in ephemeral caches; Postgres stores strictly structured metadata, classifications, and forum threads.
- **Zero-Auth Security Constraints:** Evaluators cannot be challenged with login walls. However, write endpoints must be shielded against spam and database pollution via cryptographic key hashes, rate limiting (60 writes/min), and strict administrative route separation.

### 2.4 Scientific & Astrophysical Ground Truth & Constraints

#### 2.4.1 Mission Archive Level 2 FITS Extension Standard
Every SPHEREx Level 2 Quick Release image file delivered by Caltech/IPAC IRSA (configurable via `IRSA_COLLECTION`, default `spherex_qr2`) is a Multi-Extension FITS (MEF) containing 6 Header Data Units:

| HDU # | Extension Name | Data Type | Physical Meaning & Calibration Units |
|---|---|---|---|
| **HDU 1** | `IMAGE` | 32-bit float | Calibrated surface brightness flux in $\text{MJy/sr}$ ($2040 \times 2040$ pixels). |
| **HDU 2** | `FLAGS` | 32-bit integer | Bitmask quality flags (bit 0=transient, bit 1=overflow, etc.). |
| **HDU 3** | `VARIANCE` | 32-bit float | Pixel noise variance $(\text{MJy/sr})^2$ (read noise + photon Poisson noise). |
| **HDU 4** | `ZODI` | 32-bit float | Modeled solar system zodiacal dust emission background ($\text{MJy/sr}$). |
| **HDU 5** | `PSF` | 32-bit float cube | 3D local Point Spread Function empirical model. |
| **HDU 6** | `WCS-WAVE` | Binary Table | Tabular FITS WCS (`WAVE-TAB`) mapping $(x, y) \to (\lambda, \Delta\lambda)$. |

- **Optical & Geometry:** Native pixel scale is $\approx 6.2''/\text{pixel}$. File naming token `2D3` corresponds to detector 3.
- **Surface Brightness to Jansky Conversion:**
  $$F_\nu [\text{Jy}] = I_\nu [\text{MJy/sr}] \times 10^6 \times \Omega_{\text{px}} [\text{sr}], \quad \Omega_{\text{px}} = \left(6.2'' \times \frac{\pi}{180 \times 3600}\right)^2 \approx 9.023 \times 10^{-10}\,\text{sr}$$

#### 2.4.2 SPHEREx HDU 2 (`FLAGS`) 32-Bit Bitmask Hierarchy
The 32-bit unsigned integer plane (`uint32`) encodes per-pixel instrumental quality flags:

| Bit Position | Bit Value ($2^N$) | Flag Identifier | Physical Meaning & Pipeline Action | Overlay Rendering Rule |
|---|---|---|---|---|
| **Bit 0** | $1$ | `TRANSIENT` | Cosmic ray hit or sudden single-read glitch during SUR processing. | Excluded from coadd; rendered with red slash hatch. |
| **Bit 1** | $2$ | `OVERFLOW` | Detector well saturation ($>85\%$ full well capacity). | Excluded from coadd; marked with gold `[Saturated]` pill. |
| **Bit 2** | $4$ | `SUR_ERROR` | Onboard fit failure during Sample-Up-The-Ramp regression. | Excluded from coadd. |
| **Bit 4** | $16$ | `PHANTOM` | Interleaved non-physical readout test channels. | Masked out as invalid science pixels. |
| **Bit 5** | $32$ | `REFERENCE` | Non-illuminated reference border pixels (outer 4 rows/columns). | Rendered in neutral grey border overlay. |
| **Bit 6** | $64$ | `NONFUNC` | Factory non-functional, dead, or disconnected pixels. | Excluded from coadd; interpolated in fallback view. |
| **Bit 7** | $128$ | `DICHROIC` | Optical boundary zone where beam splitter transmission drops below $50\%$. | Flagged with yellow optical warning indicator. |
| **Bit 9** | $512$ | `MISSING_DATA` | Telemetry loss or frame drop. | Excluded from coadd; flagged as no data. |
| **Bit 10** | $1024$ | `HOT` | Excess dark current ($>5\sigma$ above array mean). | Excluded from coadd. |
| **Bit 11** | $2048$ | `COLD` | Low quantum efficiency ($<20\%$ nominal). | Downweighted in inverse-variance coaddition. |
| **Bit 17** | $131072$ | `PERSISTENCE` | Residual latent charge trapped from previous exposure bright star. | Rendered with orange warning border. |
| **Bit 22** | $4194304$ | `GHOST` | Internal optical reflection or bright star glint artifact. | Flagged with purple diamond marker. |

#### 2.4.3 Ground-Truth NASA Benchmark Systems (Epoch 2025.5 Grounding)
All coordinates are propagated from J2000.0 ($t_0 = 2000.0$) to the SPHEREx mission midpoint ($t = 2025.5$, $\Delta t = 25.5\,\text{years}$) using the standard spherical motion formulas:
$$\alpha(t) = \alpha_0 + \frac{\mu_\alpha^*}{\cos \delta_0} \cdot \Delta t \quad \text{where} \quad \mu_\alpha^* \equiv \mu_\alpha \cos \delta_0, \quad \delta(t) = \delta_0 + \mu_\delta \cdot \Delta t$$

| Target Name | Object Class & Astrometric Motion | J2000 Coordinates (ICRS) | Proper Motion ($\text{mas/yr}$) | Epoch 2025.5 Propagated Coordinates | Physical Notes & Detection Constraints |
|---|---|---|---|---|---|
| **Barnard's Star** | M4V Red Dwarf<br>$\mu = 10.39''/\text{yr} = 1.68\,\text{px/yr}$ along PA 355.6° | `17h 57m 48.50s, +04d 41m 36.1s`<br>($269.45208^\circ, +4.69336^\circ$) | $\mu_\alpha^* = -801.60$<br>$\mu_\delta = +10362.40$ | `17h 57m 47.13s, +04d 46m 00.3s`<br>($269.44639^\circ, +4.76676^\circ$) | Bright in NIR; detector well saturation (`OVERFLOW`) handling required. UI overlays predicted track if saturated. |
| **WISE 0855-0714** | Y4 Sub-Brown Dwarf ($T_{\text{eff}} \sim 250\,\text{K}$)<br>$\mu = 8.15''/\text{yr} = 1.31\,\text{px/yr}$ along PA 274.7° | `08h 55m 10.83s, -07d 14m 42.5s`<br>($133.79513^\circ, -7.24515^\circ$) | $\mu_\alpha^* = -8123.70$<br>$\mu_\delta = +673.20$ | `08h 54m 56.91s, -07d 14m 25.4s`<br>($133.73712^\circ, -7.24038^\circ$) | Faint $<3.5\,\mu\text{m}$; detected in D5/D6 coadds or honest non-detection. Warning: Confirm epoch of catalogue position (uncorrected epoch shifts center up to 100″!). |
| **Epsilon Indi B** | T1 + T6 Brown Dwarf Binary (sep $\sim 0.7''$)<br>$\mu = 4.68''/\text{yr} = 0.76\,\text{px/yr}$ along PA 121.8° | `22h 04m 10.60s, -56d 46m 58.2s`<br>($331.04415^\circ, -56.78284^\circ$) | $\mu_\alpha^* = +3982.00$<br>$\mu_\delta = -2466.80$ | `22h 04m 22.96s, -56d 48m 01.1s`<br>($331.09566^\circ, -56.80031^\circ$) | $1/\cos\delta$ factor applied ($\Delta\alpha = \mu_\alpha^* \Delta t / \cos\delta$), eliminating 46″ error. Unresolved binary within single $6.2''$ pixel; 2-component unmixing is illustrative. |
| **RW Aurigae** | Classical T Tauri Star with Protoplanetary Disk<br>$\mu = 0.02''/\text{yr}$ (Stationary) | `05h 07m 49.55s, +30d 24m 05.2s`<br>($76.95646^\circ, +30.40144^\circ$) | $\mu_\alpha^* = +1.40$<br>$\mu_\delta = -20.60$ | `05h 07m 49.55s, +30d 24m 04.7s`<br>($76.95647^\circ, +30.40130^\circ$) | Circumstellar dust occultations producing $>1.5\,\text{mag}$ dimming. Report whatever light curve and optical/NIR flux levels are measured per band with errors. |
| **R Draconis** | Mira-type Pulsating AGB Variable ($P = 245\,\text{d}$)<br>$\mu = 0.012''/\text{yr}$ (Stationary) | `16h 32m 40.23s, +66d 45m 17.9s`<br>($248.16763^\circ, +66.75497^\circ$) | $\mu_\alpha^* = +6.10$<br>$\mu_\delta = +9.80$ | `16h 32m 40.26s, +66d 45m 18.1s`<br>($248.16773^\circ, +66.75504^\circ$) | Great-circle angular separation to North Ecliptic Pole (NEP) is $8.61^\circ$. Stationary pulsing monopole; spectrum points colored by MJD to show non-simultaneity. |

#### 2.4.4 Continuous Integration (CI) Coordinate Grounding Check
The verification script `benchmarks/build.py` automatically pulls Gaia DR3 and SIMBAD astrometric coordinates at build time. The CI test suite strictly fails if any recomputed benchmark center differs from the ground-truth values in the table above by more than $1''$ ($0.16\,\text{pixel}$). Proper motion values are dynamically refreshed from Gaia DR3 to ensure zero drift.

#### 2.4.5 Detector Super-Bands & Laboratory Molecular Band Strengths ($A$-Values)
The 102 channels are physically dispersed across six Hawaii-2RG detector arrays with Linear Variable Filters:

| Super-Band | Detector Array | Wavelength Range | Resolving Power | Primary Molecular Diagnostic Features |
|---|---|---|---|---|
| **Band D1** | Array 1 | $0.75 - 1.11\,\mu\text{m}$ | $R = 35 - 41$ | Paschen series hydrogen lines, stellar photospheres |
| **Band D2** | Array 2 | $1.11 - 1.63\,\mu\text{m}$ | $R = 41 - 50$ | Warm brown dwarf $\text{H}_2\text{O}$ steam, $1.6\,\mu\text{m}$ galaxy H-bump |
| **Band D3** | Array 3 | $1.63 - 2.42\,\mu\text{m}$ | $R = 50 - 64$ | Stellar CO overtone ($2.3\,\mu\text{m}$), Brackett-$\gamma$ ($2.16\,\mu\text{m}$) |
| **Band D4** | Array 4 | $2.42 - 3.82\,\mu\text{m}$ | $R = 64 - 96$ | $\text{H}_2\text{O}$ ice ($3.05\,\mu\text{m}$), $\text{CH}_4$ ($3.32\,\mu\text{m}$), $\text{CH}_3\text{OH}$ ($3.53\,\mu\text{m}$), PAH |
| **Band D5** | Array 5 | $3.82 - 4.42\,\mu\text{m}$ | $R = 96 - 118$ | $\text{CO}_2$ ice ($4.27\,\mu\text{m}$), $^{13}\text{CO}_2$ ice ($4.38\,\mu\text{m}$), Cold Y-dwarfs |
| **Band D6** | Array 6 | $4.42 - 5.00\,\mu\text{m}$ | $R = 118 - 130$ | CO gas/ice ($4.67\,\mu\text{m}$), Pf-$\beta$, Asteroid thermal emission |

**Laboratory Integrated Band Strengths ($A$-Values):**
In Tab 4 (Point-Source Ice Studio), column densities are integrated strictly for point-source background stars (seeded from the SPLICES catalog) using literature-verified laboratory band strengths:

| Wavelength Window | Ice Component / Feature | Vibrational Mode | Literature $A$-value ($\text{cm}\cdot\text{molecule}^{-1}$) | Primary Citation |
|---|---|---|---|---|
| $3.05\,\mu\text{m}$ (Band 2/3) | Water Ice ($\text{H}_2\text{O}$) | O–H stretch | $2.0 \times 10^{-16}$ | Gerakines et al. (1995) |
| $4.27\,\mu\text{m}$ (Band 5) | Carbon Dioxide ($\text{CO}_2$) | C=O asymmetric stretch ($\nu_3$) | $7.6 \times 10^{-17}$ | Gerakines et al. (1995) |
| $4.38\,\mu\text{m}$ (Band 5) | Carbon Dioxide ($^{13}\text{CO}_2$) | $^{13}\text{C=O}$ stretch | $7.8 \times 10^{-17}$ | Boogert et al. (2000) |
| $4.67\,\mu\text{m}$ (Band 6) | Carbon Monoxide ($\text{CO}$) | C$\equiv$O stretch | $1.1 \times 10^{-17}$ | Jiang et al. (1975) |
| $3.54\,\mu\text{m}$ (Band 3) | Methanol ($\text{CH}_3\text{OH}$) | C–H stretch | $5.3 \times 10^{-18}$ | Kerkhof et al. (1999) |

*(Note: Cold brown-dwarf gaseous methane ($\text{CH}_4$) absorption at $3.32\,\mu\text{m}$ is a photospheric gas feature, not an interstellar ice feature; solid ice $A$-values are never applied to brown-dwarf photospheres).*

#### 2.4.6 Optical Smile, Reprojection & Source Honesty Principles
1. **Linear Variable Filter Smile Inversion:** SPHEREx employs Linear Variable Filters where transmitted central wavelength varies continuously along the detector dispersion axis:
   $$\lambda(x, y) = \lambda_0 + \alpha x + \beta y + \gamma x^2 + \dots$$
   Interpolation must evaluate HDU 6 (`WCS-WAVE`) at native detector coordinates $(x_{\text{det}}, y_{\text{det}})$.
2. **Proper Motion Coordinate Propagation:** Proper motions $\mu_\alpha^* \equiv \mu_\alpha \cos\delta$ and $\mu_\delta$ must be propagated rigorously to epoch 2025.5:
   $$\alpha(t) = \alpha_0 + \frac{\mu_\alpha^*}{\cos \delta_0} \cdot \Delta t, \quad \delta(t) = \delta_0 + \mu_\delta \cdot \Delta t$$
   Double-counting $\cos\delta$ is physically invalid and strictly forbidden.
3. **Flux-Conserving Reprojection:** Display products must use `reproject_exact` (spherical polygon surface area overlap). Non-conservative interpolation (`reproject_interp`) distorts flux across undersampled $6.2''/\text{pixel}$ plates.
4. **Data Honesty Badges:** Every visual product must display its verifiable institutional source badge (`[NASA Benchmark (Pre-cached)]`, `[IRSA Live (<collection>)]`, or `[Synthetic Injection Mode]`).

---

## 3. System Architecture & Views (The 4+1 View Model)

```mermaid
flowchart TD
    subgraph View1["Logical View (Domain Logic)"]
        WCS_Engine["WCS Reprojection & Alignment"]
        Spectral_Engine["HDU 6 WAVE Smile Inversion"]
        Consensus_Engine["Bayesian Reliability & Shannon Entropy"]
        Shader_Engine["WebGL2 Float32 Dynamic Asinh"]
    end

    subgraph View2["Process View (Concurrency & Streaming)"]
        Async_Queue["Bounded asyncio.Queue (Depth 5)"]
        SSE_Stream["FastAPI SSE (/api/cutout/progress)"]
        Forum_SSE["FastAPI SSE (/api/forum/stream)"]
        WS_Telemetry["FastAPI WebSocket (/api/admin/ws/training)"]
    end

    subgraph View3["Development View (Package Organization)"]
        Frontend_Repo["web-client/ (React 18 + Vite + TS)"]
        Backend_Repo["backend/ (Python 3.11 + uv + FastAPI)"]
        DB_Migrations["backend/db/schema.sql + queries.py"]
    end

    subgraph View4["Physical View (Deployment Topology)"]
        CF_Pages["Cloudflare Pages CDN (:443)"]
        HF_Space["Hugging Face Spaces Container (:7860)"]
        Supa_Cloud["Supabase PostgreSQL 16 (:5432)"]
    end

    View1 --> View2
    View2 --> View3
    View3 --> View4
```

### 3.1 Macro Architecture & Style
Spectra adopts a **Layered, Event-Driven, Client-Server Architecture** optimized for high-throughput scientific streaming and zero-friction client interaction. 
- **Decoupled Edge Client:** A high-frequency Single Page Application (SPA) compiled to static WebAssembly/JS and hosted globally on Cloudflare Pages.
- **Unified Mission Engine:** A single asynchronous FastAPI service executing compute-intensive image reprojection, spectral extraction, and ledger operations.
- **Relational Persistence Ledger:** A cloud-hosted PostgreSQL 16 database accessed via direct asynchronous connection pooling (`asyncpg`).
- **Reactive Streaming Fabric:** Server-Sent Events (SSE) for task progress and forum updates; WebSockets for administrative ML training telemetry.

### 3.2 Logical View
The Logical View models domain packages and their functional collaborations:
- **`AstroDomain`:** Represents coordinate entities (`SkyCoord`), survey epochs (`ObservationEpoch`), detector geometries (`DetectorBand` D1–D6), and Level 2 MEF containers.
- **`ReprojectionDomain`:** Synthesizes master North-Up WCS tangent planes ($6.2''/\text{px}$) and coordinates spherical polygon overlaps (`reproject_exact`).
- **`PhotometryDomain`:** Fits empirical PSF cubes from HDU 5, computes background subtraction, and converts surface brightness ($\text{MJy/sr}$) to Janskys ($\text{Jy}$).
- **`ConsensusDomain`:** Tracks volunteer reliability weights $w_u$, computes class probability vectors $P(c|s)$, and ranks anomalousness via Shannon entropy $H(s)$.

```mermaid
classDiagram
    class SkySubject {
        +String subject_id
        +Double ra
        +Double dec
        +Float32[] spectrum_array
        +String recommended_tab
        +Boolean is_calibration
        +Double shannon_entropy
        +Double consensus_score
    }

    class ObserverSession {
        +UUID observer_id
        +String key_hash
        +String handle
        +Double reliability_weight
        +Int total_classifications
    }

    class Classification {
        +BigInt id
        +String subject_id
        +UUID observer_id
        +String primary_class
        +JSONB feature_tags
        +Double confidence
        +Double weight_snapshot
    }

    class DiscussionThread {
        +BigInt thread_id
        +String subject_id
        +UUID author_id
        +String channel
        +String title
        +String state_query
        +Boolean moderator_verified
    }

    SkySubject "1" <-- "*" Classification : classifies
    ObserverSession "1" <-- "*" Classification : submits
    SkySubject "1" <-- "*" DiscussionThread : references
    ObserverSession "1" <-- "*" DiscussionThread : authors
```

### 3.3 Process View
The Process View details thread execution, asynchronous loops, and non-blocking IPC:
- **FastAPI Event Loop (`uvicorn`):** Single-threaded asynchronous execution handling HTTP, SSE, and WebSocket events.
- **Bounded Cutout Pipeline Queue:** Incoming requests are received by `POST /api/cutout`. If an intensive reprojection is already in progress, tasks enter `asyncio.Queue(maxsize=5)`:
  - If queue size $< 5$, returns `HTTP 202 Accepted` with queue position.
  - If queue size $\ge 5$, returns `HTTP 503 Service Unavailable` with `Retry-After: 15`.
- **Worker Thread Execution:** Heavy CPU tasks (spherical polygon clipping in `reproject_exact` and forced PSF fitting) execute in an asynchronous thread pool (`asyncio.to_thread`), preventing event-loop starvation.
- **Keep-Alive Worker Task:** A recurring background coroutine resets the Supabase database pause timer and verifies IRSA connectivity.

```mermaid
sequenceDiagram
    autonumber
    actor Judge as Evaluator / Citizen Browser
    participant API as FastAPI Router (:7860)
    participant Q as Bounded Queue (maxsize=5)
    participant Worker as Scientific Compute Thread
    participant IRSA as IRSA / AWS S3 Archive
    participant SSE as SSE Progress Stream

    Judge->>API: POST /api/cutout {ra, dec, fov, cadence}
    API->>Q: Check queue capacity
    alt Queue Capacity Available (N < 5)
        Q-->>API: Enqueued (Position = N)
        API-->>Judge: 202 Accepted {task_id, queue_position}
        Judge->>SSE: GET /api/cutout/progress/{task_id}
        SSE-->>Judge: event: queued {position: N, wait_s: N*8}
        Q->>Worker: Dequeue task
        SSE-->>Judge: event: progress {stage: "fetching", pct: 0.25}
        Worker->>IRSA: Fetch Level 2 MEF (Cutout / S3 fallback)
        IRSA-->>Worker: Return MEF HDUs 1, 2, 3, 5, 6
        SSE-->>Judge: event: progress {stage: "reprojecting", pct: 0.75}
        Worker->>Worker: reproject_exact + WCS smile inversion
        Worker->>Worker: Cache Float32Array in LRU Cache
        SSE-->>Judge: event: complete {tensor_url: "/api/cutout/{id}/tensor"}
        Judge->>API: GET /api/cutout/{id}/tensor
        API-->>Judge: 200 OK (application/octet-stream, raw Float32)
    else Queue Saturated (N >= 5)
        API-->>Judge: 503 Service Unavailable (Retry-After: 15)
    end
```

### 3.4 Development View
The Development View organizes project source modules, compilation pipelines, and build targets:
```
Spectra/
├── backend/                       # Python 3.11+ Unified Mission Engine
│   ├── main.py                    # FastAPI application & CORS middleware
│   ├── pyproject.toml             # uv package manifest & CPU PyTorch locks
│   ├── uv.lock                    # Deterministic binary wheel hashes
│   ├── api/                       # API Routers
│   │   ├── cutout.py              # Cutout task queue & tensor streaming
│   │   ├── spectrum.py            # WCS-WAVE extraction & photometry
│   │   ├── subjects.py            # Active-learning queue & benchmarks
│   │   ├── classify.py            # Classification & consensus math
│   │   ├── forum.py               # Discussions & SSE broadcasting
│   │   └── admin.py               # ML telemetry & model observables
│   ├── science/                   # Scientific Processing Pipeline
│   │   ├── ingest.py              # IRSA SIA2 & Cutout MEF ingestion
│   │   ├── reproject.py           # reproject_exact North-Up tangent engine
│   │   ├── wave.py                # HDU 6 smile inversion & bandpass solver
│   │   ├── centroid.py            # Native per-exposure PSF centroid fitter
│   │   ├── similarity.py          # Vectorized in-memory NumPy cosine similarity
│   │   └── injector.py            # Synthetic proper-motion source injector
│   ├── ml/                        # Real Machine Learning & Telemetry Engine
│   │   ├── models.py              # DipoleConvNet3D, SpectralResNet102, AstroFeatureSVM
│   │   ├── trainer.py             # PyTorch training loop (150ms epoch cadence, AdamW, CosineAnnealing)
│   │   ├── telemetry.py           # Forward/backward instrumentation hooks, 40-bin histogram downsamplers
│   │   ├── meshgrid.py            # 25x25x25 3D decision boundary grid evaluator
│   │   ├── dataset.py             # PyTorch Dataset combining 30 benchmarks + citizen classifications
│   │   ├── export.py              # HDF5 dataset exporter & PyTorch weights serialization
│   │   └── weights/               # Pre-trained baseline weights (.pt) for instant 60 FPS demo playback
│   │       ├── dipole_convnet_3d.pt
│   │       ├── spectral_resnet_102.pt
│   │       └── feature_svm.pkl
│   ├── db/                        # Database Access Layer
│   │   ├── schema.sql             # PostgreSQL DDL migrations
│   │   ├── seed_benchmarks.sql    # 5 NASA benchmark target seeds
│   │   └── queries.py             # Type-safe asyncpg query implementations
│   └── cache/                     # Pre-computed benchmark tensors
├── web-client/                    # React 18 + Vite 5 + TypeScript SPA
│   ├── src/
│   │   ├── components/            # UI Components & Global Command Header
│   │   ├── tabs/                  # Public Citizen Science Workspaces (/explore)
│   │   │   ├── CelestialNav.tsx   # Tab 1: Aladin Lite v3 WebGL2 dome
│   │   │   ├── Comparator.tsx     # Tab 2: WebGL2 Float32 difference player
│   │   │   ├── SpectroLab.tsx     # Tab 3: 102-channel uPlot visualizer
│   │   │   ├── IceStudio.tsx      # Tab 4: SPLICES point-source ice lab
│   │   │   └── Discussions.tsx    # Tab 5: Real-time forum & feed
│   │   ├── admin/                 # Hidden Mission Control & ML Observability Suite (/admin)
│   │   │   ├── AdminLayout.tsx    # Navigation chrome & token authorization barrier
│   │   │   ├── TrainingDynamics.tsx   # Tab 1: Scalar loss & learning curves (uPlot)
│   │   │   ├── ActivationInspector.tsx # Tab 2: 3D ridgeline weight histograms & feature maps
│   │   │   ├── DecisionBoundaries.tsx  # Tab 3: Dynamic 3D decision boundary animator (Plotly WebGL)
│   │   │   ├── HardNegativeTriage.tsx  # Tab 4: Disagreement triage queue (|P_AI - P_Human|)
│   │   │   ├── DataProductExports.tsx  # Tab 5: 1-click community data product exporter
│   │   │   └── hooks/
│   │   │       └── useAdminTelemetry.ts # WebSocket hook & 50-frame ring-buffer state
│   │   ├── shaders/               # WebGL2 GLSL Shaders
│   │   │   ├── float32_stretch.vert
│   │   │   └── float32_stretch.frag # Asinh & signed difference math
│   │   ├── store/                 # Zustand central telemetry store
│   │   └── types/                 # TypeScript OpenAPI definitions
│   └── public/                    # Static assets & benchmark fallbacks
├── Dockerfile                     # Single-stage uv Python 3.11 container
├── start.sh                       # Process entrypoint
└── Taskfile.yml                   # Unified local developer task orchestration
```

### 3.5 Physical & Deployment View
The Physical View describes production hosting, network routes, TLS endpoints, and hardware boundaries:

```mermaid
flowchart LR
    User["Evaluator Browser"] -->|HTTPS :443| CDN["Cloudflare Pages CDN\n(spectra.pages.dev)"]
    User -->|"HTTPS / WSS :443\n(Direct Container Host)"| HF["Hugging Face Spaces\n(:7860 Docker Container)"]
    
    subgraph HF_Container["HF Space Container (2 vCPU / 16 GB RAM)"]
        FastAPI_App["FastAPI Mission Engine (:7860)\n(uvicorn / 1 async worker + 2 CPU pool workers)"]
        DiskCache["/home/user/app/backend/cache\n(Benchmarks & In-Memory LRU)"]
        FastAPI_App <--> DiskCache
    end
    
    FastAPI_App -->|"Session Pooler :5432\n(TLS Encrypted)"| Supa[("Supabase Cloud\nPostgreSQL 16")]
    FastAPI_App -->|"HTTPS SIA2 / Cutouts"| IRSA["NASA / IPAC IRSA\n(caltech.edu)"]
    FastAPI_App -.->|"HTTPS Byte-Ranges"| S3["AWS Open Data S3\n(nasa-irsa-spherex)"]
    
    Cron["cron-job.org\n(Every 5 min)"] -->|"GET /api/health"| FastAPI_App
```

---

## 4. Component & Service Design

### 4.1 Frontend Client Subsystems (`web-client`)

```
+----------------------------------------------------------------------------------------------------+
|                                    GLOBAL COMMAND HEADER (56px)                                    |
| [Logo] [Target Input: "WISE 0855" / Sexagesimal] [Resolver] [FoV: 180"] [Pills: 5 Benchmarks] [K] |
+----------------------------------------------------------------------------------------------------+
| WORKSPACE TABS: [1: Navigator] [2: Comparator] [3: Spectrophotometer] [4: Ice Lab] [5: Forum]      |
+--------------------------------------------------+-------------------------------------------------+
| PRIMARY WORKSPACE CANVAS (65% Width)             | INTERACTIVE ANALYSIS DECK (35% Width)           |
|                                                  |                                                 |
| [Tab 1: Aladin Lite v3 WebGL2 Dome]              | [Cadence & Survey Pass Boundaries]              |
| [Tab 2: WebGL2 Float32 Diff / Blink Canvas]      | [Dynamic Asinh Stretch Slider (a = 0.1)]        |
| [Tab 3: uPlot 102-Band Spectral Chart]           | [Signed Difference Scale (u_diff_scale)]        |
| [Tab 4: Point-Source Ice Depth Curve]            | [Gaia Sub-Pixel Centroid Pins]                  |
| [Tab 5: 3-Column Observation Feed]               | [Bayesian Confidence & Classification Submit]   |
+--------------------------------------------------+-------------------------------------------------+
| STATUS FOOTER: Target Badge [NASA Benchmark] | Data Release: QR2 | Health: 100% | Latency: 8ms     |
+----------------------------------------------------------------------------------------------------+
```

1. **Global Navigation & Resolution Deck (`<GlobalCommandHeader />`):**
   - Implements sexagesimal parser and name debouncer (350 ms).
   - In-memory benchmark lookup (`LOCAL_CATALOG_MAP`) yields $<1\,\text{ms}$ resolution for the 5 NASA benchmarks.
   - External names route to CDS Sesame with a 2.0s circuit breaker.
2. **WebGL2 Time-Domain Engine (`<TimeDomainComparator />`):**
   - Allocates two `gl.R32F` textures for current and reference epochs, plus two variance textures (`u_var_current`, `u_var_reference`).
   - Fragment shader implements:
     - Mode 0 (Blink): Single-epoch flux stretch:
       $$\text{display} = \text{asinh}\left(\frac{I - u_{\text{black}}}{u_{\text{white}} - u_{\text{black}}} \cdot \frac{1}{a}\right) \Big/ \text{asinh}\left(\frac{1}{a}\right)$$
     - Mode 1 (Signed Difference): Symmetric stretch centered on mid-grey (0.5):
       $$\text{diff} = \frac{I_{\text{curr}} - I_{\text{ref}}}{u_{\text{diff\_scale}}}, \quad \text{display} = \text{clamp}\left(0.5 + 0.5 \cdot \text{asinh\_stretch}(\text{diff}, a), 0.0, 1.0\right)$$
     - Mode 2 (Inverse-Variance Co-Add): True error-weighted coaddition:
       $$I_{\text{coadd}} = \frac{I_{\text{curr}} w_{\text{curr}} + I_{\text{ref}} w_{\text{ref}}}{w_{\text{curr}} + w_{\text{ref}}}, \quad w = \frac{1}{\sigma^2}$$
3. **Hyperspectral Visualizer (`<SpectrophotometricLab />`):**
   - Utilizes `uPlot` Canvas 2D engine (<40 KB footprint) rendering 102 channels at 60 FPS.
   - Displays vertical error bars derived from HDU 3 (`VARIANCE`).
   - **Composite Spectral Unmixing:**
     Implements two-component linear unmixing via Non-Negative Least Squares ($\text{NNLS}$):
     $$F_{\text{obs}}(\lambda_k) = a \cdot T_1(\lambda_k) + b \cdot T_2(\lambda_k) + \epsilon_k, \quad \text{subject to } a \ge 0, \, b \ge 0$$
     Demonstrates spectral de-blending of Epsilon Indi B into T1 and T6 brown dwarf templates within a single $6.2''$ pixel, reporting the best-fit coefficient ratio $a/b$ and residual $\chi^2_{\text{red}}$.
   - **Automated Galaxy Photo-$z$ Solver:**
     Evaluates galaxy template models across a redshift grid $z \in [0.0, 2.5]$ with step $\Delta z = 0.01$:
     $$\chi^2(z, T) = \sum_{k=1}^{102} \frac{\left(F_k - c(z) \cdot T_k(z)\right)^2}{\sigma_k^2}, \quad P(z) \propto \exp\left(-\frac{\chi^2(z)}{2}\right)$$
     Computes cosmological lookback time $t_L(z)$ and luminosity distance $d_L(z)$ under Planck 2018 parameters ($H_0 = 67.4\,\text{km/s/Mpc}, \Omega_m = 0.315, \Omega_\Lambda = 0.685$), coupled to an interactive redshift slider ($z = 0.0 - 2.5$) that dynamically shifts spectral emission/absorption markers ($1.6\,\mu\text{m}$ H-bump, $\text{H}\alpha$, $\text{O\,III}$).
4. **Point-Source Ice Studio (`<MolecularIceStudio />`):**
   - Operates on SPLICES point-source background stars along interstellar pencil beams.
   - Integrates optical depth $\tau(\lambda) = -\ln(F(\lambda)/F_{\text{cont}}(\lambda))$ across wavenumber $\nu$:
     $$N_{\text{ice}} = \frac{1}{A} \int \tau(\nu) d\nu \quad [\text{cm}^{-2}]$$
   - Computes biogenic ice ratios: $N(\text{CO}_2)/N(\text{H}_2\text{O}) \times 100\%$.
5. **Web Worker Decompression & Transferable Pipeline (`worker.ts`):**
   - Binary stream reading, header JSON parsing, and Zstandard un-shuffling execute off the main thread inside a dedicated Web Worker.
   - Decompressed `Float32Array` buffers are transferred to the WebGL2 context via `postMessage(..., [buffer])` (Transferable Objects) with zero memory cloning.
6. **Route-Level Dynamic Code Splitting (`React.lazy`):**
   - Public exploration (`/explore`) and Admin portal (`/admin`) are split into isolated asynchronous chunks.
   - Initial core bundle size remains $<280\,\text{KB}$ gzipped. Heavy visualization engines (`plotly.js-gl3d-dist`, ~1.8 MB) load strictly upon demand when `/admin` routes are opened.

### 4.2 Backend Mission Engine Subsystems (`backend/`)

```mermaid
flowchart TD
    subgraph IngestionSubsystem["Ingestion & Validation Subsystem"]
        Req["Incoming POST /api/cutout"] --> Guard["Zero-Auth Session Guard"]
        Guard --> Queue["asyncio.Queue (Depth 5)"]
        Queue --> LRU_Check{"In-Memory LRU Cache?"}
        LRU_Check -- Hit --> ReturnCache["Return Cached Float32 Tensor"]
        LRU_Check -- Miss --> SIA["IRSA SIA2 Query (pyvo)"]
        SIA --> Fetch["Fetch MEF FITS (Cutout API / S3)"]
    end

    subgraph ScienceSubsystem["Scientific Reprojection Subsystem"]
        Fetch --> Match["Adaptive Wavelength Matching [lambda_0(1-w), lambda_0(1+w)]"]
        Match --> Centroid["Native Detector PSF Centroiding"]
        Centroid --> Reproject["reproject_exact (Flux-Conserving)"]
        Reproject --> TensorBuild["Build Binary Float32Array Tensor"]
    end

    subgraph LedgerSubsystem["Ledger & Consensus Subsystem"]
        TensorBuild --> CacheStore["Store in LRU & Notify SSE"]
        Classify["POST /api/classify"] --> Auth["Verify sha256(Observer Key)"]
        Auth --> Bayes["Update Bayesian Weight w_u"]
        Bayes --> Consensus["Recompute P(c|s) & Entropy H(s)"]
        Consensus --> DB[("Supabase PostgreSQL 16")]
    end
```

1. **Cutout & Reprojection Engine (`science/reproject.py`):**
   - Constructs synthetic North-Up, East-Left tangent plane WCS ($CDELT = -6.2'', +6.2''$).
   - Reprojects `IMAGE` and `VARIANCE` via spherical polygon overlap (`reproject_exact`).
   - Reprojects `FLAGS` via nearest-neighbor to prevent corruption of 32-bit bitmasks.
2. **Smile Inversion & Photometry Engine (`science/wave.py`):**
   - Translates sky coordinates $(\alpha, \delta)$ to native detector pixel coordinates $(x_{\text{det}}, y_{\text{det}})$ using `TAN-SIP` WCS and sub-array offsets (`CRPIX1A`, `CRPIX2A`).
   - Evaluates HDU 6 `WCS-WAVE` 2D grid to extract exact central wavelength $\lambda_k$ and bandpass $\Delta\lambda_k$.
   - Performs forced aperture photometry using empirical HDU 5 PSF cubes, converting surface brightness $I_\nu$ ($\text{MJy/sr}$) to flux density $F_\nu$ (Janskys):
     $$F_\nu [\text{Jy}] = I_\nu [\text{MJy/sr}] \times 10^6 \times \Omega_{\text{px}} [\text{sr}], \quad \Omega_{\text{px}} \approx 9.023 \times 10^{-10}\,\text{sr}$$
3. **In-Memory Cosine Similarity Engine (`science/similarity.py`):**
   - Loads 102-element flux arrays into contiguous NumPy matrices.
   - Evaluates vectorized cosine distance against 10,000 reference spectra in $<15\,\text{ms}$, completely eliminating external database vector index dependencies.
4. **SSE & WebSocket Broadcasting Hubs (`api/forum.py` & `admin_ws.py`):**
   - Manages asynchronous SSE progress connections (`/api/cutout/progress/{task_id}`) and forum updates (`/api/forum/stream`).
   - Maintains a 100-frame in-memory ring buffer for administrative ML training telemetry frames, streaming over WebSockets with reconnection replay.
5. **High-Throughput Python Hardening & Runtime Parity Engine:**
   - **`uvloop` Integration & Event Loop Throughput:** Replaces default `asyncio` loop with `uvloop` (`asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())`), delivering 2x–4x higher HTTP/WebSocket request throughput and $<0.5\,\text{ms}$ scheduling jitter.
   - **CPU Offload & GIL Bypass:** Offloads heavy mathematical routines (`reproject_exact`, forced PSF convolution, Chebyshev polynomial baselines) to a `ProcessPoolExecutor(max_workers=2)` via `loop.run_in_executor()`. Leaves the main `asyncio` event loop free to handle SSE updates and HTTP requests with sub-millisecond response times.
   - **Tangent Coordinate Meshgrid Pre-Caching:** Pre-computes target world coordinates $(\alpha, \delta)$ once per master tangent grid ($w \times h$) and reuses the coordinate grid across all 6 detector bands and survey epochs, eliminating 80% of redundant spherical coordinate transformations.
   - **Automated Compile-Time SQL Verification:** Replaces Go's `sqlc` build-time validation via `backend/tests/test_sql.py` in CI, which parses and executes `EXPLAIN` on all parameterized queries in `queries.py` against `schema.sql` before deployment.
   - **Cold Boot Optimization:** Employs lazy dynamic imports for heavy ML libraries (`torch`, `scipy`) inside `/admin` route handlers. Top-level public routes import strictly `fastapi`, `numpy`, and `astropy.io.fits`, achieving `<600 ms` cold starts.
   - **Memory Management & Fragmentation Shield:** Employs `astropy.io.fits.open(..., memmap=True)` to map bytes directly from OS cache, allocates contiguous Float32 buffers (`np.empty(..., dtype=np.float32)`), and enforces a 1.0 GB byte-capped limit on `cachetools.LRUCache`.
6. **Adaptive Wavelength Matching Algorithm:**
   - Evaluates HDU 6 `WAVE-TAB` at every pixel in the cutout to compute exact central wavelength $\lambda(x, y)$ and bandpass width $\Delta\lambda(x, y)$.
   - Resolving power per detector array: D1–D3 ($R \approx 35-50$), D4 ($R \approx 64-96$), D5 ($R \approx 96-118$), D6 ($R \approx 118-130$).
   - Nominal fractional half-width is defined as $w_b \approx 1/R_b$ ($\approx \pm 0.8\% - 0.9\%$ in D5/D6).
   - If a survey pass has sparse coverage, a fixed window may yield zero matching exposures. When `adaptive_window=true`, the backend adaptively widens the window half-width $w_b$ per target until every available epoch has at least $N_{\text{min}} \ge 1$ matched exposures, attaching an `[Adaptive Window (w=...)]` and residual warning badge if $w_b > 1/R_b$.
7. **Native Per-Exposure PSF Centroiding Engine:**
   - Centroid fitting executes **per exposure in native detector pixel space** rather than on resampled tangent mosaics (which introduces correlated pixel errors and non-linear distortion):
     $$I_{\text{model}}(x, y) = F_0 \cdot \text{PSF}_{\text{resamp}}(x - x_0, y - y_0) + B_0$$
   - **HDU 5 PSF Zone Selection:** The empirical Point Spread Function in HDU 5 is indexed by parent detector coordinates $(x_{\text{parent}}, y_{\text{parent}})$. Cutout pixels are mapped back to parent coordinates via raw exposure WCS to select the correct local empirical PSF kernel.
   - **Sub-Pixel Phase Resampling:** Oversampled PSF kernels are resampled to native detector pixels at the exact trial sub-pixel phase $(x - x_0, y - y_0)$.
   - **Inverse-Covariance Coaddition of Positions:** Native centroids are combined per (epoch, band) using inverse-covariance weighting:
     $$\vec{r}(e, b) = \left( \sum_{i \in S(e, b)} \mathbf{\Sigma}_i^{-1} \right)^{-1} \sum_{i \in S(e, b)} \mathbf{\Sigma}_i^{-1} \vec{r}_i$$
   - **Proper Motion Flagging:** Mover candidates are flagged when the measured centroid shift between earliest and latest epochs achieves $\text{SNR} \ge 3\sigma$ against catalog-free background stars.
8. **Synthetic Source Injector Engine (`synth_a` & `synth_b`):**
   - **Injection Parameters:** Supports `synth_a` and `synth_b` configurations specifying target sky coordinates $(\alpha_0, \delta_0)$, proper motion vector $(\mu_\alpha^*, \mu_\delta)$ in $\text{mas/yr}$, reference epoch $t_0$, apparent magnitude in Band D5, and synthetic spectral class (e.g. cold brown dwarf with methane absorption).
   - **Proper Motion Propagation:** Computes source displacement at observation epoch $t_k$:
     $$\Delta\alpha(t_k) = \frac{\mu_\alpha^* (t_k - t_0)}{\cos \delta(t_k)}, \quad \Delta\delta(t_k) = \mu_\delta (t_k - t_0)$$
   - **PSF Convolved Injection:** Converts requested flux into native detector pixels using empirical HDU 5 Point Spread Functions. Injects convolved photon flux directly into HDU 1 `IMAGE`, and propagates Poisson noise variance into HDU 3 `VARIANCE`.
   - **Transparent Provenance & Calibration Loop:** Injected frames carry the internal metadata flag `is_synthetic = True`, allowing the active-learning queue to automatically evaluate volunteer sensitivity and update Bayesian reliability weights $w_u$ upon submission.

### 4.3 Machine Learning & Observability Subsystem (`backend/ml/` & `/admin`)
To support Phase 3 AI research and evaluators testing model training dynamics, the platform includes a complete, real PyTorch machine learning subsystem and a dedicated 5-tab administrative mission control portal.

```
+----------------------------------------------------------------------------------------------------+
|                                    MISSION CONTROL PORTAL (/admin)                                 |
|  [Header: Admin Status: Read-Only Default | ADMIN_MUTATIONS_ENABLED: False | Token Gate: Locked]   |
+----------------------------------------------------------------------------------------------------+
|  [Tab 1: Dynamics Studio]  [Tab 2: Activation Inspector]  [Tab 3: Boundary 3D]                     |
|  [Tab 4: Hard Negative Triage]  [Tab 5: Data Product Exporter]                                     |
+--------------------------------------------------+-------------------------------------------------+
| REAL-TIME TRAINING RUN VIEW (65% Width)          | ACTIVE MODEL & TELEMETRY DECK (35% Width)       |
|                                                  |                                                 |
| [uPlot Scalar Curves: Train/Val Loss, F1]        | Architecture: DipoleConvNet3D                   |
| [Epoch Scrubber: 0 ... 40 (150ms / epoch)]       | Batch Size: 16 | Optimizer: AdamW (lr=1e-3)     |
| [3D Weight & Gradient Ridgeline Histograms]      | [Start Live Training Run (Token Required)]      |
| [Probe Target: WISE 0855 Feature Activations]    | [Replay Pre-Computed Checkpoint (Instant Demo)] |
| [Plotly WebGL 25x25x25 3D Decision Boundary]     |                                                 |
|                                                  | [Hard-Negative Disagreement Triage Queue]       |
|                                                  | - ID: spx_j0855 | Human: Y-Dwarf | AI: Artifact |
|                                                  | [Inspect Raw FITS HDUs 1-6] [Promote Candidate] |
+--------------------------------------------------+-------------------------------------------------+
```

#### 1. The Three Real Machine Learning Architectures (`backend/ml/models.py`)
Rather than mock animations, the backend defines and trains three concrete PyTorch architectures:
1. **`DipoleConvNet3D` (Spatiotemporal Time-Domain Classifier):**
   - Ingests multi-epoch tangent cutouts as 5D tensors: $[B, C=1, T=\text{epochs}, H=32, W=32]$.
   - Employs 3D convolutions (`Conv3d`) across temporal passes to simultaneously learn proper motion centroid shifts and flux variations.
   - Classifies targets into: `moving_brown_dwarf`, `variable_star`, `dipole_artifact`, `unresolved_binary`.
2. **`SpectralResNet102` (Hyperspectral 1D Residual Classifier):**
   - Ingests 102-channel flux vectors: $[B, C=1, L=102]$.
   - Uses 1D residual blocks with skip connections to detect sharp molecular troughs (e.g. $3.32\,\mu\text{m}$ $\text{CH}_4$, $3.05\,\mu\text{m}$ $\text{H}_2\text{O}$ ice, $4.27\,\mu\text{m}$ $\text{CO}_2$ ice) against smooth stellar continua.
   - Classifies cold brown dwarfs by spectral type (L, T, Y) and estimates photometric redshifts $z$.
3. **`AstroFeatureSVM` (Calibrated RBF Decision Boundary Model):**
   - Fast classifier trained on a 3D feature space: $[X: \text{IR Color } D_5/D_2, Y: \text{Centroid Motion SNR } \Delta S/\sigma, Z: \text{Ice Optical Depth } \tau_{3.05} + \tau_{4.27}]$.
   - Visualized in Tab 3 via a dynamic 3D probability meshgrid.

#### 2. Live Training & Instrumentation Loop (`backend/ml/trainer.py` & `telemetry.py`)
- **Paced Human-Observable Training:** The training loop runs with a deliberate $150\,\text{ms}$ inter-epoch pause. Over 40 epochs (~6 seconds total), human evaluators can watch loss curves descend and decision boundaries warp in real time.
- **Compact Bounded Telemetry Packets (<20 KB):** Forward and backward hooks compress training state before transmission:
  - *Scalar Metrics:* 6 floats (`train_loss`, `val_loss`, `val_f1`, `lr`, `grad_norm`, `overfit_flag`).
  - *Weight Histograms:* Layer weights downsampled via `np.histogram(..., bins=40)` to 160 integer counts total.
  - *Probe Activations:* Feature map activations for pinned benchmark WISE 0855 downsampled to $16 \times 16$ Float16 arrays.
  - *3D Decision Meshgrid:* Class probabilities evaluated across a $25 \times 25 \times 25$ feature grid, quantized to `Uint8` ($0-255$).
- **Ring-Buffer Replay:** The WebSocket hub (`/api/admin/ws/training`) caches the last 100 epoch frames. When an admin connects or refreshes mid-run, recent epochs are instantly replayed.
- **Pre-Computed Checkpoints (`backend/ml/weights/`):** Shipped with pre-trained weights (`dipole_convnet_3d.pt`, `spectral_resnet_102.pt`) for immediate 60 FPS demo playback without requiring live GPU/CPU retraining.

#### 3. Administrative Workspaces Breakdown (`web-client/src/admin/`)
- **Tab 1: Training Dynamics Studio (`TrainingDynamics.tsx`):** Real-time scalar curves for loss, accuracy, and gradient norms rendered via `uPlot`.
- **Tab 2: Parameter Updates & Activation Inspector (`ActivationInspector.tsx`):** 3D ridgeline weight histograms and probe feature maps.
- **Tab 3: Decision Boundary Animator (`DecisionBoundaries.tsx`):** Interactive 3D probability isosurfaces rendered via `plotly.js-gl3d-dist` (lazy-loaded to keep bundle $<500\,\text{KB}$).
- **Tab 4: Disagreement Triage & Hard-Negative Queue (`HardNegativeTriage.tsx`):** Inspects targets where citizen consensus contradicts AI predictions ($|P_{\text{AI}} - P_{\text{Human}}| > 0.5$).
- **Tab 5: Data Product Exporters (`DataProductExports.tsx`):** 1-click generation of the 4 official SPHEREx community catalogs (CSV, VOTable, JSON, FITS) and PyTorch HDF5 training bundles.

---

## 5. Data Architecture

### 5.1 Storage Engine Selection & Rationale
- **Primary Relational Store:** **Supabase PostgreSQL 16** via Session Pooler (port `5432`, IPv4 compatible). Provides ACID compliance, transactional integrity for citizen consensus math, and JSONB indexing for telemetry metadata.
- **Why NOT Raw NoSQL / MongoDB:** Astrophysical citizen discovery requires strict relational foreign key constraints between subjects, observers, classifications, and peer-reviewed discussion replies.
- **Why NOT Database `pgvector` for Phase 1/2:** On Supabase's 500 MB free tier, storing hundreds of thousands of high-dimensional vectors with HNSW indexes exhausts memory and connection limits. In-memory NumPy cosine similarity provides $<15\,\text{ms}$ query latency at zero cloud cost.

### 5.2 Entity-Relationship Model & Schema Definition

```mermaid
erDiagram
    heartbeat {
        int id PK
        timestamptz last_ping
        text irsa_status
        int active_workers
    }

    subjects {
        text subject_id PK
        text title
        text category
        double ra
        double dec
        double fov_arcsec
        text recommended_tab
        boolean is_calibration
        text expert_ground_truth
        real_array spectrum_array
        double redshift_z
        jsonb ice_column_densities
        double ai_anomaly_score
        text ai_predicted_class
        double consensus_score
        double shannon_entropy
        text verification_status
        timestamptz created_at
    }

    observers {
        bigserial id PK
        uuid observer_id UK
        text key_hash
        text handle
        int total_classifications
        int calibration_seen
        int calibration_correct
        double reliability_weight
        timestamptz created_at
    }

    classifications {
        bigserial id PK
        text subject_id FK
        uuid observer_id FK
        text tab_workflow
        text primary_class
        jsonb feature_tags
        jsonb motion_telemetry
        double confidence
        double observer_weight_snapshot
        timestamptz created_at
    }

    discussion_threads {
        bigserial thread_id PK
        text subject_id FK
        uuid author_id FK
        text author_handle
        text channel
        text title
        text body
        jsonb hashtags
        double ra
        double dec
        text state_query
        boolean moderator_verified
        timestamptz created_at
    }

    discussion_replies {
        bigserial reply_id PK
        bigint thread_id FK
        uuid author_id FK
        text author_handle
        text body
        boolean moderator_verified
        timestamptz created_at
    }

    ml_training_runs {
        text run_id PK
        text model_architecture
        jsonb hyperparameters
        int epochs_completed
        double final_train_loss
        double final_val_loss
        double final_val_f1
        jsonb telemetry_frames
        text status
        timestamptz created_at
    }

    subjects ||--o{ classifications : receives
    observers ||--o{ classifications : submits
    subjects ||--o{ discussion_threads : discusses
    observers ||--o{ discussion_threads : authors
    discussion_threads ||--o{ discussion_replies : contains
    observers ||--o{ discussion_replies : writes
```

### 5.3 Caching & Memory Hierarchy

```
+----------------------------------------------------------------------------------------------------+
|                                    FOUR-TIER CACHING TOPOLOGY                                      |
|                                                                                                    |
|  TIER 1: Browser Storage & Memory (<1 ms)                                                          |
|  - localStorage: spx_observer_id, spx_observer_key                                                 |
|  - TanStack Query v5 In-Memory Cache: 50 recent API responses                                      |
|  - Zustand Binary Store: raw Float32Array buffers for active cutouts                              |
|                                                                                                    |
|  TIER 2: Edge CDN Cache (<15 ms)                                                                   |
|  - Cloudflare Pages Edge: /public/benchmarks/*.json, *.f32                                         |
|  - Pre-baked cutouts, spectra, and Gaia DR3 overlays for the 5 NASA targets                       |
|                                                                                                    |
|  TIER 3: Backend Memory Cache (<10 ms)                                                             |
|  - cachetools.LRUCache(maxsize=1000): In-memory Float32 cutouts and extracted spectra             |
|  - LOCAL_CATALOG_MAP: In-memory name-to-coordinate lookup for 50 common targets                   |
|                                                                                                    |
|  TIER 4: Persistent Relational Store (15 - 45 ms)                                                  |
|  - Supabase PostgreSQL 16 (Session Pooler port 5432)                                               |
+----------------------------------------------------------------------------------------------------+
```

---

## 6. Interface & Integration Design

### 6.1 Complete REST & Streaming API Contracts

#### 1. Cutout Pipeline Endpoints
- `POST /api/cutout`: Enqueues an asynchronous cutout task.
  - *Payload:* `{"ra": 133.73712, "dec": -7.24038, "fov_arcsec": 180, "cadence": "survey_6month"}`
  - *Response (202 Accepted):* `{"task_id": "spx_task_89f2a", "status": "queued", "queue_position": 1, "poll_progress_url": "/api/cutout/progress/spx_task_89f2a", "tensor_url": "/api/cutout/spx_task_89f2a/tensor"}`
  - *Response (503 Unavailable):* Returned when queue depth $\ge 5$ with `Retry-After: 15`.
- `GET /api/cutout/progress/{task_id}`: SSE progress stream emitting real-time stage updates:
  ```http
  event: queued
  data: {"position": 1, "estimated_wait_seconds": 8}

  event: progress
  data: {"stage": "fetching", "progress": 0.50, "message": "Retrieved 12 Level 2 MEFs"}

  event: complete
  data: {"stage": "complete", "progress": 1.00, "tensor_url": "/api/cutout/spx_task_89f2a/tensor"}
  ```
- `GET /api/cutout/{task_id}/tensor`: Zero-copy binary Float32 stream (`application/octet-stream`).

#### 2. Science & Extraction Endpoints
- `GET /api/resolve`: Fast target resolver. Checks local cache map ($<1\,\text{ms}$) before querying CDS Sesame with a 2.0s circuit breaker.
- `GET /api/spectrum`: Extracts smile-corrected 102-channel forced point-source photometry in Janskys.
- `POST /api/subjects/similar`: Evaluates in-memory NumPy cosine similarity, returning the 5 closest spectral templates.

#### 3. Citizen Science & Ledger Endpoints
- `POST /api/classify`: Submits citizen classifications. Validates `X-Observer-ID` and `X-Observer-Key` headers; updates Bayesian reliability weight $w_u$ and Shannon entropy $H(s)$.
- `GET /api/queue/next`: Returns active-learning queue candidates prioritized by $(0.6 \cdot H(s) + 0.4 \cdot \text{anomaly\_score})$.

#### 4. Discussion & Real-Time Forum Endpoints
- `GET /api/forum/stream`: Persistent Server-Sent Events stream delivering live community thread creation, comment replies, and moderator badges.
- `POST /api/forum/threads` & `POST /api/forum/replies`: Creates community discussions embedding deep-link URL state parameters.

#### 5. System Health & Keep-Alive Endpoints
- `GET /api/health/live`: Container liveness check for Docker supervisor, returns `200 {"status": "live"}`.
- `GET /api/health`: Dual-action keep-alive, updating `heartbeat.last_ping` on PostgreSQL and pinging IRSA.

### 6.2 Zero-Copy Binary Float32 Tensor Format
To eliminate 33% Base64 bandwidth overhead and avoid 8-bit posterization, cutouts are streamed as contiguous IEEE-754 32-bit float buffers:
- **MIME Type:** `application/octet-stream`
- **Byte Order:** Little-Endian (Standard x86_64 / ARM64 WebGL2 layout)
- **Custom HTTP Headers:**
  - `X-Tensor-Dimensions: 4`
  - `X-Tensor-Shape: [N_epochs, 6_bands, Height, Width]`
  - `X-Tensor-Planes: FLUX,VARIANCE,FLAGS,N_EXPOSURES`
  - `X-Target-Badge: NASA Benchmark | IRSA Live | Synthetic Injection`
- **Memory Consumption:** A $300''$ cutout ($48 \times 48\,\text{px}$) across 3 epochs and 6 bands consumes strictly $0.58\,\text{MB}$, loading in $<10\,\text{ms}$.
- **Lossless Byte-Shuffled Zstandard Stream Compression:**
  - Scientific astronomical pixels share identical signs and exponents. The backend byte-shuffles the Float32 buffer into 4 contiguous byte blocks and compresses with `zstandard` level 1 (`"compression": "zstd-shuffle"`).
  - Achieves a **4x to 7x lossless compression ratio** in $<2\,\text{ms}$ on CPU, reducing payload size to ~42 KB ($180''$), ~115 KB ($300''$), and ~480 KB ($600''$) without losing a single bit of floating-point precision.
  - Client decodes via `zstd-wasm` (<25 KB WASM module) in a dedicated Web Worker in $<3\,\text{ms}$.

---

## 7. Security & Access Control

```mermaid
flowchart TD
    Client["Client Browser"] --> Guard["FastAPI Security Guard"]
    
    subgraph RouteIsolation["Route Namespace Separation"]
        Guard -->|"/explore/* (Public)"| PublicPath["Zero-Auth Public Pipeline"]
        Guard -->|"/admin/* (Mission Control)"| AdminPath["Administrative Pipeline"]
    end
    
    subgraph PublicAuth["Zero-Auth Telemetry Fingerprinting"]
        PublicPath --> CheckHeaders{"Has X-Observer-ID\n& X-Observer-Key?"}
        CheckHeaders -- Yes --> HashKey["Compute sha256(Key)"]
        HashKey --> MatchDB{"Key Hash Matches DB?"}
        MatchDB -- Yes --> AllowWrite["Allow Mutation (/api/classify, /api/forum)"]
        MatchDB -- Mismatch --> Reject401["401 Unauthorized"]
        CheckHeaders -- No --> ReadOnly["Allow Read-Only Exploration"]
    end
    
    subgraph AdminAuth["Admin Gatekeeper"]
        AdminPath --> ReadOnlyDefault{"ADMIN_MUTATIONS_ENABLED\n== true?"}
        ReadOnlyDefault -- No (Default) --> AdminRead["Render Read-Only Dashboards"]
        ReadOnlyDefault -- Yes --> CheckToken{"Matches Server-Held\nADMIN_TOKEN?"}
        CheckToken -- Valid --> AdminWrite["Allow Model Retraining & Triage"]
        CheckToken -- Invalid --> Reject403["403 Forbidden"]
    end
```

### 7.1 Zero-Auth Cryptographic Session Protocol
- **No Password Screens:** Citizens and evaluators never encounter registration forms.
- **Client Key Generation:** On first load, browser executes:
  ```javascript
  const observerId = crypto.randomUUID();
  const observerKey = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem('spx_observer_id', observerId);
  localStorage.setItem('spx_observer_key', observerKey);
  ```
- **Server Verification:** FastAPI verifies `sha256(X-Observer-Key) == observers.key_hash`. Neither the raw secret key nor internal database primary keys are ever exposed in public responses.

### 7.2 Database Perimeter & Row Level Security (RLS)
- **Zero Browser PostgREST Access:** The browser holds zero Supabase database credentials. All queries execute through FastAPI.
- **Lockdown RLS Policies:** Row Level Security is enabled across all seven tables. No permissions are granted to the `anon` role, completely preventing unauthorized direct PostgREST table access.

### 7.3 CORS & Rate Limiting Defense
- **Strict Allowed Origins:** CORS is restricted via `CORSMiddleware` to Cloudflare Pages production domain and local dev ports (`http://localhost:3000`).
- **Allowed Headers:** Explicitly whitelisted: `Origin`, `Content-Type`, `Accept`, `Authorization`, `X-Observer-ID`, `X-Observer-Key`.
- **Write Rate Limiter:** Mutating writes (`/api/classify`, `/api/forum/threads`) are limited to **60 requests per minute** per observer session using an in-memory token bucket.

---

## 8. Technology Stack Matrix

| Category | Component / Tool | Version / Standard | Technical Justification |
|---|---|---|---|
| **Frontend Framework** | React | `^18.3.1` | Concurrent rendering, stable ecosystem, zero memory leak component lifecycle. |
| **Frontend Tooling** | Vite | `^5.4.0` | Sub-second Hot Module Replacement (HMR), optimized Rollup production bundles. |
| **Language (Client)** | TypeScript | `^5.5.0` | Strict type safety synchronized with OpenAPI schema definitions. |
| **URL State Engine** | `nuqs` | `^1.19.0` | Type-safe URL query parameters enabling 1-click deep-link view rehydration. |
| **Async Cache (Client)** | TanStack Query | `^5.56.0` | Automatic background prefetching, query deduplication, and stale-while-revalidate. |
| **WebGL2 Shaders** | Native GLSL ES 3.00 | WebGL2 Standard | Zero-copy `gl.R32F` float textures for hardware-accelerated Asinh dynamic stretching. |
| **Fast 2D Charting** | `uPlot` | `^1.6.30` | High-frequency Canvas 2D engine rendering 102 channels with error bars at 60 FPS (<40 KB). |
| **Celestial Globe** | Aladin Lite | `v3.3.2-beta` | High-performance WebGL2 celestial sphere with MOC layer and Gaia DR3 vector overlays. |
| **Backend Runtime** | Python | `>=3.11,<3.12` | Native support for Astropy, PyVO, Reproject, and PyTorch. |
| **Backend Framework** | FastAPI + Uvicorn | `^0.115.0` | High-throughput asynchronous routing, native SSE, WebSockets, and OpenAPI export. |
| **Package Orchestration**| Astral `uv` | `^0.4.29` | Deterministic binary wheel locks, sub-second cold environment synchronization. |
| **Scientific Processing**| `astropy` / `reproject` | `>=6.1.3` / `>=0.14.0` | Institutional WCS handling and `reproject_exact` flux-conserving area overlap. |
| **Archive Ingestion** | `pyvo` / `fsspec` | `>=1.5.2` / `>=2024.6.1`| Standard IVOA Simple Image Access (SIA2) and resilient S3 byte-range section reads. |
| **Database Engine** | PostgreSQL | `16.x` (Supabase) | Managed relational ledger with JSONB indexing and direct `asyncpg` pooling. |
| **Containerization** | Docker | Multi-Platform | Single-stage slim Python 3.11 image pinned to Hugging Face Spaces port `7860`. |
| **Edge CDN** | Cloudflare Pages | Global Edge | Zero cold starts, global edge caching for pre-baked benchmark fallbacks. |

---

## 9. Deployment & Operational Infrastructure

```mermaid
flowchart TD
    subgraph RepoPipeline["GitHub Repository (CI/CD)"]
        Commit["Git Push to main"] --> CI["GitHub Actions: ci.yml\n(Ruff + Pytest with SQL EXPLAIN + TypeScript Typecheck)"]
        CI --> DeployBack["deploy-backend.yml\n(Mirror backend/, Dockerfile to HF Space Git)"]
        CI --> DeployFront["Cloudflare Pages Native Git Build\n(Builds web-client/ -> CDN Edge)"]
    end

    subgraph HF_Runtime["Hugging Face Spaces (:7860)"]
        DeployBack --> Rebuild["Docker Image Build via uv"]
        Rebuild --> Run["Run start.sh -> uvicorn backend.main:app"]
    end

    subgraph KeepAliveSystem["$0 Always-Warm Automation"]
        CronOrg["cron-job.org (Every 5 min)"] --> Ping["GET /api/health"]
        GHA_Backup["GitHub Actions heartbeat.yml (Every 15 min)"] --> Ping
        Ping --> TouchDB["UPDATE heartbeat SET last_ping = NOW()"]
        TouchDB --> ResetTimer["Supabase 7-Day Inactivity Timer Reset"]
    end
```

### 9.1 Container Blueprint (`Dockerfile`)
```dockerfile
FROM python:3.11-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.4.29 /uv /usr/local/bin/uv

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/app/backend/.venv/bin:/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
WORKDIR /home/user/app

# Dependency layer (cached unless pyproject.toml / uv.lock change)
COPY --chown=user backend/pyproject.toml backend/uv.lock ./backend/
RUN cd backend && uv sync --frozen --no-dev --no-install-project

# Source code, pre-computed benchmark cache & supervisor
COPY --chown=user backend/ ./backend/
RUN cd backend && uv sync --frozen --no-dev
COPY --chown=user start.sh ./start.sh
RUN chmod +x ./start.sh && mkdir -p /home/user/app/backend/cache

EXPOSE 7860
HEALTHCHECK --interval=60s --timeout=5s CMD curl -fsS http://127.0.0.1:7860/api/health/live || exit 1
CMD ["./start.sh"]
```

### 9.2 Process Supervisor (`start.sh`)
```bash
#!/usr/bin/env bash
set -euo pipefail

echo "[Spectra] Launching Unified FastAPI Mission Engine on 0.0.0.0:7860"
exec uvicorn backend.main:app --host 0.0.0.0 --port 7860 --workers 1 --timeout-keep-alive 30
```

### 9.3 Disaster Recovery & Venue Demo Offline Mirror
- **Pre-Baked Benchmark Cache (`web-client/public/benchmarks/`):** The 5 mandatory benchmark systems are baked directly into static JSON and Float32Array buffers.
- **Venue Guarantee:** If hackathon venue Wi-Fi drops completely, evaluators and judges can run `task dev` locally on a laptop or browse static fallbacks on Cloudflare Pages. All WebGL2 shaders, Asinh stretch math, and spectral visualizers execute 100% client-side without internet connectivity.

---

## 10. Architectural Decision Records (ADRs)

### ADR-001: Single FastAPI Backend vs. Two-Process Go + Python Microservices
- **Status:** **Accepted**
- **Context:** Early drafts proposed a Go API Gateway (`:8080`) proxying to a Python science worker (`:8001`) over internal loopback HTTP/NDJSON.
- **Decision:** Eliminate the Go gateway. Standardize on a single FastAPI service on port `7860` orchestrated with Astral `uv`.
- **Consequences:** Hugging Face Spaces exposes strictly one port (`7860`). Running two separate processes duplicated memory overhead, introduced loopback socket failure points, and required maintaining two language ecosystems. A single FastAPI process with `asyncpg` delivers $<2\,\text{ms}$ query latency and easily handles SSE streaming and tensor delivery.
- **Mitigation of Runtime Trade-Offs:** The 4 inherent trade-offs of not using Go are resolved completely:
  1. *GIL & CPU Blocking:* Bypassed via `ProcessPoolExecutor(max_workers=2)` for heavy FITS reprojections paired with a single `uvloop` Uvicorn process (`--workers 1`), utilizing both vCPUs while keeping in-memory queues, SSE streams, and LRU caches unified.
  2. *Compile-Time SQL Safety:* Replaced via pre-commit CI query validation (`backend/tests/test_sql.py`) executing `EXPLAIN` against `schema.sql`.
  3. *Cold Boot Speed:* Resolved via lazy dynamic imports and bytecode pre-compilation (`UV_COMPILE_BYTECODE=1`), achieving `<600 ms` startup.
  4. *Memory Fragmentation:* Shielded via memory-mapped FITS (`memmap=True`), contiguous pre-allocated array allocations, and a 1.0 GB byte-capped LRU eviction policy.

### ADR-002: Zero-Auth Cryptographic Headers vs. Blocking Authentication
- **Status:** **Accepted**
- **Context:** Citizen science platforms often require user registration, creating high drop-off rates during hackathon evaluations.
- **Decision:** Generate client-side `spx_observer_id` (UUIDv4) and `spx_observer_key` (32-byte secret) in `localStorage`, sending them via headers. Store `sha256(observer_key)` in the database.
- **Consequences:** Eliminates registration friction. Evaluators test the full platform immediately. Malicious key tampering is prevented via SHA-256 verification.

### ADR-003: Direct Backend Proxy vs. Browser-Direct Supabase PostgREST
- **Status:** **Accepted**
- **Context:** Supabase enables browsers to query database tables directly via PostgREST and `@supabase/supabase-js`.
- **Decision:** Strip all database keys from the frontend bundle. Route all reads, writes, and real-time feeds through FastAPI.
- **Consequences:** Prevents exposing database credentials in public client bundles. Enforces server-side validation and Bayesian consensus updates on every classification. Prevents unauthorized table tampering.

### ADR-004: Wavelength-Matched Differencing vs. Detector-Averaged Differencing
- **Status:** **Accepted**
- **Context:** SPHEREx detectors use Linear Variable Filters where transmitted wavelength varies across detector pixels.
- **Decision:** Restrict pairwise difference subtraction ($t_N - t_0$) strictly to exposures whose central wavelengths match within $[\lambda_0(1-w), \lambda_0(1+w)]$.
- **Consequences:** Prevents false-positive dipoles caused by subtracting different physical spectral regions. Guarantees scientific validity.

### ADR-005: WebGL2 Float32 Shaders vs. Canvas 2D CPU Rasterization
- **Status:** **Accepted**
- **Context:** Time-domain blinking and dynamic Asinh stretching can be implemented via Canvas 2D `ctx.putImageData()` or WebGL2 fragment shaders.
- **Decision:** Implement WebGL2 fragment shaders using raw `gl.R32F` IEEE-754 float textures.
- **Consequences:** Eliminates 8-bit quantization banding and posterization. Offloads dynamic Asinh stretching and signed differencing to GPU hardware at a locked 60 FPS.

### ADR-006: In-Memory NumPy Cosine Similarity vs. Database `pgvector`
- **Status:** **Accepted**
- **Context:** Phase 1/2 requires matching observed 102-band spectra against reference templates.
- **Decision:** Compute cosine similarity in-memory using vectorized NumPy matrix operations instead of database `pgvector`.
- **Consequences:** Avoids exhausting Supabase's 500 MB free storage limit and connection pool quotas. Computes similarity across 10,000 spectra in $<15\,\text{ms}$, eliminating external database dependencies.

### ADR-007: Bounded Task Queue with SSE Countdown vs. Blunt HTTP 409 Conflict
- **Status:** **Accepted**
- **Context:** Concurrent judge evaluations on Hugging Face Spaces (2 vCPU) risk Out-of-Memory crashes during heavy FITS reprojections.
- **Decision:** Manage task execution via `asyncio.Queue(maxsize=5)`. Emit real-time queue position countdowns over Server-Sent Events; return `HTTP 503` with `Retry-After: 15` if saturated.
- **Consequences:** Eliminates sudden evaluator rejection. Judges receive instant feedback and progress countdowns while memory remains safely capped below 4.0 GB.

### ADR-008: Native Detector PSF Centroiding vs. Mosaicked Centroiding
- **Status:** **Accepted**
- **Context:** Scientific proper motion measurement requires measuring sub-pixel centroid shifts between survey epochs.
- **Decision:** Perform PSF centroid fitting in native detector pixel space using HDU 5 empirical PSF cubes. Difference-of-Gaussians (DoG) filter is retained strictly as an interactive visual display aid.
- **Consequences:** Eliminates pixel interpolation errors and geometric distortions introduced by tangent plane resampling. Delivers sub-pixel precision for targets like Epsilon Indi B ($0.76\,\text{px/yr}$).

### ADR-009: Lossless Byte-Shuffled Zstandard Compression vs. Raw/Lossy Formats
- **Status:** **Accepted**
- **Context:** Scientific multi-epoch FITS cutouts across 24 planes generate 0.2 MB to 2.4 MB of raw IEEE-754 binary data, which can introduce transfer latency over constrained mobile or venue networks.
- **Decision:** Implement transparent byte-shuffled Zstandard stream compression (`"compression": "zstd-shuffle"`) with client-side Web Worker decoding via `zstd-wasm`.
- **Consequences:** Reduces payload size by 4x–7x (lossless) with $<2\,\text{ms}$ CPU compression and $<3\,\text{ms}$ client decompression. Completely preserves bit-for-bit IEEE-754 precision, rejecting lossy JPEG/WebP or aggressive float truncation.

### ADR-010: Strict IEEE-754 Float32 WebGL2 Precision vs. Half-Float (Float16) Downsampling
- **Status:** **Accepted**
- **Context:** Mobile GPUs support 16-bit half-float textures (`gl.R16F`), which halves VRAM footprint compared to 32-bit floats (`gl.R32F`).
- **Decision:** Strictly enforce full IEEE-754 32-bit float textures (`gl.R32F`) across all public viewing and analysis canvases. 16-bit half-float is restricted strictly to an emergency fallback for legacy mobile browsers lacking `OES_texture_float_linear`.
- **Consequences:** Guarantees full 24-bit mantissa precision throughout GPU Asinh stretching, signed difference subtraction, and forced aperture photometry, eliminating mantissa quantization noise in low-flux background pixels.

---

## 11. Risk Management & Operational Verification

### 11.1 Risk Management & Mitigation Matrix

| Risk | Impact | Mitigation Strategy |
|---|---|---|
| **Archive Release Renaming (QR2 vs QR3)** | Broken queries / HTTP 404. | Configuration-driven collection names via `IRSA_COLLECTION` env var; validated in Day-0 Spike S1. |
| **Sparse Coverage at Sky Coordinates** | Empty canvas or incomplete matrix. | Visual Coverage Matrix (Epochs $\times$ Bands); honest non-detection empty states; optional adaptive window widening ($w_b > 1/R_b$) with warning badge. |
| **Target Saturation (Barnard's Star)** | Corrupted centroiding and photometry. | HDU 2 `FLAGS` bitmask parsing (bit 1 `OVERFLOW`); automatic saturation badges and predicted-track overlays. |
| **WISE 0855 Undetectable in Single Pass** | No source visible to user. | Inverse-variance multi-exposure coadds in Bands D5/D6; explicit documented non-detection state with $5\sigma$ limiting flux. |
| **IRSA API Latency or Outage** | Slow response during judging. | Pre-cached static CDN benchmark bundle; SSE progress countdown streaming; 60s hard timeout with graceful partial return. |
| **Zero-Auth Security Abuse** | Spam or forged badges. | Cryptographic secret `observer_key` hash in DB; read-only `/admin` default; mutating operations behind server-held `ADMIN_TOKEN`. |
| **Database Memory Exhaustion** | 500 MB Supabase free tier blowout. | Dropped `pgvector` from P0; in-memory NumPy cosine similarity (<10 MB RAM, $<20\,\text{ms}$). |
| **Scope Creep** | Unfinished core requirements. | Strict sequential gating: Day-0 Spikes $\to$ Phase 1 (P0) $\to$ Phase 2 (P1) $\to$ Phase 3 (P2). Cut order: P3 Model Lab $\to$ Tab 4 Molecular Studio $\to$ Admin triage $\to$ Tab 5 forum polish $\to$ Tab 3 template overlays. **NEVER CUT P0.** |

### 11.2 Verification Matrix & Document Sign-Off

| Verification Item | Specification Anchor | Verification Method | Status |
|---|---|---|---|
| **Single Backend Engine** | Section 3.1 & 4.2 | `curl -fsS http://localhost:7860/api/health/live` returns 200. | **VERIFIED** |
| **Zero-Auth Key Authentication**| Section 7.1 | Mutating POST without headers rejected; valid SHA-256 accepted. | **VERIFIED** |
| **5 NASA Benchmark Precision** | Section 2.1 (FR-02) | Propagated 2025.5 coordinates match Gaia DR3 table to $<1''$. | **VERIFIED** |
| **WebGL2 Shader Uniform Linking**| Section 4.1 | Fragment shader compiles with declared uniforms and variance samplers.| **VERIFIED** |
| **Bounded Queue Concurrency** | Section 3.3 | Saturated queue ($N \ge 5$) responds with 503 and `Retry-After: 15`. | **VERIFIED** |
| **$0 Always-Warm Keep-Alive** | Section 9.3 | Cron ping updates `heartbeat.last_ping` on Supabase PostgreSQL. | **VERIFIED** |

*Architectural Blueprint locked and verified against repository ground truth.*
