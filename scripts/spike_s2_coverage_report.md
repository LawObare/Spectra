# Spike S2 — NASA Benchmark Coverage Matrices, Survey Pass MJDs & Saturation

- **Generated (UTC):** 2026-11-09T18:32:50.944839+00:00
- **IRSA Collection:** `spherex_qr2`
- **Search radius:** 127.2792" (180" FoV padded by sqrt(2) on half-diagonal)
- **Spec anchors:** SPECIFICATION.md §2.2, SPECIFICATION.md §7, SPECIFICATION.md §8

## Global Survey Passes (MJD clusters)

| Pass | MJD start | MJD end | Duration (days) | Total exposures | Targets covered |
|---|---:|---:|---:|---:|---:|
| pass_01 | 60789.854522 | 61053.415626 | 263.561104 | 1047 | 5 |
| pass_02 | 61091.718616 | 61237.874234 | 146.155618 | 591 | 5 |

## Barnard's Star (M4V Red Dwarf)

- Coords (Epoch 2025.5): RA=269.44639°, Dec=4.76676°
- SIA2 status: `ok` | exposures: 253 | bands seen: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']
- Notes: Check Bit 1 OVERFLOW saturation in D1-D3; motion 10.39"/yr North.

### Coverage matrix N_exp(Epoch, Band)

| Epoch | D1 | D2 | D3 | D4 | D5 | D6 | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| pass_01 | 24 | 23 | 18 | 25 | 22 | 18 | 130 |
| pass_02 | 19 | 19 | 24 | 18 | 19 | 24 | 123 |
| **TOTAL** | **43** | **42** | **42** | **43** | **41** | **42** | **253** |

## WISE 0855-0714 (Y4 Sub-Brown Dwarf (T_eff ~250 K))

- Coords (Epoch 2025.5): RA=133.73712°, Dec=-7.24038°
- SIA2 status: `ok` | exposures: 257 | bands seen: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']
- Notes: Check single-pass vs inverse-variance coadd SNR in D5/D6; faint <3.5 um.

### Coverage matrix N_exp(Epoch, Band)

| Epoch | D1 | D2 | D3 | D4 | D5 | D6 | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| pass_01 | 22 | 33 | 24 | 22 | 33 | 22 | 156 |
| pass_02 | 15 | 15 | 21 | 14 | 15 | 21 | 101 |
| **TOTAL** | **37** | **48** | **45** | **36** | **48** | **43** | **257** |

## Epsilon Indi B (T1+T6 Brown Dwarf Binary)

- Coords (Epoch 2025.5): RA=331.09566°, Dec=-56.80031°
- SIA2 status: `ok` | exposures: 344 | bands seen: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']
- Notes: Verify 1/cos(delta) corrected center hits target pixel; unresolved 0.7" binary.

### Coverage matrix N_exp(Epoch, Band)

| Epoch | D1 | D2 | D3 | D4 | D5 | D6 | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| pass_01 | 26 | 64 | 52 | 25 | 51 | 48 | 266 |
| pass_02 | 21 | 8 | 12 | 19 | 7 | 11 | 78 |
| **TOTAL** | **47** | **72** | **64** | **44** | **58** | **59** | **344** |

## RW Aurigae (Classical T Tauri Star)

- Coords (Epoch 2025.5): RA=76.95647°, Dec=30.4013°
- SIA2 status: `ok` | exposures: 226 | bands seen: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']
- Notes: Check multi-epoch coverage across D1-D6; stationary flashing monopole.

### Coverage matrix N_exp(Epoch, Band)

| Epoch | D1 | D2 | D3 | D4 | D5 | D6 | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| pass_01 | 19 | 19 | 19 | 19 | 19 | 17 | 112 |
| pass_02 | 19 | 19 | 19 | 19 | 19 | 19 | 114 |
| **TOTAL** | **38** | **38** | **38** | **38** | **38** | **36** | **226** |

## R Draconis (Mira-type Pulsating AGB (P=245d))

- Coords (Epoch 2025.5): RA=248.16773°, Dec=66.75504°
- SIA2 status: `ok` | exposures: 558 | bands seen: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']
- Notes: 8.61 deg from NEP; record dense MJD visit cadence.

### Coverage matrix N_exp(Epoch, Band)

| Epoch | D1 | D2 | D3 | D4 | D5 | D6 | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| pass_01 | 69 | 76 | 50 | 67 | 75 | 46 | 383 |
| pass_02 | 24 | 19 | 45 | 24 | 19 | 44 | 175 |
| **TOTAL** | **93** | **95** | **95** | **91** | **94** | **90** | **558** |

## Saturation Audit (Barnard's Star, D1-D3, OVERFLOW bit 1 / 0x0002)

- Summary: D1: overflow_fraction=0.009259 (3/324 px) | D3: overflow_fraction=0.015432 (5/324 px) — OVERFLOW pixels detected in audited D1-D3 cutouts.
- D1 `2025W35_1A_0432_4`: status=ok, overflow_fraction=0.009259, http_bytes=5060160, error=None
- D2 `2025W34_1B_0557_1`: status=error, overflow_fraction=None, http_bytes=0, error=HTTP Error 422: Unprocessable Content
- D3 `2025W33_2C_0321_1`: status=ok, overflow_fraction=0.015432, http_bytes=5060160, error=None

## Detection Depth Audit (WISE 0855-0714, D5/D6)

- Method: IRSA cutout central-pixel signal/variance proxy; inverse-variance coadd SNR estimated from per-exposure variance
- Summary: D5: single-pass SNR proxy~8.8569, n=2, inverse-variance coadd proxy~12.3724; D6: single-pass SNR proxy~6.4619, n=2, inverse-variance coadd proxy~12.3655. D5/D6 are the relevant detection bands for this faint Y4 target; non-detection in single pass may be honest if SNR is low.
- D5 `2025W19_1B_0181_1`: status=ok, snr_proxy=8.8569, signal_mean=0.369799, variance_mean=0.001743, error=None
- D5 `2025W19_1B_0181_2`: status=ok, snr_proxy=8.6622, signal_mean=0.33356, variance_mean=0.001483, error=None
- D6 `2025W19_1B_0116_1`: status=ok, snr_proxy=6.4619, signal_mean=0.946514, variance_mean=0.021455, error=None
- D6 `2025W19_1B_0116_2`: status=ok, snr_proxy=10.5789, signal_mean=0.801791, variance_mean=0.005744, error=None

## Acceptance Criteria Evaluation

- [x] `survey_passes_json_generated_from_real_mjd_clusters`: True
- [x] `coverage_matrix_epochs_x_6_bands_verified_for_5_targets`: True
- [x] `barnards_overflow_documented`: True
- [x] `wise_0855_detection_depth_documented`: True
- [x] `all_targets_queried_ok`: True
