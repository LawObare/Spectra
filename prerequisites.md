# Spectra Build Prerequisites & Developer Acceleration Guide

This document specifies all core system runtimes, build essentials, and specialized developer acceleration tools required to build, test, and deploy **Spectra** for the NASA Space Apps Challenge — including detailed technical rationales explaining **why each tool grants a decisive Hackathon edge**.

---

## 1. System Runtimes & Core Infrastructure

The following baseline runtimes are mandatory for the multi-service architecture:

| Runtime / Engine | Minimum Version | Installation / Verification | Primary Role in Spectra |
|---|---|---|---|
| **Linux / macOS / WSL2** | Ubuntu 22.04+ / macOS 13+ | `uname -srm` | Native host operating system with POSIX shell and Docker support. |
| **Docker & Docker Compose** | Docker 24.0+ / Compose v2 | `docker --version && docker compose version` | Hosts local Supabase PostgreSQL 16 container and Studio UI. |
| **Python** | Python 3.11+ | `python3 --version` | Powers the unified single-service FastAPI backend (`backend/`), Astropy, PyVO, SciPy, and Reproject pipeline. |
| **Node.js & npm** | Node.js 20+ (LTS) / npm 10+ | `node -v && npm -v` | Powers the React 18, Vite 5, Tailwind CSS frontend client (`web-client/`). |

---

## 2. Specialized Developer Tools That Give Us the Hackathon Edge

In a 48-hour hackathon, victory is determined by **developer velocity, zero runtime crashes, compile-time safety, and rapid debugging**. The following twelve tools were strategically selected to eliminate development bottlenecks and deliver an institutional-grade product:

---

### 1. Google Antigravity CLI (`agy`)

- **What it is:** The command-line orchestration engine for Google Antigravity, an advanced agentic coding harness designed for deep, autonomous pair-programming with LLM models.
- **How to verify / invoke:**
  ```bash
  agy --version
  ```
- **Why it gives the Hackathon edge:**
  1. **Autonomous Slash Command Workflows:**
     - `/goal`: Executes long-running tasks autonomously (e.g. overnight or during breaks) without stopping until verified against test suites.
     - `/plan`: Produces rigorous, step-by-step engineering plans before executing code edits, preventing architectural backtracking.
     - `/teamwork`: Coordinates multi-agent workflows across specialized roles (codebase researcher, database debugger, frontend specialist).
     - `/compact`: Intelligently summarizes and frees context window tokens without losing critical scientific constants or architectural decisions.
     - `/learn`: Persists verified behavioral corrections and domain rules across conversational sessions.
  2. **Custom Skills Customization System (`.agents/skills/`):**
     - Enables project-specific domain rules (e.g., `/caveman` mode to drastically cut prompt token costs and eliminate conversational fluff).
     - Allows instant discovery and installation of agent skills (`find-skills`) to augment coding capabilities on the fly.
  3. **Subagent Delegation & Parallel Processing:**
     - The harness can launch isolated background subagents (`research`, `self`) to survey external IRSA FITS documentation or run test benchmarks in parallel without blocking main development.
  4. **Persistent Artifacts & Scratchpad:**
     - Stores structured deliverables and persistent logs inside `<appDataDir>/brain/<conversation-id>`, preventing context contamination and preserving experiment reproducibility.

---

### 2. GitHub CLI (`gh`)

- **What it is:** The official command-line interface for GitHub, bringing issues, pull requests, releases, secrets, and GitHub Actions directly into the terminal.
- **Installation:**
  ```bash
  # Debian/Ubuntu
  type -p curl >/dev/null || (sudo apt update && sudo apt install curl -y)
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
  sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
  sudo apt update && sudo apt install gh -y

  # Authenticate
  gh auth login
  ```
- **Why it gives the Hackathon edge:**
  1. **Zero Context-Switching:** Team members never leave their editor or terminal to check GitHub. Pull requests can be created, reviewed, and merged in seconds (`gh pr create --fill && gh pr merge --auto --squash`).
  2. **Instant Secret Provisioning:** Deploying cloud credentials to GitHub Actions takes one command:
     ```bash
     gh secret set DATABASE_URL --body "postgresql://..."
     gh secret set HF_TOKEN --body "hf_..."
     ```
  3. **Real-Time CI/CD Monitoring:** Inspecting the status of the keep-alive heartbeat workflow or Hugging Face deployment pipeline runs in real time via:
     ```bash
     gh run watch
     ```
  4. **Immutable Hackathon Proof-of-Work Tagging:** When the submission deadline strikes, generating an official GitHub release with tagged binaries takes 5 seconds:
     ```bash
     gh release create v1.0.0-hackathon --title "Spectra v1.0.0 (NASA Space Apps Submission)" --generate-notes
     ```

---

### 3. `uv` (Fast Astral Python Package Manager)

