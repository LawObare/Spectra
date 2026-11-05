# Spectra Agent Governance & Engineering Protocol

> **MANDATORY FOR ALL AI CODING AGENTS WORKING IN THIS REPOSITORY.**  
> This file is the primary system instruction. Every agent must strictly adhere to the constraints, standards, and phase gates defined below.

---

## 1. Single Source of Truth

- **The Law of the Repo:** [`SPECIFICATION.md`](SPECIFICATION.md) (v3.0.0-PROD) is the authoritative, immutable specification.
- **No Guessing / No Hallucinating:** Never guess conventions, architecture, database schemas, or coordinates. All mathematical formulas, WCS reprojection steps, 32-bit FLAGS masks, and component contracts are already defined in `SPECIFICATION.md`.
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

## 6. Multi-Agent Swarm Protocol (6-Engineer Team Isolation)

You are 1 of 6 concurrent AI coding agents operating on `LawObare/Spectra`. Uncoordinated edits, invented interfaces, or out-of-scope file modifications will break sibling agents' builds. Follow these rules without exception:

### 6.1 1-to-1 Developer-to-Role Bijection, Zero Cross-Role Poaching & Branch Isolation
1. **The 1-to-1 Developer-to-Role Bijection Rule (No Two Devs on the Same Role):**
   - Each of the 6 roles (`E1`–`E6`) is locked **1-to-1** to **strictly one human developer's GitHub username and Git email** in [`tasks.md` §0.1](tasks.md). Two developers may **never** share, split, or simultaneously work the same role (`E1`–`E6`), and one developer may **never** claim two roles.
   - **Mandatory Pre-Flight Identity Check:** Before reading or writing code for Issue `#<N>`, you **must** run:
     ```bash
     gh api user --jq .login && git config user.email
     gh issue list --label <role-label-of-issue-N> --json number,assignees
     ```
   - Verify your operator's GitHub username/email against the Role Lock Roster in [`tasks.md` §0.1](tasks.md) and the GitHub assignees for that `role:E*` label. If another developer (`@other_user`) is already registered to that role in [`tasks.md`](tasks.md) or assigned to issues under that `role:E*` label on GitHub, **refuse and halt immediately**:
     > *"STOP: Role `<E_k>` (`<role:E_k-*>`) is already locked to `@<existing_owner>`. Under the 1-to-1 Developer-to-Role Bijection Rule (`AGENTS.md` §6.1 & `tasks.md` §0.1), two developers cannot take the same role."*
2. **The Zero Cross-Role Poaching Rule ([`tasks.md`](tasks.md) is Law):**
   - Every GitHub Issue (`#1`–`#30`) has **strictly one owner role (`E1`–`E6`)** assigned by domain relevance in [`tasks.md`](tasks.md):
     - **`E1` (`role:E1-astro`):** `#3, #9, #10, #11, #19` (5 issues)
     - **`E2` (`role:E2-backend`):** `#5, #7, #8, #12, #22` (5 issues)
     - **`E3` (`role:E3-webgl`):** `#1, #17, #18, #27` (4 issues)
     - **`E4` (`role:E4-frontend`):** `#14, #15, #16, #23` (4 issues)
     - **`E5` (`role:E5-datasci`):** `#2, #20, #21, #25, #26` (5 issues)
     - **`E6` (`role:E6-devops`):** `#4, #6, #13, #24, #28, #29, #30` (7 issues)
   - **Mandatory Agent Refusal:** Before writing any code, verify your human operator's role (`E1`–`E6`) against [`tasks.md`](tasks.md). If prompted to implement an issue or modify files owned by another developer's role, **refuse and halt immediately**:
     > *"STOP: Issue `#<N>` (`<path>`) is locked to Role `<Owner>` in `tasks.md`. Under the Zero Cross-Role Poaching Rule (`AGENTS.md` §6.1), I cannot execute another developer's assigned job."*
3. **Bind to Exactly One GitHub Issue (`#1`–`#30`):** Before reading or writing code, run `gh issue view <N> --comments` to load your assigned issue's Specification Anchors, Target Files, Acceptance Criteria, and any upstream agent handover notes.
4. **Never Cross Issue Boundaries:** Do not implement features belonging to another issue or phase.
5. **Two-Tier Branching Model (`feat/*` $\rightarrow$ `develop` $\rightarrow$ `main`):**
   - **`develop` is the High-Frequency Integration Trunk:** All agents branch off `develop`, rebase onto `develop`, and open PRs targeting `develop` (`--base develop`) as soon as an issue is verified.
   - **`main` is the Milestone Release Trunk:** Individual feature branches **never** target or commit to `main`. Only verified Milestone Gate batches (`Phase 0`, `Phase 1`, `Phase 2`, `Phase 3`, `Phase 4`) are promoted from `develop` $\rightarrow$ `main`.
   - Always start your issue branch from the latest `develop`:
     ```bash
     git checkout develop && git pull --ff-only origin develop
     git checkout -b feat/issue-<N>-<short-slug>
     ```

