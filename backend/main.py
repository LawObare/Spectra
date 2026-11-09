"""Spectra Unified FastAPI Mission Science Engine.

Specification Anchor: SPECIFICATION.md §4.2, §10.4.8
Unified FastAPI service running on port 7860 orchestrating science pipelines,
zero-auth observer sessions, and binary tensor streaming.
"""

import asyncio
import os
import sys

from backend.api.cutout import router as cutout_router
from backend.api.resolve import router as resolve_router
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Setup uvloop event loop policy for high performance on Unix
if sys.platform != "win32":
    try:
        import uvloop

        asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
    except ImportError:
        pass

app = FastAPI(
    title="Spectra Mission Science Engine",
    description="Unified FastAPI Backend for SPHEREx Time-Domain & Hyperspectral Exploration",
    version="1.0.0",
)

# CORS Middleware (SPECIFICATION.md §10.4.8)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=[
        "Origin",
        "Content-Type",
        "Accept",
        "Authorization",
        "X-Observer-ID",
        "X-Observer-Key",
    ],
    expose_headers=["X-Observer-ID", "X-Cache"],
    max_age=600,
)

app.include_router(resolve_router)
app.include_router(cutout_router)


@app.get("/api/health/live")
async def health_live() -> JSONResponse:
    """Process liveness check for container supervisor.

    Specification Anchor: SPECIFICATION.md §4.2, §6.1
    """
    return JSONResponse(status_code=200, content={"status": "live"})


@app.get("/api/health")
async def health_check() -> JSONResponse:
    """Dual-action keep-alive check.

    Specification Anchor: SPECIFICATION.md §4.2, §10.4.8
    """
    return JSONResponse(
        status_code=200,
        content={
            "status": "healthy",
            "service": "spectra-backend",
            "version": "1.0.0",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=7860, reload=True)