- **What it is:** An extremely fast Python package manager and resolver written in Rust, built by Astral (the creators of Ruff).
- **Installation:**
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  source $HOME/.local/bin/env
  ```
- **Why it gives the Hackathon edge:**
  1. **10x–100x Faster Installs:** Resolving and installing the entire scientific Python stack (`astropy`, `pyvo`, `reproject`, `scipy`, `torch`, `fastapi`) completes in **~3 seconds**, compared to 3–5 minutes with standard `pip` and `venv`.
  2. **Cross-Platform Determinism (`uv.lock`):** Locks exact cryptographic hashes for all packages and C-extensions, completely eliminating "it works on my machine" compiler errors across different developer operating systems.
  3. **Zero-Friction Execution (`uv run`):** Runs scripts and servers directly inside the project's managed environment without needing manual `source .venv/bin/activate`:
     ```bash
     uv run uvicorn main:app --port 7860 --reload
     ```
  4. **CPU-Only PyTorch Pinning:** Easily configured to pull CPU-only wheels from `https://download.pytorch.org/whl/cpu`, keeping Docker images compact (~1.2 GB instead of ~4.5 GB with CUDA bloat).

---

### 4. `asyncpg` + Automated SQL `EXPLAIN` Verifier (`test_sql.py`)

- **What it is:** A high-performance asynchronous PostgreSQL driver for Python paired with an automated CI test (`backend/tests/test_sql.py`) that validates every parameterized SQL query against `schema.sql` using PostgreSQL `EXPLAIN`.
- **Installation:**
  ```bash
  cd backend && uv add asyncpg pytest pytest-asyncio
  ```
- **Why it gives the Hackathon edge:**
  1. **Zero ORM Overhead, Compile-Time SQL Safety:** Replaces heavy ORMs and external multi-language codegen with direct binary-protocol `asyncpg` connection pooling ($<2\,\text{ms}$ query latency) verified at test time via `EXPLAIN`.
  2. **Instant Schema Drift Detection:** If a column is renamed in `schema.sql` or a query parameter type mismatches in `queries.py`, `uv run pytest backend/tests/test_sql.py` flags the exact query before deployment.

---

### 5. Ruff + Uvicorn Live Reload (`uvicorn --reload`)

- **What it is:** Astral's ultra-fast Rust-based Python linter/formatter (`ruff`) paired with Uvicorn's file-watching ASGI server.
- **Installation:**
  ```bash
  cd backend && uv add --dev ruff
  ```
- **Why it gives the Hackathon edge:**
  1. **Sub-Second Linting & Backend Hot-Reload:** `ruff check` lints the entire Python codebase in $<20\,\text{ms}$, and `uvicorn --reload` restarts the FastAPI mission engine on `:7860` on save.
  2. **Single-Stack Simplicity:** Matches Vite's frontend feedback loop while keeping the entire backend in a single Python 3.11 process.

---

### 6. Task / Taskfile (`task`)

- **What it is:** A modern, cross-platform task runner and build tool that uses clean YAML (`Taskfile.yml`) instead of arcane Makefile tab syntax.
- **Installation:**
  ```bash
  sh -c "$(curl --location https://taskfile.dev/install.sh) -- -d -b /usr/local/bin"
  # or via npm:
  npm install -g @go-task/cli
  ```
- **Why it gives the Hackathon edge:**
  1. **One-Command Everything:** Eliminates multi-step README instructions. A developer or judge types:
     ```bash
     task dev
     ```
     and Task automatically boots local Supabase Docker containers, applies `schema.sql` and `seed_benchmarks.sql`, and launches the Unified FastAPI backend (`:7860`) and React frontend (`:3000`) concurrently with color-coded terminal prefixes (`[BACKEND]`, `[WEB]`).
  2. **Built-in Task Dependencies:** Automatically runs migrations before launching servers (`deps: [db:up]`), preventing out-of-order startup bugs.

---

### 7. Supabase CLI (`supabase`) & Docker

- **What it is:** The official local development suite for Supabase, running managed PostgreSQL 16 and the Supabase Studio dashboard locally in Docker.
- **Installation:**
  ```bash
  npm install -g supabase
  ```
- **Why it gives the Hackathon edge:**
  1. **100% Offline Resilience:** Hackathon venue Wi-Fi is notoriously unreliable. `supabase start` provisions a complete local PostgreSQL 16 instance right on your machine.
  2. **Visual Studio Dashboard (`localhost:54323`):** Team members can view, edit, and query database tables and inspect discussion threads using an intuitive web UI without needing external tools like pgAdmin or DBeaver.
  3. **1-Second Database Resets:** Run `supabase db reset` to re-apply `schema.sql` and `seed_benchmarks.sql` in one second if test data becomes corrupted.

---

### 8. `openapi-typescript`

- **What it is:** A command-line tool that evaluates OpenAPI 3.1 JSON schemas and generates strictly typed TypeScript type definitions (`api.d.ts`).
- **Installation:**
  ```bash
  npm install -D openapi-typescript
  ```