### 6.2 Strict File Write-Fences (Blast-Radius Control)
Each agent role has an **Exclusive Write Territory** matching [`tasks.md`](tasks.md). You are **forbidden** from modifying files outside your role's territory:

| Agent Role Label | Assigned Issues | Allowed Write Paths | Forbidden Paths (Read-Only) |
|---|---|---|---|
| `role:E1-astro` | `#3, #9, #10, #11, #19` | `backend/science/{wave_match,reproject,centroid,wave}.py`, `backend/api/spectrum.py`, `scripts/spike_s3_*`, `backend/tests/test_science_{wave_match,reproject,centroid,wave}.py` | `backend/db/*`, `backend/science/{ingest,injector,similarity}.py`, `web-client/*` |
| `role:E2-backend` | `#5, #7, #8, #12, #22` | `backend/main.py`, `backend/db/*`, `backend/cache/*`, `backend/science/ingest.py`, `backend/api/{resolve,cutout,auth,classify}.py`, `backend/tests/{test_sql,test_api_*,test_science_ingest}.py` | `backend/science/{wave_match,reproject,centroid,wave,injector,similarity}.py`, `backend/ml/*`, `web-client/*` |
| `role:E3-webgl` | `#1, #17, #18, #27` | `scripts/spike_s1_irsa.py`, `backend/config/{flags,detectors}.json`, `web-client/src/shaders/*`, `web-client/src/workers/*`, `web-client/src/tabs/TimeDomainComparator.tsx`, `web-client/src/components/WebGLComparatorCanvas.tsx`, `web-client/src/admin/{AdminLayout,TrainingDynamics,ActivationInspector,DecisionBoundaries}.tsx`, `web-client/src/admin/hooks/useAdminTelemetry.ts` | `backend/{api,db,science,ml}/*`, `web-client/src/store/*` |
| `role:E4-frontend` | `#14, #15, #16, #23` | `web-client/src/App.tsx`, `web-client/src/store/*`, `web-client/src/hooks/*`, `web-client/src/components/{GlobalCommandHeader,CommandPalette}.tsx`, `web-client/src/tabs/{CelestialNavigator,ObservationDiscussions}.tsx`, `backend/api/forum.py`, `backend/tests/test_api_forum.py` | `backend/science/*`, `web-client/src/shaders/*`, `web-client/src/admin/*`, `web-client/src/tabs/{TimeDomainComparator,SpectrophotometricLab,MolecularIceStudio}.tsx` |
| `role:E5-datasci` | `#2, #20, #21, #25, #26` | `scripts/spike_s2_benchmarks.py`, `backend/config/survey_passes.json`, `web-client/src/tabs/{SpectrophotometricLab,MolecularIceStudio}.tsx`, `backend/science/similarity.py`, `backend/ml/*`, `backend/admin_ws.py`, `backend/data/*.json` | `backend/api/*`, `backend/db/*`, `web-client/src/store/*`, `web-client/src/admin/*` |
| `role:E6-devops` | `#4, #6, #13, #24, #28, #29, #30` | `backend/science/injector.py`, `backend/tests/test_science_injector.py`, `web-client/src/admin/{HardNegativeTriage,DataProductExports}.tsx`, `backend/api/export.py`, `backend/tests/test_api_export.py`, `scripts/{build_benchmark_bundle,verify_bundle_security,smoke_test}.py`, `benchmarks/*`, `.github/workflows/*`, `Dockerfile`, `start.sh`, `Taskfile.yml`, `web-client/public/benchmarks/*`, `backend/db/{seed_benchmarks,rls_lockdown}.sql` | `backend/science/{ingest,wave_match,reproject,centroid,wave,similarity}.py`, `backend/api/{resolve,cutout,auth,classify,forum,spectrum}.py`, `web-client/src/tabs/*` |

