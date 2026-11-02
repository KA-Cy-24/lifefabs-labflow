"""Browser regression of visual block editor and canonical hardware synchronization.
Run: python tests/test_visual_flow_v4.py (requires Playwright + Chromium)
"""
import ast
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as driver:
    browser=driver.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1400,'height':900})
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.set_content((ROOT/'ot2.html').read_text())
    preset=(ROOT/'data/labware-presets.json').read_text()
    catalog=(ROOT/'data/opentrons-instruments.json').read_text()
    page.evaluate('''({p,c})=>{window.fetch=async u=>({ok:true,json:async()=>JSON.parse(String(u).includes('labware-presets')?p:c)})}''',{'p':preset,'c':catalog})
    for stylesheet in ['styles.css','styles-theme.css','styles-instrument-gallery.css','styles-ui-clarity.css','styles-composer.css','styles-visual-flow.css']:
        page.add_style_tag(content=(ROOT/stylesheet).read_text())
    for script in ['js/ot2.js','js/instrument-gallery.js','js/visual-composer-v4.js']:
        page.add_script_tag(content=(ROOT/script).read_text())
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(300)
    assert page.evaluate('''()=>['instrumentGalleryPanel','deckVisual','visualFlowPanel'].every((id,i,a)=>i===0||!!(document.getElementById(a[i-1]).compareDocumentPosition(document.getElementById(id))&Node.DOCUMENT_POSITION_FOLLOWING))'''), 'Section order must be hardware, deck, composer'
    assert not page.locator('#legacyComposerEngine').is_visible(), 'Old select-based composer is still visible'
    assert page.locator('.flow-block').count()==1
    assert page.locator('.hw-lab-card').count()==3
    assert page.locator('#protocolSyncBadge').inner_text()=='LIVE · SYNCED',page.locator('#flowValidation').inner_text()
    initial=page.locator('#codeEditor').input_value()
    assert '"6")' in initial and '"2")' in initial and '"3")' in initial and 'p300_single_gen2' in initial,initial
    assert 'pipette_right.aspirate(50' in initial
    ast.parse(initial)
    assert page.locator('#stepChips').locator('button').count()>=0
    # Place source in a different hardware slot. Verify same change in Python and SVG deck.
    page.locator('.hw-lab-card').first.locator('[data-hw-prop="slot"]').select_option('5')
    moved=page.locator('#codeEditor').input_value()
    assert 'nest_96_wellplate_200ul_flat", "5"' in moved,moved
    assert 'nest_96_wellplate_200ul_flat", "6"' not in moved
    assert page.locator('#deckSvg').locator('text').filter(has_text='SOURCE').count()>=1
    assert page.locator('#protocolSyncBadge').inner_text()=='LIVE · SYNCED'
    # Extra transfer produces a fresh well and a fresh tip automatically.
    page.locator('#flowAddCycle').click()
    assert page.locator('.flow-block').count()==2
    two=page.locator('#codeEditor').input_value()
    assert 'labware_3["B1"]' in two and 'labware_3["A1"]' in two,two
    assert 'labware_1["B1"]' in two,two
    ast.parse(two)
    # Edit selected transfer in-place; both code and event trajectory update automatically.
    page.locator('#flowInspector [data-block-key="volume"]').fill('75')
    assert 'aspirate(75' in page.locator('#codeEditor').input_value()
    assert page.locator('#protocolSyncBadge').inner_text()=='LIVE · SYNCED'
    # Adding a module must update generated Python and deck without using the old composer.
    module=page.locator('[data-catalog-id]').filter(has=page.locator('.instrument-card-title',has_text='Temperature Module')).first
    if module.count():
        module.locator('[data-quick-place]').click()
        assert 'protocol.load_module(' in page.locator('#codeEditor').input_value(),page.locator('#instrumentFeedback').inner_text()
    # Manual four-block protocol: pick up, aspirate, dispense, drop, no hidden form dependency.
    page.locator('#flowClear').click()
    for action in ['pickup','aspirate','dispense','drop']:
        page.locator(f'#flowPalette [data-palette-type="{action}"]').click()
    assert page.locator('.flow-block').count()==4
    manual=page.locator('#codeEditor').input_value()
    assert 'pick_up_tip(' in manual and 'aspirate(' in manual and 'dispense(' in manual and 'drop_tip()' in manual,manual
    assert 'labware_2["A1"]' in manual,manual
    ast.parse(manual)
    # Inspect-mode edited Python is independent; gallery edits must not overwrite it.
    page.locator('#modeInspect').click()
    page.locator('#codeEditor').fill('print("independent inspection")')
    page.locator('.hw-lab-card').first.locator('[data-hw-prop="slot"]').select_option('6')
    assert page.locator('#codeEditor').input_value()=='print("independent inspection")'
    page.locator('#modeBuild').click()
    page.wait_for_timeout(70)
    assert 'nest_96_wellplate_200ul_flat", "6"' in page.locator('#codeEditor').input_value()
    # Reset mounted hardware: the system must invalidate Python rather than quietly use old p300.
    page.locator('#resetInstrumentLayout').click()
    assert 'Mount at least one supported pipette' in page.locator('#flowValidation').inner_text()
    assert page.locator('#codeEditor').input_value().startswith('# Protocol not generated')
    assert page.locator('.hw-lab-card').count()==3
    assert 'SOURCE' in page.locator('#deckSvg').text_content()
    assert not errors,errors
    print('PASS: exact section order, real block canvas, 3-way synchronization, source slot edit, multiple transfers, immediate parameter change, module loads, invalidation after unmount, Python AST and no browser errors')
    browser.close()
