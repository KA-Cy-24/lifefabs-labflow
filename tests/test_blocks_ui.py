"""Focused Chromium regression for default visual block workflow and layout."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as driver:
 browser=driver.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=browser.new_page()
 errors=[]
 page.on('pageerror',lambda e: errors.append(str(e)))
 page.set_content((ROOT/'ot2.html').read_text())
 presets=(ROOT/'data/labware-presets.json').read_text();catalogue=(ROOT/'data/opentrons-instruments.json').read_text()
 page.evaluate('''({p,c}) => {window.fetch=async url=>({ok:true,json:async()=>JSON.parse(String(url).includes('labware-presets')?p:c)})}''',{'p':presets,'c':catalogue})
 for path in ['js/ot2.js','js/instrument-gallery.js']: page.add_script_tag(content=(ROOT/path).read_text())
 page.wait_for_timeout(700)
 assert page.locator('#sequenceSection').is_visible()
 assert page.locator('.block-node').count()==4,page.locator('#formError').inner_text()
 assert page.locator('#protocolSyncBadge').inner_text()=='PREVIEW CURRENT', page.locator('#formError').inner_text()
 assert page.evaluate('''() => { let a=document.querySelector('#deckVisual'),b=document.querySelector('#instrumentGalleryPanel'),c=document.querySelector('#builderMode');return !!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING) && !!(b.compareDocumentPosition(c)&Node.DOCUMENT_POSITION_FOLLOWING) }''')
 page.locator('#newActionType').select_option('delay');page.locator('#addAction').click();page.wait_for_timeout(500)
 assert page.locator('.block-node').count()==5
 assert page.locator('.block-expanded').count()==1
 page.locator('.block-node').first.locator('[data-act="expand"]').click()
 assert page.locator('.block-node').first.locator('.block-editor').is_visible()
 assert not errors,errors
 print('PASS: block default, generated preview, layout order, block palette and editor')
 browser.close()
