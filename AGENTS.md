# Spectra Agent Governance & Engineering Protocol

> **MANDATORY FOR ALL AI CODING AGENTS WORKING IN THIS REPOSITORY.**  
> This file is the primary system instruction. Every agent must strictly adhere to the constraints, standards, and phase gates defined below.

---

## 1. Single Source of Truth

- **The Law of the Repo:** [`SPECIFICATION.md`](SPECIFICATION.md) (v3.0.0-PROD) is the authoritative, immutable specification.
- **No Guessing / No Hallucinating:** Never guess conventions, architecture, database schemas, or coordinates. All mathematical formulas, WCS reprojection steps, 12-bit FLAGS masks, and component contracts are already defined in `SPECIFICATION.md`.
- **Grounding Discipline:** Adhere to the `grounding-before-coding` skill:
  - Before writing code, inspect real implementations.
  - Quote `file:line` evidence for any load-bearing claim.
  - If a detail is missing, consult `SPECIFICATION.md` or ask the user—never invent an ad-hoc pattern.

---

## 2. Sequential Phase-Gating (The Iron Triangle)

Development proceeds in **four strictly sequential, priority-gated phases** preceded by mandatory Day-0 spikes (see `SPECIFICATION.md` Section 8). **Agents are forbidden from skipping ahead** or implementing Phase 2/3 features while Phase 1 is incomplete:

| Phase | Priority | Scope & Milestone Gate | Rule for Agents |
|---|---|---|---|
| **Day-0 Spikes** | **Gating** | **Feasibility & Ground-Truth Verification:** S1 (IRSA collection & parameter resolution), S2 (Benchmark exposure coverage matrices & saturation check), S3 (IRSA Cutout API vs S3 byte-range latency benchmark). | Complete before locking final network drivers. |
| **Phase 1** | **P0 (Must-Have)** | **Core NASA Challenge Foundation:** Tab 1 (Navigator/Aladin Lite v3 dome with MOC), Tab 2 (Time-Domain Comparator/WebGL2 Float32 multi-epoch player, Asinh stretch, wavelength-matched difference mode, coverage matrix), 5 NASA Benchmark Targets, universal coordinate input, single FastAPI backend (`uv`) on port 7860, local Supabase DB. | **FOCUS HERE FIRST.** Delivers 100% prompt compliance. Do not build Tab 3, Tab 4, or Admin tabs until Phase 1 passes Gate 1. |
| **Phase 2** | **P1 (Differentiator)** | **Science & Community Intelligence:** HDU 6 `WCS-WAVE` 102-channel spectral extraction, in-memory NumPy cosine similarity (<20 ms), Tab 3 (Spectrophotometric Lab with uPlot), Tab 5 (Discussions with backend SSE stream). | Start ONLY after Phase 1 is fully tested and verified against the 5 NASA benchmark targets. |
| **Phase 3** | **P2 (Polish)** | **Institutional Polish & Mission Control:** Tab 4 (Molecular & Ice Studio on point sources with verified lab A-values), Admin Mission Control Tabs 1–5 (`/admin`, read-only default), synthetic injection calibration loop. | Start ONLY after Phase 2 is verified. |
| **Phase 4** | **Deploy** | **Production Deployment & Hardening:** Hugging Face Space Dockerfile (single service, port 7860), Cloudflare Pages CDN, Supabase Session Pooler RLS, cron-job keep-alive, offline venue demo mirror. | Final packaging & judging freeze. |

---

## 3. Zero-Auth Identity & Route Separation

- **No Blocking Authentication:** Never add login screens, modal password prompts, or JWT blocking middleware for hackathon evaluators.
- **Route Isolation:**
  - Public citizen science suite lives under `/explore/*`.
  - Administrative mission control suite lives under `/admin/*`.
- **Client Telemetry Session Fingerprinting:**
  - Client retrieves/creates `localStorage.getItem('spx_observer_id')` (UUIDv4) and secret `localStorage.getItem('spx_observer_key')` (32-byte cryptographic string).
  - Frontend auto-attaches `X-Observer-ID` and `X-Observer-Key` headers on all mutating API calls.
  - Backend stores strictly `sha256(observer_key)` in the `observers` table (`key_hash`). Neither the raw key nor internal observer ID is exposed in public responses.
  - `/admin` is read-only by default (`ADMIN_MUTATIONS_ENABLED=false`). Mutating operations require server-held `ADMIN_TOKEN`.
  - Verified administrative discussion replies receive the gold `[Moderator]` badge.
  - All public outputs, catalogs, and artifacts are explicitly labeled `Community Product` (no false NASA endorsement).

