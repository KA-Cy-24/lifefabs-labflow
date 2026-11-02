"""Focused offline Chromium UI regression checks for the LifeFabs composer.

Requires: pip install playwright, Chromium installed (set CHROMIUM_PATH if needed).
This loads bundled scripts and JSON into a browser document; it doesn't test HTTP,
CDN Three.js, the optional simulation service, or physical OT-2 hardware.
"""
from __future__ import annotations

import ast
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    errors = []
    with sync_playwright() as driver:
        browser = driver.chromium.launch(
            executable_path=os.getenv("CHROMIUM_PATH", "/usr/bin/chromium"),
            headless=True, args=["--no-sandbox"],
        )
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.set_content((ROOT / "ot2.html").read_text())
        presets = (ROOT / "data/labware-presets.json").read_text()
        catalogue = (ROOT / "data/opentrons-instruments.json").read_text()
        page.evaluate("""({presets, catalogue}) => {
          window.fetch = async url => ({ok: true, json: async () =>
            JSON.parse(String(url).includes('labware-presets') ? presets : catalogue)});
        }""", {"presets": presets, "catalogue": catalogue})
        for script in ["js/ot2.js", "js/instrument-gallery.js"]:
            page.add_script_tag(content=(ROOT / script).read_text())
        page.wait_for_timeout(600)
        assert page.locator("#protocolSyncBadge").inner_text() == "PREVIEW CURRENT"
        page.locator('input[name="composerStyle"][value="quick"]').check()
        page.wait_for_timeout(550)
        assert "16" in page.locator("#stepCounter").inner_text()

        # Beginner batch count is transfers, not a fixed four-command ceiling.
        page.locator("#transferCount").fill("15")
        page.wait_for_timeout(550)
        assert "60" in page.locator("#stepCounter").inner_text()
        ast.parse(page.locator("#codeEditor").input_value())

        # Convert batch to editable commands, then deliberately introduce an
        # invalid duplicated pickup. Validation should block regeneration.
        page.locator('input[name="composerStyle"][value="sequence"]').check()
        page.locator("#convertSequence").click()
        page.wait_for_timeout(600)
        assert page.locator(".sequence-row").count() == 60
        assert "60" in page.locator("#stepCounter").inner_text()
        page.locator("#sequenceList .sequence-row").first.locator('[data-act="duplicate"]').click()
        page.wait_for_timeout(550)
        assert page.locator("#protocolSyncBadge").inner_text() == "BUILD FAILED"
        assert "Drop the previous tip" in page.locator("#formError").inner_text()
        page.locator("#sequenceList .sequence-row").nth(1).locator('[data-act="delete"]').click()
        page.wait_for_timeout(550)
        assert page.locator("#protocolSyncBadge").inner_text() == "PREVIEW CURRENT"
        assert not page.locator("#formError").inner_text()

        # More elaborate ordered sequence with all supported action forms and
        # individually requested tip positions. Assert generated Python syntax.
        page.evaluate("""() => {
          sequenceActions = [
            newAction('pickup',{tipWell:'A1'}),
            newAction('move',{plate:'source',well:'B2',reference:'top',z:2}),
            newAction('mix',{plate:'source',well:'B2',reference:'bottom',z:1,volume:40,repetitions:2}),
            newAction('aspirate',{plate:'source',well:'B2',volume:100,reference:'bottom',z:1}),
            newAction('airgap',{volume:5}),
            newAction('dispense',{plate:'destination',well:'C3',volume:50,reference:'top',z:-2}),
            newAction('dispense',{plate:'destination',well:'C4',volume:50,reference:'center'}),
            newAction('touch',{plate:'destination',well:'C4',touchOffset:-1,touchRadius:0.7}),
            newAction('blowout',{plate:'destination',well:'C4',reference:'top',z:0}),
            newAction('delay',{seconds:1.5}),
            newAction('pause',{message:'Inspect wells'}),
            newAction('drop'),
          ]; renderSequence(); buildProtocol();
        }""")
        assert page.locator("#protocolSyncBadge").inner_text() == "PREVIEW CURRENT", page.locator("#formError").inner_text()
        code = page.locator("#codeEditor").input_value()
        ast.parse(code)
        for call in [".move_to(", ".mix(", ".air_gap(", ".touch_tip(",
                     ".blow_out(", "protocol.delay(", "protocol.pause("]:
            assert call in code, call
        assert ".top(z=-2)" in code
        assert "v_offset=-1" in code

        # Hardware is linked: a gallery mount updates pipette/mount in Build.
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'lifefabs:hardware-layout-changed', {detail:{placed_modules:[],
          mounted_pipettes:[{api_load_name:'p20_single_gen2',mount:'left',name:'P20'}]}}))""")
        page.wait_for_timeout(600)
        assert page.locator("#pipetteModel").input_value() == "p20_single_gen2"
        assert page.locator("#mount").input_value() == "left"
        assert page.locator("#protocolSyncBadge").inner_text() == "BUILD FAILED"  # 100uL no longer compatible

        # Changing back to P300 (and then adding an unused module in slot 4)
        # should create an idle load_module declaration without a collision.
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'lifefabs:hardware-layout-changed', {detail:{placed_modules:[
            {api_load_name:'temperature module gen2',name:'Temperature Module GEN2',location:4,reserved_slots:[4]}],
            mounted_pipettes:[{api_load_name:'p300_single_gen2',mount:'right',name:'P300'}]}}))""")
        page.wait_for_timeout(600)
        assert page.locator("#protocolSyncBadge").inner_text() == "PREVIEW CURRENT", page.locator("#formError").inner_text()
        code = page.locator("#codeEditor").input_value()
        assert 'protocol.load_module("temperature module gen2", "4")' in code
        ast.parse(code)

        # A gallery module occupying the source slot must block regeneration.
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'lifefabs:hardware-layout-changed', {detail:{placed_modules:[
            {api_load_name:'temperature module gen2',name:'Temperature Module GEN2',location:1,reserved_slots:[1]}],
            mounted_pipettes:[{api_load_name:'p300_single_gen2',mount:'right',name:'P300'}]}}))""")
        page.wait_for_timeout(600)
        assert page.locator("#protocolSyncBadge").inner_text() == "BUILD FAILED"
        assert "conflict" in page.locator("#formError").inner_text().lower()

        # Imported Python is never overwritten by gallery changes in Inspect.
        page.locator("#modeInspect").click()
        page.locator("#codeEditor").fill("# user-authored Python - do not change")
        page.evaluate("""() => window.dispatchEvent(new CustomEvent(
          'lifefabs:hardware-layout-changed', {detail:{placed_modules:[],mounted_pipettes:[]}}))""")
        page.wait_for_timeout(550)
        assert page.locator("#codeEditor").input_value() == "# user-authored Python - do not change"
        assert errors == [], errors
        browser.close()
    print("OK: guided batch, editable sequence/validation, Python AST, live hardware sync, module conflict, inspect isolation")


if __name__ == "__main__":
    main()
