"""Local LifeFabs bridge to the official Opentrons simulator.

The host API never executes submitted protocol code itself. It passes the script to a
resource-limited Docker sandbox with no network and a read-only mounted protocol file.
This is still a local educational service, not a hardened public multi-tenant service.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from pydantic import BaseModel, Field

APP_DIR = Path(__file__).resolve().parent
SIMULATOR_VERSION = "9.0.0"
SANDBOX_IMAGE = os.getenv("LIFEFABS_SIMULATOR_IMAGE", f"lifefabs-opentrons-sim:{SIMULATOR_VERSION}")
MAX_PROTOCOL_CHARS = 150_000
TIMEOUT_SECONDS = 60
MAX_OUTPUT_CHARS = 200_000
SIMULATION_LOCK = threading.BoundedSemaphore(value=1)

origins = [x.strip() for x in os.getenv(
    "LIFEFABS_ALLOWED_ORIGINS",
    "http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:8080,http://localhost:8080,http://127.0.0.1:5500,http://localhost:5500",
).split(",") if x.strip()]
app = FastAPI(title="LifeFabs Opentrons Simulation Bridge", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

class SimulationRequest(BaseModel):
    protocol: str = Field(min_length=1, max_length=MAX_PROTOCOL_CHARS)
    robot_type: Literal["OT-2"] = "OT-2"

class SimulationEvent(BaseModel):
    depth: int = 0
    text: str

class SimulationResponse(BaseModel):
    ok: bool
    simulator: str = "Opentrons Python API"
    version: str | None = None
    robot_type: str = "OT-2"
    event_count: int = 0
    events: list[SimulationEvent] = Field(default_factory=list)
    error: str | None = None

@app.middleware("http")
async def limit_body(request: Request, call_next):
    # Starlette normally buffers small JSON bodies; cap requests to avoid accidental uploads.
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_PROTOCOL_CHARS * 4:
        return JSONResponse({"detail": "Request body is too large."}, status_code=413)
    return await call_next(request)

def image_is_ready() -> bool:
    try:
        result = subprocess.run(["docker", "image", "inspect", SANDBOX_IMAGE],
                                capture_output=True, text=True, timeout=5, check=False)
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False

@app.get("/health")
def health() -> dict[str, object]:
    ready = image_is_ready()
    return {"ok": True, "simulator": "Opentrons Python API simulator", "version": SIMULATOR_VERSION,
            "robot_types": ["OT-2"], "image_ready": ready,
            "message": "Build the sandbox image before running simulations." if not ready else "Sandbox image ready."}

@app.post("/api/simulate", response_model=SimulationResponse)
def simulate(request: SimulationRequest) -> SimulationResponse:
    # Static guard: this service currently supports the OT-2 target only.
    if re.search(r"[\"']robotType[\"']\s*:\s*[\"']Flex[\"']", request.protocol, flags=re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Flex protocols are not supported by this service yet. Select OT-2 and regenerate or edit the protocol requirements.")
    if not image_is_ready():
        raise HTTPException(status_code=503, detail=f"Sandbox image {SANDBOX_IMAGE} is missing. Build it with the included Dockerfile.")
    if not SIMULATION_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Another simulation is running. Please retry after it finishes.")

    container_name = f"lifefabs-sim-{uuid.uuid4().hex[:12]}"
    try:
        with tempfile.TemporaryDirectory(prefix="lifefabs-sim-") as temp_name:
            temp_dir = Path(temp_name)
            protocol_path = temp_dir / "protocol.py"
            protocol_path.write_text(request.protocol, encoding="utf-8")
            protocol_path.chmod(0o444)
            # Container process runs as an unprivileged UID. The directory is traversable;
            # the script itself and mounted directory are read-only.
            temp_dir.chmod(0o755)
            command = [
                "docker", "run", "--rm", "--name", container_name,
                "--network", "none", "--memory=1024m", "--cpus=1", "--pids-limit=128",
                "--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=64m",
                "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
                "--user", "10001:10001", "-v", f"{temp_dir}:/input:ro",
                SANDBOX_IMAGE, "/input/protocol.py",
            ]
            try:
                completed = subprocess.run(
                    command, capture_output=True, text=True, timeout=TIMEOUT_SECONDS,
                    check=False,
                    env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "C.UTF-8"},
                )
            except subprocess.TimeoutExpired:
                # Killing the Docker CLI alone does not always stop the attached container.
                subprocess.run(["docker", "kill", container_name], capture_output=True, text=True, timeout=5, check=False)
                subprocess.run(["docker", "rm", "-f", container_name], capture_output=True, text=True, timeout=5, check=False)
                raise HTTPException(status_code=408, detail="Official simulation exceeded the 60-second time limit.") from None
    except OSError as error:
        raise HTTPException(status_code=503, detail=f"Could not start the Docker sandbox: {error}") from None
    finally:
        SIMULATION_LOCK.release()

    stdout = completed.stdout[:MAX_OUTPUT_CHARS]
    stderr = completed.stderr[:MAX_OUTPUT_CHARS]
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        return SimulationResponse(ok=False, error=(stderr or stdout or f"Sandbox exited {completed.returncode}")[:5000])
    if completed.returncode != 0 or not payload.get("ok"):
        return SimulationResponse(ok=False, version=payload.get("version"), error=str(payload.get("error") or stderr or "Simulation failed.")[:5000])
    raw_events = payload.get("events", [])
    events = [SimulationEvent(depth=max(0, min(8, int(item.get("depth", 0)))),
                              text=str(item.get("text", "Command"))[:1000])
              for item in raw_events[:1200]]
    return SimulationResponse(ok=True, version=str(payload.get("version", "unknown")),
                              robot_type="OT-2", event_count=len(events), events=events)