---

## 4. Scientific & Data Standards

- **Binary Float32Array Standard:**
  - Science arithmetic (Asinh stretch, difference subtraction, inverse-variance coaddition) executes on raw IEEE-754 32-bit float buffers in WebGL2 shaders.
  - Base64 PNGs are strictly fallback previews for legacy browsers lacking WebGL2 float textures.
- **Wavelength-Matched Differencing:**
  - Differencing ($I_{\text{epoch } N} - I_{\text{epoch } 0}$) is strictly permitted **only between exposures within the same wavelength band window** $[\lambda_0(1-w), \lambda_0(1+w)]$. Cross-band differencing is physically invalid and disabled in the UI.
- **Discrete Survey Epochs:**
  - Never implement fake 60 FPS continuous animations. The temporal scrubber snaps to discrete survey passes derived from observation exposure MJDs.
- **Data Honesty Badges:**
  - Every displayed target and spectrum must render an institutional source badge (`[NASA Benchmark (Pre-cached)]`, `[IRSA Live (<collection>)]`, or `[Synthetic Injection Mode]`).
- **5 Mandatory NASA Benchmark Targets:**
  1. *Barnard's Star:* M4V, `269.44639°, +4.76676°`, moves $+10.39''/\text{yr} = 1.68\,\text{px/yr}$ North.
  2. *WISE 0855-0714:* Y4, `133.73712°, -7.24038°`, faint $<3.5\,\mu\text{m}$, moves $8.15''/\text{yr}$ West; detected in D5/D6 coadds or honest non-detection.
  3. *Epsilon Indi B:* T1+T6, `331.09566°, -56.80031°`, moves $4.68''/\text{yr} = 0.76\,\text{px/yr}$ SE (corrected $1/\cos \delta$, eliminating 46″ error); unresolved binary within single 6.2″ pixel.
  4. *RW Aurigae:* T Tauri, `76.95647°, +30.40130°`, stationary flashing monopole ($>1.5\,\text{mag}$ dimming).
  5. *R Draconis:* Mira AGB, `248.16773°, +66.75504°`, stationary pulsing monopole ($245\,\text{d}$ cycle; $8.61°$ from NEP).

---

## 5. Token Efficiency & Agent Collaboration Rules

To conserve token budgets and maximize engineering throughput across model sessions:

1. **Terse Communication Style (Caveman Voice):**
   - Output facts, code, and diffs only. Strip conversational filler ("Certainly!", "I'd be glad to help!"). Answer first, explain only when requested.
2. **Lazy Skill Activation:**
   - Skills installed in `.agents/skills/` are loaded on-demand. **Do not proactively read all skills.**
   - Only load `supabase-postgres-best-practices` when modifying SQL migrations.
   - Only load `grounding-before-coding` when investigating bugs or touching unfamiliar files.
   - Only load `code-review` when evaluating a git commit or phase completion.
3. **Surgical Tool Calls:**
   - Use `edit_file` with exact target strings for small diffs. Avoid re-writing multi-thousand-line files with `write_file`.
   - Use `read_file` with `StartLine` and `EndLine` parameters rather than dumping entire files into context.
4. **Subagent Delegation for Heavy Tasks:**
   - Delegate large read-only documentation searches or test runs to subagents (`invoke_subagent` using lighter models like `flash`). Let the subagent return a dense 3-line summary.
5. **Periodic Context Compaction:**
   - Recommend `/compact` after completing each Phase milestone to flush obsolete tool execution history while keeping architecture intact.

---

## 6. Pre-Commit Verification Checklist

Before claiming any task or phase is complete, the agent must verify:
- [ ] Code strictly matches the interfaces in [`SPECIFICATION.md`](SPECIFICATION.md).
- [ ] `task dev` launches without compilation errors across Python and React.
- [ ] No hardcoded passwords, tokens, or JWT walls blocking access.
- [ ] Changes are committed with conventional commit messages (`feat:`, `fix:`, `docs:`, `refactor:`).
