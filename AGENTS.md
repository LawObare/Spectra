# Spectra Agent Governance & Engineering Protocol

> **MANDATORY FOR ALL AI CODING AGENTS WORKING IN THIS REPOSITORY.**  
> This file is the primary system instruction. Every agent must strictly adhere to the constraints, standards, and phase gates defined below.

---

## 1. Single Source of Truth

- **The Law of the Repo:** [`SPECIFICATION.md`](SPECIFICATION.md) (v2.5.0-PROD) is the authoritative, immutable specification.
- **No Guessing / No Hallucinating:** Never guess conventions, architecture, database schemas, or coordinates. All mathematical formulas, WCS reprojection steps, 12-bit FLAGS masks, and component contracts are already defined in `SPECIFICATION.md`.
- **Grounding Discipline:** Adhere to the `grounding-before-coding` skill:
  - Before writing code, inspect real implementations.
  - Quote `file:line` evidence for any load-bearing claim.
  - If a detail is missing, consult `SPECIFICATION.md` or ask the user—never invent an ad-hoc pattern.

---

## 2. Sequential Phase-Gating (The Iron Triangle)

Development proceeds in **four strictly sequential, priority-gated phases** (see `SPECIFICATION.md` Section 8). **Agents are forbidden from skipping ahead** or implementing Phase 2/3 features while Phase 1 is incomplete:

| Phase | Priority | Scope & Milestone Gate | Rule for Agents |
|---|---|---|---|
| **Phase 1** | **P0 (Must-Have)** | **Core NASA Challenge Foundation:** Tab 1 (Navigator/Aladin 3D dome), Tab 2 (Blinker/WebGL2 Float32 multi-epoch player, Asinh stretch, difference mode $t_N - t_0$), 5 NASA Benchmark Targets, universal coordinate input, Python worker (`uv`), Go gateway (`air`), local Supabase DB (`seed_benchmarks.sql`). | **FOCUS HERE FIRST.** Delivers 100% prompt compliance. Do not build Tab 3, Tab 4, or Admin tabs until Phase 1 passes all verification gates. |
| **Phase 2** | **P1 (Differentiator)** | **Science & Community Intelligence:** HDU 6 `WCS-WAVE` 102-channel spectral extraction, `pgvector` HNSW cosine similarity search ($<2\,\text{ms}$), Tab 3 (Spectrophotometric Lab), Tab 5 (Discussions with Supabase Realtime). | Start ONLY after Phase 1 is fully tested and verified against the 5 NASA benchmark targets. |
| **Phase 3** | **P2 (Polish)** | **Institutional Polish & Mission Control:** Tab 4 (Molecular & Ice Studio), Admin Mission Control Tabs 1–5 (`/admin`), live PyTorch WebSocket training streamer (`/api/admin/ws/training`). | Start ONLY after Phase 2 is verified. |
| **Phase 4** | **Deploy** | **Production Deployment & Hardening:** Hugging Face Space Dockerfile, Cloudflare Pages CDN, Supabase Cloud RLS, cron-job keep-alive, offline venue demo mirror. | Final packaging & judging freeze. |

---

## 3. Zero-Auth Identity & Route Separation

- **No Blocking Authentication:** Never add login screens, modal password prompts, or JWT blocking middleware for hackathon evaluators.
- **Route Isolation:**
  - Public citizen science suite lives under `/explore/*`.
  - Administrative mission control suite lives under `/admin/*`.
- **Client Telemetry Session Fingerprinting:**
  - Client retrieves/creates `localStorage.getItem('spx_observer_id')` (UUIDv4 + celestial callsign like `Observer-Vega-409`).
  - Frontend auto-attaches `X-Observer-ID` and `X-Observer-Callsign` headers on all API calls.
  - Go session middleware (`middleware.ObserverSessionMiddleware`) upserts into the `observers` table, tracking calibration weights ($w_u$) without passwords.
  - Actions or discussion replies originating from `/admin` automatically set `posted_from_admin = TRUE` and receive the gold `[Verified by Science Team]` badge.

---

## 4. Scientific & Data Standards

- **Binary Float32Array Standard:**
  - Science arithmetic (Asinh stretch, difference subtraction $t_N - t_0$, inverse-variance coaddition) executes on raw IEEE-754 32-bit float buffers in WebGL2 shaders.
  - Base64 PNGs are strictly fallback previews for legacy browsers lacking WebGL2 float textures.
- **Discrete Survey Epochs:**
  - Never implement fake 60 FPS continuous animations. The temporal scrubber snaps to discrete 6-month survey passes (`Pass 1: 2025-05`, `Pass 2: 2025-11`, `Pass 3: 2026-05`).
- **Data Honesty Badges:**
  - Every displayed target and spectrum must render an institutional source badge (`[NASA Benchmark Target]`, `[IRSA Live Query]`, or `[Synthetic Injection Mode]`).
- **5 Mandatory NASA Benchmark Targets:**
  1. *Barnard's Star:* M4V, `269.446410°, +4.766860°`, moves $+10.36''/\text{yr}$ North.
  2. *WISE 0855-0714:* Y4, `133.737400°, -7.240380°`, faint $<3.5\,\mu\text{m}$, moves Westward in Band D5 ($4.1-4.4\,\mu\text{m}$).
  3. *Epsilon Indi B:* T1+T6, `331.072400°, -56.800310°`, moves $4.8''/\text{yr}$ SE; renders Gaia DR3 sub-pixel centroid reticle ($0.77\,\text{px/yr}$).
  4. *RW Aurigae:* T Tauri, `76.956470°, +30.401290°`, stationary flashing monopole ($>1.5\,\text{mag}$ dimming).
  5. *R Draconis:* Mira AGB, `248.167690°, +66.755040°`, stationary pulsing monopole ($245\,\text{d}$ cycle; $8.61°$ from NEP).

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
- [ ] `task dev` launches without compilation errors across Go, Python, and React.
- [ ] No hardcoded passwords, tokens, or JWT walls blocking access.
- [ ] Changes are committed with conventional commit messages (`feat:`, `fix:`, `docs:`, `refactor:`).
