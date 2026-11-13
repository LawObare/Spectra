---
name: spectra-protocol
description: "Mandatory engineering protocol for all agents working on the Spectra repository. Enforces SPECIFICATION.md as single source of truth, 4 sequential priority-gated phases, zero-auth route separation, lazy skill activation, anti-hallucination grounding, and maximum token efficiency."
---

# Spectra Engineering Protocol & Agent Governance

Use this skill whenever planning, building, or modifying code in the Spectra repository.

## 1. Single Source of Truth
- [`SPECIFICATION.md`](../../SPECIFICATION.md) is the master blueprint (v3.0.0-PROD).
- Never guess or extrapolate: coordinates, formulas, schemas, and UI layout wireframes are explicitly specified. Quote `file:line` before editing code.

## 2. Priority-Gated Execution
Agents must strictly obey the phase sequence preceded by Day-0 Spikes. Never work on Phase 2/3/4 until the prior phase's Milestone Gate is verified:
0. **Day-0 Spikes (Gating):** S1 (IRSA collection & parameter resolution), S2 (Benchmark exposure coverage matrices & saturation check), S3 (IRSA Cutout API vs S3 byte-range latency benchmark).
1. **Phase 1 (P0): Core NASA Challenge Foundation**
   - Tab 1 (Navigator / Aladin Lite v3 with MOC) + Tab 2 (Time-Domain Comparator / WebGL2 Float32 multi-epoch player, wavelength-matched difference mode, coverage matrix).
   - 5 NASA benchmark targets (recomputed coordinates: Barnard's Star, WISE 0855, Epsilon Indi B, RW Aurigae, R Draconis).
   - Single FastAPI backend (`uv`) on port 7860, local Supabase DB.
   - *Milestone Gate 1:* Core NASA challenge 100% satisfied with honest non-detection states.
2. **Phase 2 (P1): Scientific Differentiator**
   - Tab 3 (Spectrophotometric Lab, 102 channels, `uPlot`, rest-frame redshift ruler) + Tab 5 (Discussions with SSE live stream).
   - In-memory NumPy spectral cosine similarity (<20 ms) against reference libraries.
3. **Phase 3 (P2): Institutional Polish**
   - Tab 4 (Molecular & Ice Studio, point-source column density $N_{\text{ice}}$, verified laboratory $A$-values).
   - Admin Mission Control Tabs 1–5 (`/admin`, read-only default) + synthetic injection calibration loop.
4. **Phase 4: Production Deployment & Hardening**
   - Single-service HF Space Dockerfile + Cloudflare Pages CDN + Supabase Session Pooler RLS + keep-alive pinger.

## 3. Zero-Auth Identity & Security
- Never build login dialogs or blocking JWT walls.
- Separate `/explore` from `/admin`.
- Inject `X-Observer-ID` and secret `X-Observer-Key` headers on mutating requests. Store only `sha256(observer_key)` in database.
- `/admin` is read-only by default (`ADMIN_MUTATIONS_ENABLED=false`). Mutating requires server-held `ADMIN_TOKEN`.
- Verified admin replies receive gold `[Moderator]` badge.
- All exported data products carry `Community Product` label (no false NASA endorsement).

## 4. Token & Workflow Efficiency
- **Terse communication:** Strip conversational filler. Use dense, factual concise responses.
- **Lazy skill activation:** Do not read skill files unless actively performing that exact task.
- **Surgical edits:** Use `edit_file` with exact match strings for small diffs; avoid re-writing large files.
- **Targeted reads:** Read specific line ranges (`StartLine`/`EndLine`).
- **Subagents:** Offload heavy file scanning or documentation surveys to subagents with lightweight models.
- **Compaction:** Run `/compact` after completing each Phase milestone to reset context window.