- **Why it gives the Hackathon edge:**
  1. **Cross-Stack Type Contracts:** FastAPI natively generates OpenAPI 3.1 schemas from Pydantic models. Running:
     ```bash
     npx openapi-typescript http://127.0.0.1:7860/openapi.json -o ./web-client/src/types/api.d.ts
     ```
     instantly produces strict TypeScript interfaces for React.
  2. **Eliminates Manual Fetch Typing:** If a field name changes in Python (e.g. `flux_mjy_sr` $\rightarrow$ `fluxMjySr`), TypeScript immediately flags every React component using the old name at compile time.

---

### 9. `nuqs` (Type-Safe URL Query State for React)

- **What it is:** A lightweight, type-safe search parameter state manager for React and Next.js/Vite applications.
- **Installation:**
  ```bash
  cd web-client && npm install nuqs
  ```
- **Why it gives the Hackathon edge:**
  1. **Eliminates Fragile Hash String Parsing:** Replaces hundreds of lines of fragile `window.location.hash.split('&')` code with clean, reactive hooks:
     ```typescript
     const [ra, setRa] = useQueryState('ra', parseAsFloat.withDefault(133.737400));
     const [mode, setMode] = useQueryState('mode', parseAsString.withDefault('blink'));
     ```
  2. **Judge-Ready Shareable Deep-Links:** Any adjustment made to coordinates, survey passes, Asinh stretch sliders, or chemical filters immediately syncs to the browser URL bar. Judges can copy and paste URLs across tabs or devices and see the exact same celestial view restored instantly.

---

### 10. `uPlot` (Ultra-Fast Canvas 2D Charting)

- **What it is:** A tiny (<40 KB), blazingly fast HTML5 Canvas-based 2D charting library.
- **Installation:**
  ```bash
  cd web-client && npm install uplot
  ```
- **Why it gives the Hackathon edge:**
  1. **60 FPS Hyperspectral Rendering:** Standard charting libraries (Recharts, Chart.js) use SVG DOM elements that choke and lag when rendering 102 spectral channels with vertical error bars and molecular ruler bands. `uPlot` renders on HTML5 Canvas in **$<1.5\,\text{ms}$ per frame**.
  2. **Real-Time WebSocket Loss Streaming:** Inside `/admin/dynamics`, `uPlot` renders live incoming PyTorch training loss and gradient curves from WebSockets at 60 FPS with zero memory leaks and near-zero CPU consumption.

---

### 11. `cmdk` (Fast, Accessible Command Palette)

- **What it is:** An unstyled, accessible React command palette component primitive built by Paco Coursey.
- **Installation:**
  ```bash
  cd web-client && npm install cmdk
  ```
- **Why it gives the Hackathon edge:**
  1. **Instant Keyboard Navigation (`Ctrl+K` / `Cmd+K`):** Anywhere in the application, pressing `Ctrl+K` summons a sleek command bar. Users can type coordinates, search benchmark stars (`WISE 0855`, `Barnard's Star`), switch between Blink and Difference modes, or jump straight to `/admin/dynamics`.
  2. **Institutional Product Polish:** Gives the web app the speed and feel of a desktop operating system (like Linear or Raycast), leaving a strong impression on hackathon judges.

---

### 12. `jq` & `curl` / `httpie`

- **What it is:** Command-line JSON processors and modern HTTP clients for terminal API inspection.
- **Installation:**
  ```bash
  sudo apt-get install -y jq curl httpie
  ```
- **Why it gives the Hackathon edge:**
  1. **Rapid Terminal Prototyping:** Inspecting IRSA SIA2 VOTable responses, checking FITS header values, or triggering backend health pings without opening a browser:
     ```bash
     curl -s http://127.0.0.1:7860/api/health | jq .
     ```
  2. **Zero-Overhead Health Checks:** Allows automated bash scripts (`start.sh`) to verify process liveness and database connections in Docker containers reliably.

---

## 3. Toolchain Installation Summary Script

To prepare an Ubuntu/Debian development machine with the complete Spectra hackathon toolchain in one step, execute:

```bash
#!/usr/bin/env bash
set -e

echo "=== Installing Spectra Hackathon Prerequisites ==="

# 1. System packages
sudo apt update && sudo apt install -y curl build-essential jq git

# 2. Astral uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

# 3. GitHub CLI (gh)
type -p curl >/dev/null || sudo apt install curl -y
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update && sudo apt install -y gh

# 4. Task runner
sh -c "$(curl --location https://taskfile.dev/install.sh) -- -d -b $HOME/.local/bin"

# 5. Supabase CLI
npm install -g supabase

echo "=== All Spectra Hackathon Prerequisites Installed Successfully! ==="
echo "Run 'task setup' followed by 'task dev' to launch the workbench."
```
