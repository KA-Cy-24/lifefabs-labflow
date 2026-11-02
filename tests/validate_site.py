"""Small offline sanity checks for the static LifeFabs site."""
from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]


class IdParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key == "id" and value:
                self.ids.append(value)


def check_html_ids(path: Path) -> None:
    parser = IdParser()
    parser.feed(path.read_text(encoding="utf-8"))
    duplicates = sorted({item for item in parser.ids if parser.ids.count(item) > 1})
    if duplicates:
        raise AssertionError(f"Duplicate HTML IDs in {path.name}: {duplicates}")


def check_relative_links(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    for attr, url in re.findall(r'\b(href|src)="([^"#]+)"', text):
        if url.startswith(("http://", "https://", "mailto:", "javascript:", "data:")):
            continue
        candidate = (path.parent / url.split("?", 1)[0]).resolve()
        if not candidate.exists():
            raise AssertionError(f"Broken local {attr} in {path.name}: {url}")


def main() -> None:
    data = json.loads((ROOT / "data/labware-presets.json").read_text(encoding="utf-8"))
    if not data.get("definitions"):
        raise AssertionError("No bundled labware definitions")
    for item in data["definitions"]:
        for key in ("loadName", "definitionUrl", "dimensions"):
            if key not in item:
                raise AssertionError(f"Labware entry lacks {key}: {item}")
    ast.parse((ROOT / "examples/minimal_ot2_transfer.py").read_text(encoding="utf-8"))
    instruments = json.loads((ROOT / "data/opentrons-instruments.json").read_text(encoding="utf-8"))
    catalogue_items = instruments.get("instruments", [])
    if not catalogue_items:
        raise AssertionError("OT-2 instrument catalogue is empty")
    instrument_ids = [item.get("id") for item in catalogue_items]
    if len(instrument_ids) != len(set(instrument_ids)):
        raise AssertionError("Duplicate instrument catalogue IDs")
    source_urls = [source.get("url", "") for source in instruments.get("sources", [])]
    if not source_urls or not all(url.startswith("https://docs.opentrons.com/") for url in source_urls):
        raise AssertionError("Instrument catalogue needs official docs.opentrons.com sources")
    for item in catalogue_items:
        for key in ("id", "name", "category", "api_load_name", "api_method", "placement"):
            if key not in item:
                raise AssertionError(f"Instrument entry lacks {key}: {item}")
        if item["category"] == "pipette":
            if item["api_method"] != "protocol.load_instrument" or item.get("placement") != "mount":
                raise AssertionError(f"Pipette placement or API method is incorrect: {item['id']}")
            if not item.get("mounts") or item.get("deck_placeable") is not False:
                raise AssertionError(f"Pipette is missing mount metadata: {item['id']}")
        elif item["category"] == "module":
            if item["api_method"] != "protocol.load_module" or item.get("placement") != "deck":
                raise AssertionError(f"Module placement or API method is incorrect: {item['id']}")
            if not item.get("allowed_slots") or not all(1 <= int(slot) <= 11 for slot in item["allowed_slots"]):
                raise AssertionError(f"Module has invalid OT-2 slot metadata: {item['id']}")
        else:
            raise AssertionError(f"Unknown instrument category: {item.get('category')}")
    for path in ROOT.glob("*.html"):
        check_html_ids(path)
        check_relative_links(path)
    for asset in (ROOT / "assets/ot2-reference-model-detailed.stl", ROOT / "assets/ot2-quick-start-guide.pdf", ROOT / "assets/lifefabs-logo-light.svg", ROOT / "assets/lifefabs-logo-dark.svg", ROOT / "styles-theme.css", ROOT / "styles-instrument-gallery.css", ROOT / "js/theme.js", ROOT / "js/official-sim-client.js", ROOT / "js/instrument-gallery.js", ROOT / "data/opentrons-instruments.json", ROOT / "simulation-service/app.py", ROOT / "simulation-service/sandbox/Dockerfile", ROOT / "simulation-service/sandbox/runner.py"):
        if not asset.is_file() or asset.stat().st_size == 0:
            raise AssertionError(f"Missing reference asset: {asset}")
    ast.parse((ROOT / "simulation-service/app.py").read_text(encoding="utf-8"))
    ast.parse((ROOT / "simulation-service/sandbox/runner.py").read_text(encoding="utf-8"))
    bridge = (ROOT / "simulation-service/app.py").read_text(encoding="utf-8")
    sandbox = (ROOT / "simulation-service/sandbox/Dockerfile").read_text(encoding="utf-8")
    if "SIMULATOR_VERSION = \"9.0.0\"" not in bridge or "OPENTRONS_VERSION=9.0.0" not in sandbox:
        raise AssertionError("OT-2 simulator package pin is inconsistent or missing")
    for path in ROOT.glob("*.html"):
        page = path.read_text(encoding="utf-8")
        if 'data-theme="dark"' not in page:
            raise AssertionError(f"Dark default missing in {path.name}")
        if "styles-theme.css" not in page or "js/theme.js" not in page:
            raise AssertionError(f"Theme layer not loaded in {path.name}")
        if "styles-ui-clarity.css" not in page or "js/tool-guide.js" not in page:
            raise AssertionError(f"Readability or contextual-help layer not loaded in {path.name}")
        if re.search(r"Georgia|Times New Roman", page, re.I):
            raise AssertionError(f"Legacy Georgia/Times body font reference remains in {path.name}")
    workbench = (ROOT / "ot2.html").read_text(encoding="utf-8")
    if workbench.index("styles-instrument-gallery.css") > workbench.index("styles-ui-clarity.css"):
        raise AssertionError("UI clarity styles should load after the gallery styles to maintain the larger gallery type scale")
    if 'id="protocolOverview"' not in workbench or 'id="protocolSyncBadge"' not in workbench:
        raise AssertionError("The protocol/viewer synchronisation status panel is missing")
    ot2_js = (ROOT / "js/ot2.js").read_text(encoding="utf-8")
    if "lifefabs:hardware-layout-changed" not in ot2_js or "PREVIEW CURRENT" not in ot2_js or "PREVIEW STALE" not in ot2_js:
        raise AssertionError("Protocol viewer sync events/status states are missing")
    guide_js = (ROOT / "js/tool-guide.js").read_text(encoding="utf-8")
    if "themeToggle" not in guide_js or "makeIcon" not in guide_js:
        raise AssertionError("Contextual tool-guide controls are missing")
    print("OK: catalogues, Python syntax, unique HTML IDs, local links, dark/bright theme, logo/assets, Bahnschrift-first readability, contextual-help layer, protocol-viewer sync state, instrument gallery, and optional OT-2 simulator service files (pinned v9.0.0).")


if __name__ == "__main__":
    main()
