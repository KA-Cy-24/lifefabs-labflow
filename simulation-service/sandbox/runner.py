"""Run a single protocol through Opentrons' own simulation function in the sandbox."""
from __future__ import annotations

import io
import json
import sys
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import opentrons
from opentrons.simulate import simulate


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"ok": False, "error": "Expected exactly one protocol file path."}))
        return 2
    protocol_path = Path(sys.argv[1])
    protocol_stdout = io.StringIO()
    protocol_stderr = io.StringIO()
    try:
        with protocol_path.open("rb") as protocol_file, redirect_stdout(protocol_stdout), redirect_stderr(protocol_stderr):
            runlog, _bundle = simulate(protocol_file=protocol_file,
                                       file_name=protocol_path.name,
                                       log_level="warning")
        events = []
        for item in runlog:
            payload = item.get("payload", {})
            text = payload.get("text") or payload.get("name") or payload.get("command")
            if text is None:
                text = "Protocol command"
            events.append({"depth": int(item.get("level", 0)), "text": str(text)[:1000]})
        # Preserve a modest amount of protocol print output as an explicit log event.
        user_output = protocol_stdout.getvalue().strip()
        if user_output:
            events.append({"depth": 0, "text": f"Protocol stdout: {user_output[:3000]}"})
        print(json.dumps({"ok": True, "version": opentrons.__version__, "events": events}, ensure_ascii=False))
        return 0
    except Exception as error:  # API errors need to return to the learner, without dumping host details.
        print(json.dumps({"ok": False, "version": getattr(opentrons, "__version__", "unknown"),
                          "error": f"{type(error).__name__}: {error}"}, ensure_ascii=False))
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
