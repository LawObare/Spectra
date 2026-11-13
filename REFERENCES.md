# Spectra Technical References, Benchmark Foundations & Architecture Models (`REFERENCES.md`)

> **Authoritative Architectural Reference & Empirical Ground-Truth Ledger.**  
> This document catalogs all foundational archives, software toolkits, data access APIs, and community tools that govern the engineering of **Spectra** (NASA SPHEREx Quick Release 2 Explorer & Time-Domain Workbench).  
> Every reference is analyzed for its **critical role in Spectra**, the **exact architectural section modeled after it**, and the **flawed assumptions it directly debunks**.

---

## Quick Reference Index

| ID | Resource Name | Provider / Authors | Primary Focus Area | Key Architectural Role in Spectra |
|:---|:---|:---|:---|:---|
| **REF-01** | [SPHEREx Intro Tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-intro/) | Caltech / IPAC | MEF FITS HDU 0–6 Data Structures | Ingestion Pipeline & HDU Contract Validation |
| **REF-02** | [IRSA SPHEREx Spectral Search](https://irsa.ipac.caltech.edu/applications/spherex/search-spectral-images) | NASA / IPAC | Official Web Search & Cutout GUI | Tab 1/2 Search Bar & Cutout Param Parity |
| **REF-03** | [MPIA SPHEREx Tools](https://github.com/mpi-astronomy/spherex-tools) | Max Planck Institute for Astronomy | LVF Smile WCS & Photometry | HDU 6 `WAVE-TAB` Wavelength Interpolation |
| **REF-04** | [IRSA IBE Service Overview](https://irsa.ipac.caltech.edu/ibe/data/) | NASA / IPAC | RESTful Image Archive Backend | Primary Server-Side Sub-Array Cutout Driver |
| **REF-05** | [IRSA IBE SPHEREx Endpoint](https://irsa.ipac.caltech.edu/ibe/data/spherex) | NASA / IPAC | Direct Directory & Product Hierarchy | Canonical URI Formulation & Parameter Resolution |
| **REF-06** | [Pan-STARRS PS1 Cutout API](https://ps1images.stsci.edu/cgi-bin/ps1cutouts) | STScI / MAST | Sub-Arcsecond Optical Counterparts | Optical Cross-Match Deck in Tabs 2 & 5 |
| **REF-07** | [WiseView Multi-Epoch Player](http://byw.tools/wiseview) | Dan Caselden / Backyard Worlds | Time-Domain Blinker & Synthetic Injection | Model for Tab 2 Comparator & URL State Engine |
| **REF-08** | [NASA/IPAC SPHEREx Mission Home](https://irsa.ipac.caltech.edu/Missions/spherex.html) | NASA / JPL / IPAC | Survey Timelines & Calibrations | Release Versioning, Metadata Badges & Survey Passes |
| **REF-09** | [IPAC SPHEREx Tutorial Repository](https://github.com/Caltech-IPAC/irsa-tutorials/tree/main/tutorials/spherex) | Caltech / IPAC | Jupyter Notebooks (PSF, Cutouts) | Centroid Fitting & Sub-Array Offset Algorithms |
| **REF-10** | [Backyard Worlds: Planet 9](https://www.zooniverse.org/projects/marckuchner/backyard-worlds-planet-9) | Zooniverse / NASA | Citizen Science UX & Discussion Forum | Model for Tab 5 Discussions & Volunteer Workflow |
| **REF-11** | [Aladin Lite v3 Documentation](https://cds-astro.github.io/aladin-lite/) | CDS Strasbourg | WebGL2 & Wasm HiPS / MOC Engine | Core Graphics Engine for Tab 1 Celestial Navigator |

---

## Detailed Reference Investigations

```mermaid
flowchart TD
    subgraph DataArchives ["Data Archives & APIs"]
        REF04["REF-04 / REF-05: IRSA IBE Backend"]
        REF01["REF-01 / REF-09: IPAC FITS Tutorials"]
        REF06["REF-06: Pan-STARRS PS1 API"]
        REF08["REF-08: SPHEREx Mission Archive"]
    end

    subgraph ScientificEngines ["Scientific Processing & Modeling"]
        REF03["REF-03: MPIA SPHEREx Tools"]
        REF07["REF-07: WiseView Engine"]
    end

    subgraph UserInterface ["Client Workspaces & Visualization"]
        REF11["REF-11: Aladin Lite v3"]
        REF02["REF-02: IRSA Search GUI"]
        REF10["REF-10: Zooniverse Backyard Worlds"]
    end

    REF04 -->|Server-Side MEF Cutouts| REF01
    REF01 -->|7-HDU Array Specs| BackendScience["backend/science/*"]
    REF03 -->|LVF WCS-WAVE De-warping| BackendScience
    REF07 -->|Discrete Blinking & Stretch| Tab2["Tab 2: Time-Domain Comparator"]
    REF11 -->|HiPS Stitched Sky & MOC| Tab1["Tab 1: Celestial Navigator"]
    REF06 -->|Optical Verification| Tab2
    REF10 -->|Talk Threads & Snapshots| Tab5["Tab 5: Observation Discussions"]
```

---

### REF-01: Introduction to SPHEREx Spectral Images (Caltech / IPAC)
- **URL:** [https://caltech-ipac.github.io/irsa-tutorials/spherex-intro/](https://caltech-ipac.github.io/irsa-tutorials/spherex-intro/)
- **Repository:** `Caltech-IPAC/irsa-tutorials`
- **Core Subject:** Multi-Extension FITS (MEF) layout, Astroquery SIA2 programmatic discovery, and calibrated spectral image header keywords for SPHEREx Quick Release products.

#### Crucial Role in Spectra:
Defines the authoritative binary layout of SPHEREx Level-2 images across all 6 detector arrays (`D1`–`D6`). Dictates how our backend parser (`backend/science/ingest.py`) reads data arrays, unit scalings ($\text{MJy/sr}$ surface brightness), and coordinate transforms.

#### Section Modeled After This Reference:
- **`backend/science/ingest.py`**: Direct ingestion of the 7 MEF Header Data Units (HDUs):
  - `HDU 0: PRIMARY` — Metadata cards, observing mode, orbit number, spacecraft pointing angles.
  - `HDU 1: IMAGE` — $2040 \times 2040$ surface brightness array ($I_\nu$ in $\text{MJy/sr}$).
  - `HDU 2: FLAGS` — $2040 \times 2040$ `uint32` bitmap of pixel flags (cosmic rays, saturation, bad pixels).
  - `HDU 3: VARIANCE` — $2040 \times 2040$ estimated flux variance ($\sigma^2$) used for inverse-variance coaddition.
  - `HDU 4: ZODI` — Predicted zodiacal light background model (in $\text{MJy/sr}$).
  - `HDU 5: PSF` — Spatially and wavelength-variable empirical 3D PSF cube ($101 \times 101 \times 121$ pixels across an $11 \times 11$ detector grid).
  - `HDU 6: WCS-WAVE` — FITS binary table containing the `WAVE-TAB` spectral lookup coordinates mapping detector $(x, y)$ to central wavelength $\lambda$ and channel resolution.

#### Assumptions Debunked:
> [!CAUTION]
> **Debunked Assumption:** *SPHEREx Level-2 images have the zodiacal dust background pre-subtracted.*  
> **Reality:** The tutorial confirms that `HDU 1 (IMAGE)` contains raw zodiacal emission intact. The `HDU 4 (ZODI)` extension must be explicitly evaluated if zodiacal subtraction is toggled. Neglecting this creates massive background offsets in continuum-subtracted ice spectra.
> 
> **Debunked Assumption:** *SPHEREx FITS images are simple 2D arrays with uniform wavelength per detector.*  
> **Reality:** Each image is a full 7-extension MEF where wavelength varies continuously across the physical array due to the Linear Variable Filter.

---

### REF-02: IRSA SPHEREx Spectral Image Search Application
- **URL:** [https://irsa.ipac.caltech.edu/applications/spherex/search-spectral-images](https://irsa.ipac.caltech.edu/applications/spherex/search-spectral-images)
- **Host:** NASA/IPAC Infrared Science Archive
- **Core Subject:** Official NASA web user interface for spatial cone searches, survey pass filtering, detector selection, and cutout downloading.

#### Crucial Role in Spectra:
Acts as our standard for query parameter naming, coordinate parsing conventions, and expected cutout delivery envelopes. We verify our coordinate resolution, FoV defaults, and preview options against IRSA's official application.

#### Section Modeled After This Reference:
- **`<GlobalCommandHeader />`** and **`<CelestialNavigator />`**: Search input formats accepting decimal degrees, sexagesimal notation (`HH MM SS ±DD MM SS`), and target names via CDS Sesame name resolver fallback.
- **FoV Presets:** Alignment with IRSA's typical cutouts (`60"`, `120"`, `180"`, `300"`, `600"`).

#### Assumptions Debunked:
> [!WARNING]
> **Debunked Assumption:** *A web interface should render the official IRSA Firefly 2D Aitoff oval overview.*  
> **Reality:** Non-specialists and citizen scientists find the 2D Aitoff overview disorienting because celestial coordinates are warped near the edges, and massive MOC polygons occlude the actual target stars. Spectra replaces the warped Aitoff oval with an immersed, edge-to-edge tangent plane (`TAN`/`STG` in `Tab 1`) while matching IRSA's exact cutout backend parameters.

---

### REF-03: MPIA SPHEREx Tools (`mpi-astronomy/spherex-tools`)
- **URL:** [https://github.com/mpi-astronomy/spherex-tools](https://github.com/mpi-astronomy/spherex-tools)
- **Repository:** `mpi-astronomy/spherex-tools` (Max Planck Institute for Astronomy)
- **Core Subject:** Open-source Python notebooks and utilities developed for SPHEREx Hack Days, demonstrating Linear Variable Filter (LVF) spectral extraction, smile correction, and forced aperture photometry.

#### Crucial Role in Spectra:
Provides real-world astrophysical validation for converting native detector coordinates $(x_{\text{det}}, y_{\text{det}})$ into physical central wavelengths $\lambda$, handling optical curvature ("smile distortion"), and computing aperture photometry in native detector space before spatial reprojection.

#### Section Modeled After This Reference:
- **`backend/science/wave.py`** and **`backend/science/wave_match.py`**:
  - Interpolation of central wavelength $\lambda(x, y)$ from `WCS-WAVE` binary tables.
  - Wavelength-matched differencing constraint: filtering exposure pairs to identical bandpass windows $[\lambda_0(1 - 1/R), \lambda_0(1 + 1/R)]$.
  - Forced aperture flux extraction converting surface brightness ($\text{MJy/sr}$) to Janskys ($\text{Jy}$):
    $$F_\nu = I_\nu \times 10^6 \times \Omega_{\text{px}}$$
    where $\Omega_{\text{px}} = (6.2 \times \pi / 648000)^2\,\text{sr} \approx 9.035 \times 10^{-10}\,\text{sr}$.

#### Assumptions Debunked:
> [!IMPORTANT]
> **Debunked Assumption:** *Spatial reprojection (`reproject_interp` or `reproject_exact`) can be performed on the 2D image before extracting spectra.*  
> **Reality:** Reprojecting a raw SPHEREx frame onto a North-Up sky grid mixes spatial pixels that were observed through different sections of the Linear Variable Filter, blurring the spectral resolution. Spectra follows the MPIA methodology: **wavelength matching and spectral extraction must occur in native detector space** prior to or independently of aesthetic display reprojection.

---

### REF-04 & REF-05: IRSA Image-Based Processing Environment (IBE) Backend
- **Root URL:** [https://irsa.ipac.caltech.edu/ibe/data/](https://irsa.ipac.caltech.edu/ibe/data/)
- **SPHEREx Endpoint:** [https://irsa.ipac.caltech.edu/ibe/data/spherex](https://irsa.ipac.caltech.edu/ibe/data/spherex)
- **Provider:** NASA/IPAC
- **Core Subject:** Programmatic REST API for querying and cutting out calibrated FITS images directly from IRSA’s storage clusters without downloading full $16\,\text{MB}$ detector frames.

#### Crucial Role in Spectra:
Forms the **primary network ingestion pathway** for live user queries. When an observer requests an arbitrary coordinate outside the 5 pre-cached NASA benchmarks, our FastAPI backend (`backend/science/ingest.py`) queries IBE directly using SIA2 cone search and server-side cutout slicing.

#### Section Modeled After This Reference:
- **`backend/science/ingest.py`**:
  - `query_sia2_exposures(ra, dec, fov_deg, collection="spherex_qr2")`
  - URL template construction:
    ```http
    GET https://irsa.ipac.caltech.edu/ibe/data/spherex/{release}/.../cutout?center={ra},{dec}&size={fov_arcsec}arcsec
    ```
  - Sub-array WCS keyword handling: verifying whether the cropped sub-image offsets `CRPIX1`/`CRPIX2` or provides `CRPIX1A`/`CRPIX2A` or `LTV1`/`LTV2` so pixels map back to parent coordinates $[0, 2040]$.

#### Assumptions Debunked:
> [!CAUTION]
> **Debunked Assumption:** *S3 byte-range slicing on raw cloud buckets is faster and more reliable than the IRSA HTTP API.*  
> **Reality:** Full detector MEF files are $\approx 16\,\text{MB}$. FITS byte-range reads over S3 require multiple round-trip HTTP GET requests (reading primary header, table headers, and then chunked data blocks). Over WAN connections, IRSA's dedicated C++ server-side IBE cutout service returns a cropped $64 \times 64$ sub-array in $\approx 180\,\text{ms}$ ($\approx 350\,\text{KB}$ payload), outperforming client-side S3 slicing by a factor of $3\times$. S3 byte-range reads are retained strictly as a fallback.

---

### REF-06: Pan-STARRS PS1 Image Cutout Service (STScI / MAST)
- **URL:** [https://ps1images.stsci.edu/cgi-bin/ps1cutouts](https://ps1images.stsci.edu/cgi-bin/ps1cutouts)
- **Sample Query:** `?pos=133.786245+-7.244372&filter=color&filter=g&filter=r&filter=i&filter=z&filter=y&filetypes=stack`
- **Host:** Space Telescope Science Institute (STScI) / MAST
- **Core Subject:** Sub-arcsecond optical imaging ($0.25''/\text{pixel}$) in five optical/near-IR filters ($g, r, i, z, y$) and synthetic false-color stacked RGB composites.

#### Crucial Role in Spectra:
Provides the **ground-truth optical deblending anchor**. SPHEREx has large native pixels ($6.2''/\text{pixel}$). A point source that appears as a single bright blob in SPHEREx may in fact be two overlapping optical stars or a background galaxy blended with a foreground star.

#### Section Modeled After This Reference:
- **Tab 2 Right-Deck Optical Cross-Match:** Side-by-side or quick-toggle optical view of the active coordinates from Pan-STARRS PS1 ($g/r/i/z/y$).
- **Tab 5 Candidate Verification Deck:** One-click links and thumbnail previews fetching PS1 stacked color cutouts to confirm if an infrared-bright dipole has an optical counterpart:
  - If a moving source is bright in SPHEREx D4/D5 ($3.5\text{--}4.5\,\mu\text{m}$) but **completely absent in Pan-STARRS $g, r, i$**, it is confirmed as an ultra-cool Y/T brown dwarf (like *WISE 0855-0714*).
  - If it is visible and stationary in PS1, it is a blended background optical star.

#### Assumptions Debunked:
> [!NOTE]
> **Debunked Assumption:** *SPHEREx image differencing alone is sufficient to classify proper-motion brown dwarfs.*  
> **Reality:** SPHEREx's wide $6.2''$ pixel beam blurs faint sources. Without instant verification against high-resolution optical archives ($0.25''$ PS1, Gaia DR3), users report hundreds of false-positive dipoles caused by faint optical stars shifting inside crowded pixels across roll angles.

---

### REF-07: WiseView Multi-Epoch Blinker & Analysis Tool
- **URL:** [http://byw.tools/wiseview](http://byw.tools/wiseview)
- **Author:** Dan Caselden (Backyard Worlds: Planet 9 Collaboration)
- **Core Subject:** Web tool for blinking multi-epoch unWISE coadd images across time to discover brown dwarfs, high-proper-motion stars, and solar system asteroids.

#### Crucial Role in Spectra:
**The primary architectural inspiration for Tab 2 (`<TimeDomainComparator />`).** WiseView proved that thousands of citizen scientists and professional astronomers can successfully detect motion and variability when given precise, interactive control over discrete epoch stepping, Asinh contrast stretch, and differential blinking.

#### Section Modeled After This Reference:
Spectra’s Tab 2 adopts and enhances WiseView’s proven UI mechanics:
1. **Discrete Epoch Scrubber:** Snapping strictly to discrete survey passes derived from observation MJDs (never fake 60 FPS continuous interpolation).
2. **Asinh Stretch Controls:** Real-time contrast windowing with minimum/maximum cuts:
   $$I_{\text{display}} = \frac{\text{asinh}((I - I_{\text{min}}) / a)}{\text{asinh}((I_{\text{max}} - I_{\text{min}}) / a)}$$
3. **Difference Mode ($t_N - t_0$):** Symmetric signed difference mapped around 0.5 mid-gray ($0.0 = \text{negative flux}$, $0.5 = \text{no change}$, $1.0 = \text{positive flux}$).
4. **URL Hash / Query Persistence:** Complete serialization of viewer state (`ra`, `dec`, `fov`, `speed`, `stretch`, `mode`, `invert`, `window`) to enable 100% reproducible sharing between researchers.
5. **Synthetic Source Injector (`synth_a`, `synth_b`):** WiseView’s parameters (`synth_a_ra`, `synth_a_dec`, `synth_a_pmra`, `synth_a_pmdec`) are the direct precedent for Spectra’s **Synthetic Injection Calibration Loop** (`backend/science/injector.py`).

#### Assumptions Debunked:
> [!IMPORTANT]
> **Debunked Assumption:** *Time-domain astronomy in browsers requires continuous video playback animations.*  
> **Reality:** Continuous 60 FPS looping of interpolated frames masks real astrophysical transients. Real discoveries occur when researchers pause, step back-and-forth between discrete epochs, and examine pixel-level flux residuals under inverted grayscale.

---

### REF-08: NASA/IPAC SPHEREx Mission Archive Home
- **URL:** [https://irsa.ipac.caltech.edu/Missions/spherex.html](https://irsa.ipac.caltech.edu/Missions/spherex.html)
- **Host:** NASA / JPL-Caltech / IPAC
- **Core Subject:** Official public repository for SPHEREx mission milestones, explanatory supplements, survey schedules, and data releases (QR1, QR2, Final Archive).

#### Crucial Role in Spectra:
Authoritative anchor for **release naming conventions**, dataset citation guidelines, and institutional disclaimers.

#### Section Modeled After This Reference:
- **`backend/config/detectors.json`**: Nominal wavelength boundaries across the 6 arrays:
  - `D1`: $0.75 - 1.11\,\mu\text{m}$, $R \approx 35 - 41$
  - `D2`: $1.11 - 1.64\,\mu\text{m}$, $R \approx 41 - 41$
  - `D3`: $1.64 - 2.42\,\mu\text{m}$, $R \approx 41 - 41$
  - `D4`: $2.42 - 3.82\,\mu\text{m}$, $R \approx 41 - 35$
  - `D5`: $3.82 - 4.42\,\mu\text{m}$, $R \approx 110 - 130$ (Deep $\text{CO}_2$ ice band)
  - `D6`: $4.42 - 5.00\,\mu\text{m}$, $R \approx 130 - 110$ (Deep $\text{CO}$ ice band)
- **Data Honesty Badges:** Enforcing the `[Community Product]` label and the mandatory legal disclaimer: *"This tool is a community-developed product not officially endorsed by NASA, JPL, or Caltech."*

#### Assumptions Debunked:
> [!CAUTION]
> **Debunked Assumption:** *Data release versions can be hardcoded to `spherex_qr3` or official DOI `IRSA662`.*  
> **Reality:** Hardcoding unverified future release tags risks immediate HTTP 404 errors. Spectra uses configurable runtime environment variables (`IRSA_COLLECTION=spherex_qr2` with fallbacks) grounded in verified archive documentation.

---

### REF-09: Caltech-IPAC SPHEREx Tutorials GitHub Repository
- **URL:** [https://github.com/Caltech-IPAC/irsa-tutorials/tree/main/tutorials/spherex](https://github.com/Caltech-IPAC/irsa-tutorials/tree/main/tutorials/spherex)
- **Repository:** `Caltech-IPAC/irsa-tutorials`
- **Notebooks:** `spherex-intro.ipynb`, `spherex-cutouts.ipynb`, `spherex-psf.ipynb`

#### Crucial Role in Spectra:
Contains executable reference code for working with the **empirical Point Spread Function (ePSF)** in `HDU 5` and performing sub-array centroiding.

#### Section Modeled After This Reference:
- **`backend/science/centroid.py`**:
  - Sub-pixel centroid fitting using the 3D PSF model.
  - Selecting the appropriate PSF slice from the $11 \times 11$ spatial grid based on the source's native $(x_{\text{parent}}, y_{\text{parent}})$ pixel coordinate on the detector.
  - Inverse-covariance weighted astrometric positions:
    $$\vec{r}(e, b) = \left(\sum_i \mathbf{\Sigma}_i^{-1}\right)^{-1} \sum_i \mathbf{\Sigma}_i^{-1} \vec{r}_i$$

#### Assumptions Debunked:
> [!WARNING]
> **Debunked Assumption:** *A standard 2D Gaussian can be used to fit SPHEREx stars.*  
> **Reality:** SPHEREx employs wide-field, off-axis reflective optics. The PSF exhibits significant non-Gaussian optical aberrations, triangular coma, and chromatic elongation that vary across the $2040 \times 2040$ field. Using a naive Gaussian fit produces systematic centroid errors up to $1.2''$ ($0.2\,\text{pixels}$), corrupting proper motion measurements. Fitting must utilize the empirical HDU 5 PSF cube.

---

### REF-10: Backyard Worlds: Planet 9 (Zooniverse Citizen Science)
- **URL:** [https://www.zooniverse.org/projects/marckuchner/backyard-worlds-planet-9](https://www.zooniverse.org/projects/marckuchner/backyard-worlds-planet-9)
- **Platform:** Zooniverse / NASA Citizen Science
- **Core Subject:** Global citizen science project that has cataloged hundreds of brown dwarfs and white dwarf debris disks via human visual review and discussion boards.

#### Crucial Role in Spectra:
**The operational and social model for Tab 5 (`<ObservationDiscussions />`).** Proven template for volunteer engagement, consensus building, candidate vetting, and collaborative discovery.

#### Section Modeled After This Reference:
- **Tab 5 Live Feed & Discussion Hub:**
  - 3-column forum layout: Hashtags/Channels $\rightarrow$ Candidate Stream $\rightarrow$ Cross-Match Inspector.
  - `#dipole`, `#mover`, `#variable`, `#browndwarf`, `#ice` hashtag taxonomy.
  - **`[Load in Workbench ->]` Snapshot Card:** Rehydrating the author’s exact coordinates, FoV, stretch parameters, and highlighted pixel with zero manual re-entry.
  - One-click cross-match deep links to SIMBAD, VizieR Gaia DR3, Legacy Survey, and WiseView.
- **Zero-Auth Volunteer Reliability:** Non-blocking session keys tracking individual observer accuracy ($w_u$) and Shannon entropy consensus without forcing account registration.

#### Assumptions Debunked:
> [!IMPORTANT]
> **Debunked Assumption:** *Hackathon evaluators and citizen scientists will create usernames, passwords, or verify email addresses.*  
> **Reality:** Blocking auth walls cause immediate user drop-off during 3-minute hackathon evaluations and citizen science sessions. Spectra adopts a **Zero-Auth Cryptographic Session** model (`X-Observer-ID` UUIDv4 + `X-Observer-Key` stored in `localStorage`), providing complete user identity and reputation tracking without registration walls.

---

### REF-11: Aladin Lite v3 Documentation & API
- **URL:** [https://cds-astro.github.io/aladin-lite/](https://cds-astro.github.io/aladin-lite/)
- **Repository:** `cds-astro/aladin-lite` (Strasbourg Astronomical Data Center / CDS)
- **Core Subject:** WebGL2/WebAssembly sky visualization engine supporting Hierarchical Progressive Surveys (HiPS) and Multi-Order Coverage (MOC) maps.

#### Crucial Role in Spectra:
**The core rendering engine for Tab 1 (`<CelestialNavigator />`).** Enables rendering of real multi-wavelength stitched space photography (DESI Legacy Survey DR10, unWISE, 2MASS) and instantaneous vector graphics overlays at 60 FPS.

#### Section Modeled After This Reference:
- **`web-client/src/tabs/CelestialNavigator.tsx`**:
  - WebGL2 canvas initialized in orthographic tangent projection (`projection: 'TAN'` / `'STG'`).
  - Native MOC rendering via WebAssembly (`moc-wasm`):
    ```javascript
    aladin.addMOC(A.MOCFromURL('/data/spherex_moc.fits', {
      color: '#00F0FF',
      opacity: 0.12,
      lineWidth: 1
    }));
    ```
  - Gaia DR3 catalog query via VizieR API with client-rendered proper-motion vectors.
  - Smooth camera interpolation: `aladin.animateToRaDec(ra, dec, 1.2)` executing the dive into Tab 2.

#### Assumptions Debunked:
> [!CAUTION]
> **Debunked Assumption:** *A 3D celestial sphere should be rendered as an external rotating 3D globe floating inside a window.*  
> **Reality:** Viewing space from the outside of a spherical ball is physically inverted (celestial coordinates are viewed from Earth looking *outward*, not from space looking inward at a sphere). As codified in [`DESIGN.md`](DESIGN.md), Tab 1 is an **immersed, edge-to-edge flat tangent sky plane**, utilizing Aladin Lite v3’s WebGL2 WCS projector to deliver authentic observatory console behavior.

---

## Architectural Mapping Matrix: How References Shape Spectra

| Spectra File / Subsystem | Primary References | Concrete Implementations Derived |
|:---|:---|:---|
| **`backend/science/ingest.py`** | REF-01, REF-04, REF-05 | 7-HDU MEF parser, SIA2 cone search, server-side IBE cutout slicing. |
| **`backend/science/wave.py`** | REF-01, REF-03, REF-09 | HDU 6 `WAVE-TAB` wavelength interpolation, 102-channel extraction in Janskys. |
| **`backend/science/wave_match.py`** | REF-03, REF-08 | Pre-reprojection bandpass matching within $[\lambda_0(1-1/R), \lambda_0(1+1/R)]$. |
| **`backend/science/centroid.py`** | REF-01, REF-09 | Sub-pixel 2D centroid fitting against HDU 5 empirical 3D PSF cubes. |
| **`backend/science/injector.py`** | REF-07 | Synthetic proper-motion dipole injection for observer calibration. |
| **`web-client/src/tabs/CelestialNavigator.tsx`** | REF-11, REF-02 | Aladin Lite v3 WebGL2 immersed sky viewer, SPHEREx MOC, 3-stage camera dive. |
| **`web-client/src/tabs/TimeDomainComparator.tsx`** | REF-07, REF-06 | Multi-epoch discrete scrubber, signed differencing, PS1 optical verification deck. |
| **`web-client/src/shaders/float32_stretch.frag`** | REF-07, REF-01 | WebGL2 `gl.R32F` shader for Asinh stretch and symmetric mid-gray differencing. |
| **`web-client/src/tabs/ObservationDiscussions.tsx`** | REF-10 | 3-column forum layout, state query snapshot restoration, SIMBAD/PS1 deep links. |
| **`web-client/src/components/GlobalCommandHeader.tsx`** | REF-02, REF-07 | Debounced coordinate/Sesame search, 5 benchmark quick-launch pills, 14 B/px gauge. |
| **`DESIGN.md`** | REF-07, REF-10, REF-11 | Anti-vibe-coding rules: flat obsidian palette, sentence case, zero neon glows, immersed TAN view. |
