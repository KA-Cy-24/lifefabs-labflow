"""Live regression for cherry-pick complex operations and Python-to-visual inspect."""
import ast
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.set_content((root/'ot2.html').read_text())
    page.evaluate('''({l,c})=>{window.fetch=async u=>({ok:true,json:async()=>JSON.parse(String(u).includes('labware-presets')?l:c)})}''',{'l':(root/'data/labware-presets.json').read_text(),'c':(root/'data/opentrons-instruments.json').read_text()})
    for script in ['js/ot2.js','js/instrument-gallery.js','js/visual-composer-v4.js']:
        page.add_script_tag(content=(root/script).read_text())
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(250)
    page.locator('#flowClear').click()
    page.locator('[data-palette-type="distribute"]').click()
    page.locator('#flowInspector [data-block-key="wellList"]').fill('A1, C3, H12')
    py=page.locator('#codeEditor').input_value()
    assert '.distribute(' in py and '"C3"' in py and '"H12"' in py,py
    ast.parse(py)
    assert page.locator('#protocolSyncBadge').inner_text()=='LIVE · SYNCED',page.locator('#flowValidation').inner_text()
    page.locator('#flowClear').click()
    page.locator('[data-palette-type="consolidate"]').click()
    page.locator('#flowInspector [data-block-key="wellList"]').fill('A2, D5')
    py=page.locator('#codeEditor').input_value()
    assert '.consolidate(' in py and '"D5"' in py,py
    ast.parse(py)
    page.locator('#modeInspect').click()
    page.locator('#codeEditor').fill(py)
    page.locator('#analyzeCode').click()
    assert 'target wells were visualized' in page.locator('#diagnosticList').inner_text().lower(),page.locator('#diagnosticList').inner_text()
    assert page.locator('#stepChips button').count()>0, page.locator('#analysisSubtitle').inner_text()
    assert not errors,errors
    print('PASS: cherry-picked distribution/consolidation, generated Python syntax, static Python-to-viewer complex-well targets, no JS exceptions')
    browser.close()
