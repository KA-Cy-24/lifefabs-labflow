"""Browser-level regression: custom devices, standard module actions, labware stacks and dye simulation."""
from pathlib import Path
import json,ast
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=browser.new_page()
 failures=[]
 page.on('pageerror',lambda err:failures.append(str(err)))
 page.set_content((root/'ot2.html').read_text())
 page.evaluate('''({l,c})=>{window.fetch=async u=>({ok:true,json:async()=>JSON.parse(String(u).includes('labware-presets')?l:c)})}''',{'l':(root/'data/labware-presets.json').read_text(),'c':(root/'data/opentrons-instruments.json').read_text()})
 for script in ['js/ot2.js','js/instrument-gallery.js','js/visual-composer-v4.js']:
  page.add_script_tag(content=(root/script).read_text())
 page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
 page.wait_for_timeout(260)
 assert page.locator('#flowValidation').count(), 'Composer did not initialize'
 # Clear labware from free slot 1 and place standard temp module
 page.locator('[data-quick-place="temperature_module_gen2"]') .count() # optional unknown ID
 cards=page.locator('.instrument-catalog-card').filter(has_text='Temperature Module GEN2')
 assert cards.count()>0, 'No Temperature Module GEN2 card'
 cards.first.locator('.instrument-quick-place').click()
 page.wait_for_timeout(80)
 mods=page.evaluate('window.lifefabsHardwareLayout.placed_modules')
 assert len(mods)>0,mods
 # attach a labware item on top of module; choose first plate
 first=page.locator('#hwPlacedLabware [data-hw-id]').first
 if first.locator('[data-hw-prop="moduleUid"] option').count()>1:
  first.locator('[data-hw-prop="moduleUid"]').select_option(mods[0]['uid'])
  py=page.locator('#codeEditor').input_value()
  assert '.load_labware(' in py and 'module_1.load_labware(' in py,py
  assert 'SLOT CONFLICT' not in (page.locator('#deckSvg').text_content() or ''),'Module stack incorrectly marked as collision'
 page.locator('#flowClear').click()
 page.locator('[data-palette-type="module"]').click()
 page.locator('#flowInspector [data-block-key="moduleAction"]').select_option('set_temperature')
 page.locator('#flowInspector [data-block-key="moduleValue"]').fill('40')
 page.locator('#flowInspector [data-block-key="moduleValue"]').dispatch_event('change')
 py=page.locator('#codeEditor').input_value()
 assert '.set_temperature(40)' in py,py
 ast.parse(py)
 # register custom device; remove existing module if it blocks placement on first compatible
 page.locator('.custom-device-maker summary').click()
 page.locator('#customDeviceName').fill('Manual vibratory stage')
 page.locator('#customDeviceSlots').fill('1,2,3,4,5,6,7,8,9,10,11')
 page.locator('#customDevicePurpose').fill('External MCU: power and clearance checks')
 page.locator('#customDeviceActions').fill('Start agitation\nStop agitation')
 page.locator('#registerCustomDevice').click()
 assert page.locator('.instrument-catalog-card').filter(has_text='Manual vibratory stage').count()
 page.locator('.instrument-catalog-card').filter(has_text='Manual vibratory stage').locator('.instrument-quick-place').click()
 page.wait_for_timeout(100)
 custom=page.evaluate('window.lifefabsHardwareLayout.placed_modules.filter(x=>x.custom)')
 assert len(custom)==1, custom
 py=page.locator('#codeEditor').input_value()
 assert 'load_module("manual:' not in py,py
 page.locator('#flowInspector [data-block-key="moduleUid"]').select_option(custom[0]['uid'])
 assert page.locator('#flowInspector [data-block-key="moduleAction"]').input_value()=='manual_handoff'
 page.locator('#flowInspector [data-block-key="moduleAction"]').select_option('manual_0')
 py=page.locator('#codeEditor').input_value()
 assert 'Start agitation' in py and 'protocol.pause(' in py,py
 assert page.evaluate('window.lifefabsHardwareLayout.placed_modules.find(x=>x.custom).operations')==['Start agitation','Stop agitation']
 py=page.locator('#codeEditor').input_value()
 assert 'protocol.pause(' in py and 'EXTERNAL DEVICE' in py,py
 ast.parse(py)
 assert not failures,failures
 print('PASS: standard module operations; labware-on-module; custom device registration, manual handoff and safe Python')
 # isolated dye page fetch + animation / controls
 dye=browser.new_page(); errors=[];dye.on('pageerror',lambda e:errors.append(str(e)))
 dye.set_content((root/'food-dyes.html').read_text())
 dye.evaluate('''txt=>{window.fetch=async()=>({ok:true,json:async()=>JSON.parse(txt)})}''',(root/'data/food-dyes.json').read_text())
 dye.add_script_tag(content=(root/'js/food-dyes.js').read_text())
 dye.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
 dye.wait_for_timeout(120)
 assert dye.locator('#dyeSamples .dye-sample-card').count()==6
 assert dye.locator('#dyePredictions tbody tr').count()==6
 dye.locator('#dyeTime').fill('30');dye.locator('#dyeTime').dispatch_event('input')
 base=dye.locator('#dyePredictions tbody tr').first.inner_text()
 dye.locator('#dyeVoltage').fill('160');dye.locator('#dyeVoltage').dispatch_event('input')
 high=dye.locator('#dyePredictions tbody tr').first.inner_text()
 assert base!=high,(base,high)
 dye.locator('#dyeDemoMix').click()
 assert dye.locator('#dyePredictions tbody tr').count()>6
 dye.locator('#dyeReset').click()
 assert dye.locator('#dyeTimeText').inner_text()=='0.0 min'
 calc=dye.evaluate('''()=>window.lifefabsDyePhysics.physics({mobility:2.0,sieving:0,charge:-2},10,{voltage:0,spacing:100,length:70,agarose:1,sieving:1,temperature:22})''')
 assert calc['driftMM']==0 and calc['sigmaMM']>0,calc
 assert not errors,errors
 print('PASS: food-dye lane mixing, user controls, voltage-dependent migration, zero-field physics, replay/reset, no JS exceptions')
 browser.close()
