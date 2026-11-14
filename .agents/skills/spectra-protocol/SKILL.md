---
name: spectra-protocol
description: "Mandatory engineering protocol for all agents working on the Spectra repository. Enforces SPECIFICATION.md as single source of truth, 4 sequential priority-gated phases, zero-auth route separation, lazy skill activation, anti-hallucination grounding, and maximum token efficiency."
---

# Spectra Engineering Protocol & Agent Governance

Use this skill whenever planning, building, or modifying code in the Spectra repository.

## 1. Single Source of Truth
- [`SPECIFICATION.md`](../../SPECIFICATION.md) is the master blueprint (v2.5.0-PROD).
- Never guess or extrapolate: coordinates, formulas, schemas, and UI layout wireframes are explicitly specified. Quote `file:line` before editing code.

## 2. Priority-Gated Execution
Agents must strictly obey the phase sequence. Never work on Phase 2/3/4 until the prior phase's Milestone Gate is verified:
1. **Phase 1 (P0): Core NASA Challenge Foundation**
   - Tab 1 (Navigator / Aladin 3D dome) + Tab 2 (Blinker / WebGL2 Float32 multi-epoch player).
   - 5 NASA benchmark targets (Barnard's Star, WISE 0855, Epsilon Indi B, RW Aurigae, R Draconis).
   - Python worker (`uv`), Go gateway (`air`), local Supabase DB (`seed_benchmarks.sql`).
   - *Milestone Gate 1:* Core NASA challenge 100% satisfied.
2. **Phase 2 (P1): Scientific Differentiator**
   - Tab 3 (Spectrophotometric Lab, 102 channels, `uPlot`, photo-$z$) + Tab 5 (Discussions with Supabase Realtime).
   - PostgreSQL `pgvector` HNSW vector similarity search (`vector(102)` cosine distance `<=>`).
3. **Phase 3 (P2): Institutional Polish**
   - Tab 4 (Molecular & Ice Studio, column density $N_{\text{ice}}$, laboratory rulers).
   - Admin Mission Control Tabs 1–5 (`/admin`) + live PyTorch WebSocket training streamer (`/api/admin/ws/training`).
4. **Phase 4: Production Deployment & Hardening**
   - HF Space Dockerfile + Cloudflare Pages CDN + Supabase Cloud RLS + keep-alive pingers.

## 3. Zero-Auth Identity
- Never build login dialogs or blocking JWT walls.
- Separate `/explore` from `/admin`.
- Ingest/inject `X-Observer-ID` and `X-Observer-Callsign` headers on every request.
- Auto-badge `/admin` actions with `posted_from_admin = TRUE`.

## 4. Token & Workflow Efficiency
- **Terse communication:** Strip conversational filler. Use dense, factual caveman-style responses.
- **Lazy skill activation:** Do not read skill files unless actively performing that exact task.
- **Surgical edits:** Use `edit_file` with exact match strings for small diffs; avoid re-writing large files.
- **Targeted reads:** Read specific line ranges (`StartLine`/`EndLine`).
- **Subagents:** Offload heavy file scanning or documentation surveys to subagents with lightweight models.
- **Compaction:** Run `/compact` after completing each Phase milestone to reset context window.
