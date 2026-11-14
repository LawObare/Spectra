# Spectra Build Prerequisites & Developer Acceleration Guide

This document specifies all core system runtimes, build essentials, and specialized developer acceleration tools required to build, test, and deploy **Spectra** for the NASA Space Apps Challenge — including detailed technical rationales explaining **why each tool grants a decisive Hackathon edge**.

---

## 1. System Runtimes & Core Infrastructure

The following baseline runtimes are mandatory for the multi-service architecture:

| Runtime / Engine | Minimum Version | Installation / Verification | Primary Role in Spectra |
|---|---|---|---|
| **Linux / macOS / WSL2** | Ubuntu 22.04+ / macOS 13+ | `uname -srm` | Native host operating system with POSIX shell and Docker support. |
| **Docker & Docker Compose** | Docker 24.0+ / Compose v2 | `docker --version && docker compose version` | Hosts local Supabase PostgreSQL 16 container with `pgvector` and Studio UI. |
| **Go** | Go 1.22+ (1.23 recommended) | `go version` | Powers the high-concurrency API Gateway, LRU cache, and WebSocket hub (`api-gateway/`). |
| **Python** | Python 3.11+ | `python3 --version` | Powers the Astropy, PyVO, SciPy, PyTorch science microservice (`astro-worker/`). |
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
     uv run uvicorn main:app --port 8001 --reload
     ```
  4. **CPU-Only PyTorch Pinning:** Easily configured to pull CPU-only wheels from `https://download.pytorch.org/whl/cpu`, keeping Docker images compact (~1.2 GB instead of ~4.5 GB with CUDA bloat).

---

### 4. `sqlc` (Compile-Time SQL Compiler for Go)

- **What it is:** A compiler that parses raw PostgreSQL DDL schemas and `.sql` query files to generate 100% type-safe, idiomatic Go structs, interfaces, and methods.
- **Installation:**
  ```bash
  go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
  ```
- **Why it gives the Hackathon edge:**
  1. **Zero ORM Overhead, Zero Runtime Scan Bugs:** ORMs (like GORM or Hibernate) add runtime reflection overhead and obscure raw SQL performance. Manual database access (`database/sql`) is plagued by tedious, error-prone `rows.Scan(&a, &b, &c)` code where a misplaced column index causes a runtime panic. `sqlc` guarantees that if your Go code compiles, your SQL types are 100% correct.
  2. **Instant Compile-Time Refactoring:** If you rename a database column or change an integer to a float, running `sqlc generate` immediately flags every affected Go function in red before you ever run the backend.
  3. **Native `pgx/v5` Integration:** Emits code designed for `github.com/jackc/pgx/v5/pgxpool`, utilizing PostgreSQL prepared queries and connection pooling at native speed.

---

### 5. Air (`github.com/air-verse/air`)

- **What it is:** A live-reloading command-line utility for Go applications, watching files and recompiling binaries on save.
- **Installation:**
  ```bash
  go install github.com/air-verse/air@latest
  ```
- **Why it gives the Hackathon edge:**
  1. **Sub-300ms Backend Hot-Reload:** Every time a Go route handler, middleware, or `sqlc` query is saved, `air` recompiles and restarts the gateway binary in $<300\,\text{ms}$.
  2. **Matches Frontend Velocity:** Gives the Go API Gateway the same instant feedback loop that Vite gives React, drastically accelerating API development.

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
     and Task automatically checks dependencies, boots local Supabase Docker containers, runs `sqlc generate`, and launches the Python science microservice, Go gateway, and React frontend concurrently with color-coded terminal prefixes (`[WORKER]`, `[GATEWAY]`, `[CLIENT]`).
  2. **Built-in Task Dependencies:** Automatically runs migrations and code generation before launching servers (`deps: [db:up]`), preventing out-of-order startup bugs.

---

### 7. Supabase CLI (`supabase`) & Docker

- **What it is:** The official local development suite for Supabase, running managed PostgreSQL 16, `pgvector`, and the Supabase Studio dashboard locally in Docker.
- **Installation:**
  ```bash
  npm install -g supabase
  ```
- **Why it gives the Hackathon edge:**
  1. **100% Offline Resilience:** Hackathon venue Wi-Fi is notoriously unreliable. `supabase start` provisions a complete local PostgreSQL 16 instance with `pgvector` pre-configured right on your machine.
  2. **Visual Studio Dashboard (`localhost:54323`):** Team members can view, edit, and query database tables, test cosine similarity queries, and inspect discussion threads using an intuitive web UI without needing external tools like pgAdmin or DBeaver.
  3. **1-Second Database Resets:** Run `supabase db reset` to re-apply `schema.sql` and `seed_benchmarks.sql` in one second if test data becomes corrupted.

---

### 8. `openapi-typescript`

- **What it is:** A command-line tool that evaluates OpenAPI 3.1 JSON schemas and generates strictly typed TypeScript type definitions (`api.d.ts`).
- **Installation:**
  ```bash
  npm install -D openapi-typescript
  ```
- **Why it gives the Hackathon edge:**
  1. **Cross-Stack Type Contracts:** FastAPI (`astro-worker`) natively generates OpenAPI 3.1 schemas from Pydantic models. Running:
     ```bash
     npx openapi-typescript http://127.0.0.1:8001/openapi.json -o ./web-client/src/types/api.d.ts
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
  1. **Rapid Terminal Prototyping:** Inspecting IRSA SIA2 VOTable responses, checking FITS header values, or triggering gateway health pings without opening a browser:
     ```bash
     curl -s http://127.0.0.1:8080/api/health | jq .
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

# 4. Go build tools (sqlc and air)
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
go install github.com/air-verse/air@latest
export PATH="$HOME/go/bin:$PATH"

# 5. Task runner
sh -c "$(curl --location https://taskfile.dev/install.sh) -- -d -b $HOME/.local/bin"

# 6. Supabase CLI
npm install -g supabase

echo "=== All Spectra Hackathon Prerequisites Installed Successfully! ==="
echo "Run 'task setup' followed by 'task dev' to launch the workbench."
```
