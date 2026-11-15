# Spectra in Plain Language

This guide explains Spectra in plain but still technical terms. It is a companion to [`README.md`](../README.md): the README is the fast overview, and this document explains the ideas behind it without assuming deep astronomy or GPU knowledge.

**Live demo:** [https://spectra-seven-opal.vercel.app/](https://spectra-seven-opal.vercel.app/)

---

## 1. The Short Version

Spectra is a web app for looking at the same patch of sky at different times and asking two questions:

1. **What changed?** A star may move, brighten, dim, or disappear between two observations.
2. **What is it made of?** A spectrum splits an object's light into many narrow wavelength bands. The pattern of dips and peaks hints at temperature, dust, ice, and chemistry.

NASA's SPHEREx mission provides both kinds of data. Spectra makes that data usable in a browser without requiring a login, a local data pipeline, or a research-grade workstation.

---

## 2. What "Time-Domain" Means

Astronomers call a series of observations taken at different times a **time-domain** dataset. Each observation is an **epoch**. Comparing epochs is often called **blinking**, because the earliest sky-survey viewers literally flipped between two photographic plates.

A blinking viewer is only useful if the same star lands on the same screen pixel in every frame. Raw spacecraft images do not guarantee that: the telescope rolls, the detector is rotated, and the projection changes. Spectra fixes the geometry first, then lets you blink.

---

## 3. What "102 Channels" Means

A normal camera records three broad color bands: red, green, and blue. SPHEREx records **102 narrow infrared bands** between 0.75 µm and 5.00 µm.

Think of it as a data cube:

```
width × height × 102 wavelengths = one spectral data cube
```

For each spatial pixel, the mission stores a small spectrum. Spectra can plot that spectrum, compare it with template spectra, and look for features such as water ice or carbon monoxide.

---

## 4. Why the Raw Data Is Tricky

### 4.1 Sky projections bend shapes

The sky is a sphere. Any flat map of it distorts something. Wide all-sky projections (Aitoff, for example) stretch objects near the edges. Spectra works in a **tangent plane** (`TAN` projection) around the target, where small patches of sky behave almost like a normal flat image.

### 4.2 The spacecraft rolls

Each SPHEREx exposure has its own rotation angle. If you blink two raw frames, the entire star field appears to spin. The fix is to **reproject** every frame onto a common north-up grid before comparison.

### 4.3 The filter is a rainbow across the detector

SPHEREx uses a **Linear Variable Filter (LVF)**. The wavelength passing through the filter changes continuously along the detector's Y axis. This is sometimes called the **"smile"** because the wavelength solution curves. A raw detector cutout therefore mixes wavelengths: the top of the image is not the same color as the bottom.

The archive stores the wavelength calibration in an HDU 6 `WCS-WAVE` table. Spectra inverts that table to recover a real spectrum for each source.

### 4.4 One pixel covers a lot of sky

SPHEREx pixels are about **6.2 arcseconds** across. In crowded regions, several stars can fall into one pixel. Spectra uses centroid fitting and template unmixing to separate some of these blends, and it says so honestly when it cannot.

---

## 5. How a Request Flows Through the App

This is the path from a click to a rendered image or spectrum.

1. **The browser loads.** The app creates a local observer identity in `localStorage` (`spx_observer_id`, `spx_observer_key`). There is no login screen.
2. **The URL describes the view.** Query parameters such as `tab`, `ra`, `dec`, `fov`, `mode`, and `epoch` are parsed by `nuqs`, so every view is shareable as a link.
3. **The backend resolves the target.** `backend/api/resolve.py` accepts coordinates or an object name and decides which survey passes and collections are relevant.
4. **The archive is queried.** `backend/science/ingest.py` talks to IRSA using SIA2 discovery and the IRSA Cutout API. The default collection is `spherex_qr3`; `IRSA_COLLECTION=spherex_qr2` switches to QR2.
5. **Cutouts arrive.** The archive returns FITS cutouts and metadata, including exposure MJDs.
6. **Frames are reprojected.** `backend/science/reproject.py` maps each detector footprint onto a common north-up tangent plane so the star field stops rotating.
7. **The data is packed as a tensor.** The backend streams a binary payload:
   - 4 bytes: length `L` of a UTF-8 JSON header.
   - `L` bytes: header with `shape` (`[N_epochs, N_bands, H, W]`), `crval`, `cdelt`, `mjd_ranges`, `exposure_ids`, `release`, `source_badge`, and `compression`.
   - Then the pixel planes: `FLUX` (float32), `VARIANCE` (float32), `FLAGS` (uint32), and `N_EXPOSURES` (uint16), for **14 bytes per pixel**.
8. **The GPU does the math.** `web-client/src/shaders/float32_stretch.frag` applies the Asinh stretch and difference subtraction directly to 32-bit float textures in WebGL2. There is no lossy conversion to 8-bit images.
9. **Spectra are extracted.** `backend/science/wave_match.py` selects exposures whose wavelength coverage matches the requested band. `backend/science/wave.py` evaluates the `WCS-WAVE` calibration and produces 102 calibrated flux channels.
10. **Spectra can be compared.** `backend/science/similarity.py` runs an in-memory NumPy cosine search over template spectra, typically in under 20 ms.
11. **Community and admin features attach to the same state.** Discussions stream over FastAPI SSE (`/api/forum/stream`). Admin pages read training telemetry and export data products.

---

## 6. The Public Tabs in Plain Terms

| Tab | Plain description |
|---|---|
| **Celestial Navigator** | A full-window sky map. Pan anywhere, zoom from wide fields to about one arcminute, and see the SPHEREx coverage footprint. |
| **Time-Domain Comparator** | The blink tool. Pick two or more epochs, adjust the brightness stretch, and subtract one image from another to reveal movement or variability. |
| **Spectrophotometric Lab** | A spectrum viewer. Plots the 102 channels, shows error bars, can animate through epochs, and can compare a spectrum with known templates. |
| **Molecular & Ice Mapping Studio** | An ice-analysis tool. Measures absorption features from background stars and converts them into ice column densities using laboratory constants. |
| **Observation Discussions** | A science forum. Threads can carry the exact sky view that produced them, so a reply opens the same target and epoch. |

The `/admin` portal mirrors this with five model- and data-focused tabs. It is read-only by default; mutating actions need the server-side `ADMIN_TOKEN`.

---

## 7. The Five Benchmark Targets and What They Test

Each benchmark stresses a different failure mode.

| Target | What it validates |
|---|---|
| **Barnard's Star** | Fast proper motion (1.68 px/yr north) and bright-star saturation handling. |
| **WISE 0855-0714** | A very faint brown dwarf below 3.5 µm. The correct result may be an honest non-detection. |
| **Epsilon Indi B** | A blended binary inside one 6.2″ pixel, plus a proper-motion correction that depends on declination (`1/cos δ`). |
| **RW Aurigae** | A stationary source that changes brightness by more than 1.5 magnitudes, testing difference imaging rather than motion. |
| **R Draconis** | A stationary pulsating Mira variable with a 245-day cycle, testing multi-epoch spectral animation. |

If a release returns no usable data, the UI must say so. It must not substitute simulated pixels for real archive data.

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **SPHEREx** | NASA's near-infrared all-sky spectral survey mission. |
| **IRSA** | NASA/IPAC Infrared Science Archive, the data archive Spectra queries. |
| **SIA2** | Simple Image Access version 2, a standard protocol for discovering image products. |
| **Cutout** | A small piece of a larger image or data cube, requested by sky position and size. |
| **HDU** | Header/Data Unit, a FITS file section. SPHEREx spectra live in HDU 6. |
| **WCS** | World Coordinate System: the mapping between pixel coordinates and sky coordinates. |
| **TAN projection** | A tangent-plane projection that behaves like a flat map near a target. |
| **Reprojection** | Resampling an image onto a different pixel grid or projection. |
| **MOC** | Multi-Order Coverage map: a compact description of which sky regions a survey covers. |
| **LVF** | Linear Variable Filter: a filter whose wavelength changes across the detector. |
| **WCS-WAVE / smile** | The calibration that describes how wavelength varies across the detector. |
| **Epoch** | One observation at one time. |
| **MJD** | Modified Julian Date, a continuous day count used for observation times. |
| **Asinh stretch** | A brightness scaling that shows both faint and bright structure without clipping. |
| **Difference imaging** | Subtracting one epoch from another to reveal changes. |
| **Wavelength-matched** | Comparing only epochs whose wavelength coverage overlaps, because cross-band subtraction is physically meaningless. |
| **Inverse-variance co-add** | A weighted average that gives noisier pixels less influence. |
| **Coverage matrix** | A grid showing which epochs and bands actually contain usable data. |
| **Float32** | 32-bit floating-point numbers, used to keep scientific precision on the GPU. |
| **WebGL2 shader** | A small GPU program used here to apply stretch and subtraction in parallel. |
| **Tensor stream** | Spectra's binary format for sending multi-epoch image cubes to the browser. |
| **Proper motion** | A star's apparent angular movement across the sky, usually in arcseconds per year. |
| **Photo-z** | A redshift estimate inferred from broad-band colors rather than a full spectrum. |
| **Optical depth / column density** | Measures of how much absorbing material, such as ice, lies along the line of sight. |
| **A-value** | A laboratory coefficient that converts an absorption feature into an amount of ice. |
| **SPLICES** | An IRSA catalog used to seed background stars for ice studies. |
| **PSF / centroid** | The blurry shape of a point source, and the fitted center of that shape. |
| **SSE** | Server-Sent Events, a one-way live stream from the backend to the browser. |
| **RLS** | Row Level Security, a Postgres feature that limits which rows a client can read or write. |
| **Zero-auth** | No blocking login; identity is created locally and proven with hashed keys. |
| **UMAP / Grad-CAM** | Dimensionality reduction for latent-space views, and a saliency method for explaining model attention. |

---

## 9. Where the Code Lives

| Area | Path |
|---|---|
| FastAPI entry point | `backend/main.py` |
| Coordinate and target resolution | `backend/api/resolve.py` |
| Cutout requests and tensor streaming | `backend/api/cutout.py` |
| Spectrum responses | `backend/api/spectrum.py` |
| Coverage and section data | `backend/api/coverage.py`, `backend/api/sections.py` |
| Discussions and exports | `backend/api/forum.py`, `backend/api/export.py` |
| Archive ingestion | `backend/science/ingest.py` |
| Reprojection | `backend/science/reproject.py` |
| Wavelength matching and `WCS-WAVE` | `backend/science/wave_match.py`, `backend/science/wave.py` |
| Centroid fitting | `backend/science/centroid.py` |
| Spectral similarity | `backend/science/similarity.py` |
| Ice analysis | `backend/science/ice.py` |
| Synthetic injection and tests | `backend/science/injector.py` |
| Detector, flag, and pass configuration | `backend/config/` |
| Database schema and seeds | `backend/db/` |
| Public tab components | `web-client/src/tabs/` |
| WebGL comparator | `web-client/src/components/WebGLComparatorCanvas.tsx` |
| GPU shaders | `web-client/src/shaders/` |
| Tensor worker | `web-client/src/workers/tensorWorker.ts` |
| URL state and shared store | `web-client/src/hooks/`, `web-client/src/store/` |
| Feasibility spikes and bundle tools | `scripts/` |
| Checked-in benchmark fixtures | `benchmarks/` |

---

## 10. Real Data vs Simulated Fixtures

This distinction matters for judging and for science.

- **Live archive data:** fetched from IRSA through SIA2 and the Cutout API, reprojected, and streamed to the browser. This is what the time-domain viewer uses.
- **Checked-in benchmark fixtures:** `.f32` bundles used for tests and offline demos. They are clearly labelled simulated fixtures and are not presented as live observations.
- **Synthetic injection mode:** used to calibrate detection and recovery. It is labelled as synthetic wherever it appears.

Every displayed target carries a source badge such as `[NASA Benchmark (Pre-cached)]`, `[IRSA Live (<collection>)]`, or `[Synthetic Injection Mode]`.

---

## 11. Deployment and Operations

- **Live demo:** [https://spectra-seven-opal.vercel.app/](https://spectra-seven-opal.vercel.app/)
- **Production target:** a single FastAPI service on port 7860, a Cloudflare Pages frontend, and Supabase Postgres with Row Level Security.
- **Local development:** `task setup`, `task db:up`, `task types:sync`, then `task dev`.
- **Health checks:** `/api/health` is kept warm by a scheduled ping and a GitHub Actions backup.

For the full technical contract, see [`SPECIFICATION.md`](../SPECIFICATION.md) and [`SYSTEM_ARCHITECTURE.md`](../SYSTEM_ARCHITECTURE.md).