- **Shared File Lock Rule:** Once Issue `#4` (Scaffold) and Issue `#14` (Zustand Store & URL Hooks) are merged, `backend/pyproject.toml`, `backend/uv.lock`, `web-client/package.json`, `web-client/src/store/useTelemetryStore.ts`, and `web-client/src/hooks/useSpectraUrlState.ts` are **FROZEN**.
- **No Unapproved Package Installs:** Never run `uv add <pkg>` or `npm install <pkg>` after Issue `#4`. Modifying lockfiles on feature branches guarantees merge conflicts across all 6 agents.

### 6.3 Immutable Wire & Memory Contracts (Zero Naming Drift)
1. **Binary Tensor Stream (`GET /api/cutout/{task_id}/tensor`):**
   - Bytes `0..3`: Little-endian `uint32` byte length $L$ of UTF-8 JSON header.
   - Bytes `4..(4+L-1)`: UTF-8 JSON header (`shape: [N_epochs, N_bands, H, W]`, `crval`, `cdelt`, `mjd_ranges`, `exposure_ids`, `release`, `source_badge`, `compression`).
   - Binary planes in exact order: `FLUX` (`float32`), `VARIANCE` (`float32`), `FLAGS` (`uint32`), `N_EXPOSURES` (`uint16`) = **14 bytes/pixel**.
2. **URL Query Keys (`nuqs`):** Strictly `tab`, `ra`, `dec`, `fov`, `cadence`, `mode`, `preset`, `z`, `px`, `py`, `embed`.
3. **Zero-Auth Headers:** Strictly `X-Observer-ID` (UUIDv4) and `X-Observer-Key` (32-byte hex secret). Zero `@supabase/supabase-js` or Supabase anon keys in browser bundles.

---

## 7. Pre-Merge Code Review, Technical Handover Summary & Merge Protocol

Every agent must execute this exact 4-step sequence before merging an issue branch into `develop`:

### 7.1 Step 1: Rebase & Local Verification Gate
1. Rebase onto the latest `origin/develop` so integration conflicts are resolved on your feature branch, never on `develop`:
   ```bash
   git fetch origin develop && git rebase origin/develop
   ```
