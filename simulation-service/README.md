# Optional official Opentrons simulation service

This companion service lets the static LifeFabs site run Python protocol files through Opentrons' own API simulator. It is **optional**: the GitHub Pages frontend and the built-in protocol builder work without it.

## What it uses

- `opentrons.simulate.simulate()` from the official Opentrons Python API, which executes a protocol against simulated virtual hardware and returns a command run log.
- Published stable package `opentrons==9.0.0` in the sandbox image. This version is deliberately pinned for OT-2 compatibility: the current `edge` source includes an explicit refusal to simulate OT-2-targeted protocols in the generic simulator, and the Opentrons App release notes describe the newer app line as Flex-focused with a separate OT-2 App. The 9.0.0 API source still supports OT-2 simulation and API 2.28. The user-provided repository archive is from the `edge` development tree and includes `api`, `hardware`, `api-client`, and `step-generation` subprojects; it is useful for source-level reference, but it is not a prebuilt browser bundle. The `step-generation` package is TypeScript workspace code used to create protocol commands in Opentrons' application, not an all-in-one browser-based Python interpreter.
- Docker isolation for code submitted from the browser. The submitted protocol is mounted read-only; the sandbox uses no network, a read-only root filesystem, limited CPU/memory/processes, no Linux capabilities, and an unprivileged UID.

Opentrons documents the Python API as the framework for loading labware/instruments and executing liquid-handling commands. It also documents the `opentrons.simulate` entry point for desktop protocol simulation. References: <https://github.com/Opentrons/opentrons/blob/v9.0.0/api/src/opentrons/simulate.py>, <https://github.com/Opentrons/opentrons/blob/edge/api/src/opentrons/simulate.py>, <https://github.com/Opentrons/opentrons/releases>, and <https://github.com/Opentrons/opentrons/blob/edge/app-shell/build/release-notes.md>.

## Prerequisites

- Docker Engine installed and running.
- Python 3.10+ on the host for the FastAPI bridge.
- Network access during the one-time image build to install the pinned Opentrons package.

## Build and run

From this directory:

```bash
# Build the sandbox image that executes submitted protocol scripts.
docker build -t lifefabs-opentrons-sim:9.0.0 -f sandbox/Dockerfile sandbox

# Create a host environment for the local bridge.
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt

# From this folder, bind only to loopback by default.
uvicorn app:app --host 127.0.0.1 --port 8010
```

Then open the site over HTTP, e.g. `python -m http.server 8000` in the website root, and choose `http://127.0.0.1:8010` in the “Official Opentrons API simulation” section. The first request may take longer while Docker starts a container.

If your static site is served from another localhost port, set `LIFEFABS_ALLOWED_ORIGINS` to a comma-separated list of exact allowed origins before running Uvicorn. If using a GitHub Pages origin to call a simulator on your own machine, add the exact Pages origin to this allow-list. Do not use `*` for an origin allow-list.

## Security notes — read before use

1. Python protocol files are executable programs. The bridge never runs a submitted script directly on the host, but it still depends on Docker and the host kernel for isolation.
2. Keep Uvicorn bound to `127.0.0.1`; do not expose this service to the public internet or a classroom LAN as-is. It has no authentication, per-user quotas, or hardened multi-tenant sandboxing.
3. Run Docker as a non-root / rootless user where practical, keep Docker patched, and do not mount the Docker socket into the sandbox container. The host bridge itself needs access to Docker to launch the isolated simulator.
4. The sandbox's no-network policy means protocols depending on fetching files or installing packages at run time will fail. This is intentional.
5. This is official *software simulation*, not actual robot execution. A successful simulation does not validate physical calibration, tip length, deck offsets, reagent compatibility, or collision safety. Confirm the intended OT-2 software/API version and run the protocol through Opentrons App analysis before a physical experiment.
6. For production hosting, use a stronger sandbox and authentication/rate limiting; this local bridge is not a public simulation service.

## API routes

- `GET /health` — service and container-image readiness.
- `POST /api/simulate` — body `{"protocol":"...python source...","robot_type":"OT-2"}`; response contains success/failure, simulator version and returned run-log events.

Flex is deliberately rejected by the current UI and service. A future Flex implementation needs its own tested deck model and runtime target.