2. Run all applicable verification checks:
   - Backend checks: `cd backend && uv run ruff check . && uv run pytest`
   - Frontend build: `cd web-client && npm run build`
   - Blast-radius check: `git status --short && git diff --stat origin/develop...HEAD` (confirm zero untracked scratch files, zero lockfile churn, and zero edits outside your role's territory in §6.2).

### 7.2 Step 2: Mandatory Dual-Axis Pre-Merge Code Review (`code-review` Skill)
Before opening or merging a PR into `develop`, load and execute [`.agents/skills/code-review/SKILL.md`](.agents/skills/code-review/SKILL.md) against `origin/develop`:
- **Axis 1 — Standards Review:** Verify compliance with `AGENTS.md` (write-fences, zero-auth headers, frozen lockfiles, no hardcoded secrets).
- **Axis 2 — Spec Review:** Verify compliance with [`SPECIFICATION.md`](SPECIFICATION.md) equations, wire contracts, and all acceptance criteria in `gh issue view <N>`.
- **Zero Unresolved Blockers:** Fix every Standards or Spec violation uncovered by the review before proceeding to Step 3.

### 7.3 Step 3: Mandatory 5-Block Technical Handover Summary (For Sibling Bots)
Because 6 agents work concurrently off `develop`, you must leave a dense, zero-fluff technical record of what you built so sibling agents can consume your interfaces via `gh issue view <N> --comments` without reading your entire source tree. Post this exact **5-Block Technical Handover Summary** in the PR body **and** as a comment on Issue `#<N>` (`gh issue comment <N>`):

```markdown
## Agent Handover Summary — Issue #<N> (Role <E1–E6>)
1. **Spec Anchors Implemented:** `SPECIFICATION.md §X.Y` (exact formulas, headers, or UI states implemented).
2. **Files Touched (`git diff --stat origin/develop...HEAD`):**
   - `path/to/file` (+A/-B): Concise description of changes.
3. **Exported Contracts & Signatures (For Sibling Bots):**
   - Exact Python functions/classes, FastAPI routes, or TypeScript props/hooks exposed on `develop`.
4. **Verification & Code Review Verdict:**
   - Exact `pytest` / `ruff` / `npm run build` output + `code-review` (Standards: PASS, Spec: PASS).
5. **Downstream Integration Notes:**
   - Any assumptions, environment variables, or edge cases sibling roles (`E1`–`E6`) need when pulling `develop`.
```

### 7.4 Step 4: Fast Merge to `develop`, Issue Closure & Batch Promotion to `main`
1. **Open PR to `develop` & Merge Immediately Once Green:**
   ```bash
   gh pr create --base develop --title "feat(phase-X): <summary> (#<N>)" --body-file <handover.md>
   gh pr merge --squash --delete-branch
   ```
2. **Mandatory Issue Closure Immediately Upon PR Merge (`gh issue close <N>`):**
   - **THE HARD RULE FOR ALL BOTS:** The moment a PR is successfully merged into `develop`, the agent **MUST immediately close the associated GitHub Issue `#<N>`**. Leaving an issue in `OPEN` status after PR merge is a protocol violation.
   - Because GitHub only auto-closes issues when merging into the default branch (`main`), bots must explicitly run:
     ```bash
     gh issue comment <N> --body-file <handover.md>
     gh issue close <N> --comment "✅ Verified, dual-axis code-reviewed, and squash-merged into \`develop\`. Issue officially CLOSED."
     ```
   - **Verification Check:** Every bot must assert closure by verifying `gh issue view <N> --json state` returns `"state": "CLOSED"` before concluding work on that issue.
3. **Milestone Batch Promotion (`develop` $\rightarrow$ `main`):**
   - Only when all issues in a Phase Milestone (`Phase 0`, `Phase 1`, `Phase 2`, `Phase 3`, `Phase 4`) are closed on `develop` and verified end-to-end does the team promote the batch to `main`:
     ```bash
     gh pr create --base main --head develop --title "release(team-phase-X): promote verified Phase X milestone batch to main"
     gh pr merge --merge
     ```

---

## 8. Commit Hygiene & Mandatory Commit Message Templates

Every human developer and AI coding agent must adhere to strict commit hygiene enforced by [`.gitmessage`](.gitmessage) and the automated [`.githooks/commit-msg`](.githooks/commit-msg) hook (`git config core.hooksPath .githooks`). Non-compliant commits are automatically rejected by Git.

### 8.1 Hard Commit Hygiene Rules
1. **Explicit File Staging Only (`git add <file1> <file2>`):** Never run blind `git add .` or `git add -A`. Explicitly stage only the target files within your role's write-fence (§6.2) so `.env` files, scratch scripts, or lockfile drift are never staged.
2. **Atomic, Compiling Commits:** Every commit must leave the branch in a syntactically valid, passing state. Never commit debug `print()` / `console.log()` statements or commented-out code blocks.
3. **Zero Trash / WIP Messages:** Single-word or vague messages (`wip`, `fix`, `update`, `changes`, `test`, `final`, `asdf`) and single-line code commits without a structured body are strictly forbidden and blocked by `.githooks/commit-msg`.
4. **Subject Line Grammar (`<= 90 chars`):**
   ```text
   <type>(<role>-<scope>): <imperative present-tense summary> (#<issue-id>)
   ```
   - **`<type>`:** `feat` | `fix` | `perf` | `test` | `refactor` | `docs` | `chore` | `ci` | `release`
   - **`<role>`:** `e1` | `e2` | `e3` | `e4` | `e5` | `e6` | `team`
   - **`<scope>`:** `phase-0` | `phase-1` | `phase-2` | `phase-3` | `phase-4` | `science` | `api` | `db` | `webgl` | `ui` | `ml` | `devops` | `governance`
   - **`(#<issue-id>)`:** Mandatory for all `e1`–`e6` commits (`#1`–`#30`).

### 8.2 Mandatory Commit Message Templates

#### Template A: Feature / Issue Implementation Commit (`feat`, `perf`, `test`)
Use when committing verified implementation work on `feat/issue-<N>-<slug>`:
```text
feat(e1-phase-1): implement pre-reprojection HDU 6 WAVE-TAB wavelength matcher (#9)

Spec-Anchor: SPECIFICATION.md §3.1, §4.1
Role-Owner: E1 (role:E1-astro)
Changes:
- backend/science/wave_match.py: add filter_wavelength_matched_exposures(exposures, ra, dec, adaptive_window)
- backend/tests/test_science_wave_match.py: verify R_b window filtering and adaptive widening
Verification: uv run ruff check . && uv run pytest backend/tests/test_science_wave_match.py (6 passed in 0.42s)
```

#### Template B: Bugfix / Pre-Merge Code-Review Remediation Commit (`fix`, `refactor`)
Use when addressing findings from the [`code-review`](.agents/skills/code-review/SKILL.md) skill or fixing a bug:
```text
fix(e2-api): enforce 15s Retry-After header on full cutout queue (#12)

Spec-Anchor: SPECIFICATION.md §3.2 (Bounded Queue & HTTP 503 Backpressure)
Role-Owner: E2 (role:E2-backend)
Root-Cause: HTTP 503 response omitted Retry-After header flagged during Axis-2 Spec review
Changes:
- backend/api/cutout.py: attach headers={"Retry-After": "15"} on QueueFull exception
- backend/tests/test_api_cutout.py: assert Retry-After header on 6th concurrent POST /api/cutout
Verification: uv run ruff check . && uv run pytest backend/tests/test_api_cutout.py (8 passed)
```

#### Template C: Milestone Batch Promotion Commit (`release` — `develop` $\rightarrow$ `main`)
Use when promoting a verified Phase Milestone batch from `develop` into `main`:
```text
release(team-phase-1): promote verified Phase 1 P0 milestone batch to main

Milestone: Phase 1 — P0 Core NASA Challenge Foundation (Gate 1 Verified)
Issues-Included: #5, #6, #7, #8, #9, #10, #11, #12, #13, #14, #15, #16, #17, #18
Verification:
- Backend: uv run ruff check . && uv run pytest (100% pass)
- Frontend: npm run build (0 errors, zero leaked keys)
- Gate-1 Smoke: All 5 NASA benchmarks + live RA/Dec verified in Tab 1 & Tab 2
```

---

## 9. Zero-Deferral & Anti-Hallucination Execution Proof Protocol (Mandatory for All Models & Flash Subagents)

To make it physically and structurally impossible for any model (especially `flash` / `flash_lite`) to defer work, spend an entire turn on research without editing, or falsely claim changes were made:

1. **The Edit-Before-Claim Hard Lock:**
   - An agent is **strictly forbidden** from stating or implying that code was modified, fixed, or updated unless an `edit_file` or `write_file` tool call **succeeded in that exact turn** (or a verified commit hash from that turn is quoted).
   - If zero `edit_file` / `write_file` calls succeeded in the turn, the agent **must** begin its response with:
     > `STATUS: NO FILES MODIFIED IN THIS TURN.`
2. **Hard Cap on Pre-Edit Reconnaissance (`<= 2` Read Calls):**
   - When the user asks for a code change or says *"yes"* / *"do it"*, the agent may execute **at most 2 `read_file` calls** before calling `edit_file`.
   - Spending a turn on web searches, browser subagents, or multi-file reads and then ending the turn without editing the target file is a **critical protocol violation**.
3. **Mandatory Machine-Verifiable Execution Proof Block:**
   - Every response that claims a code change **must** end with this exact proof block populated from real tool outputs in the same turn:
     ```text
     [EXECUTION PROOF]
     - Tool Call: edit_file / write_file on <path> (+A/-B lines)
     - Build/Test: <exact command & exit code>
     - Git Commit / Diff: <commit SHA or git status --short output>
     ```
   - Any agent or `flash` subagent response lacking `[EXECUTION PROOF]` is automatically treated as **unexecuted / rejected**.


---

## 9. Zero-Deferral & Anti-Hallucination Execution Proof Protocol (Mandatory for All Models & Flash Subagents)

To make it physically and structurally impossible for any model (especially `flash` / `flash_lite`) to defer work, spend an entire turn on research without editing, or falsely claim changes were made:

1. **The Edit-Before-Claim Hard Lock:**
   - An agent is **strictly forbidden** from stating or implying that code was modified, fixed, or updated unless an `edit_file` or `write_file` tool call **succeeded in that exact turn** (or a verified commit hash from that turn is quoted).
   - If zero `edit_file` / `write_file` calls succeeded in the turn, the agent **must** begin its response with:
     > `STATUS: NO FILES MODIFIED IN THIS TURN.`
2. **Hard Cap on Pre-Edit Reconnaissance (`<= 2` Read Calls):**
   - When the user asks for a code change or says *"yes"* / *"do it"*, the agent may execute **at most 2 `read_file` calls** before calling `edit_file`.
   - Spending a turn on web searches, browser subagents, or multi-file reads and then ending the turn without editing the target file is a **critical protocol violation**.
3. **Mandatory Machine-Verifiable Execution Proof Block:**
   - Every response that claims a code change **must** end with this exact proof block populated from real tool outputs in the same turn:
     ```text
     [EXECUTION PROOF]
     - Tool Call: edit_file / write_file on <path> (+A/-B lines)
     - Build/Test: <exact command & exit code>
     - Git Commit / Diff: <commit SHA or git status --short output>
     ```
   - Any agent or `flash` subagent response lacking `[EXECUTION PROOF]` is automatically treated as **unexecuted / rejected**.

