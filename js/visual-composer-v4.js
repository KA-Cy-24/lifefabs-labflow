/* LifeFabs visual flow v4.
 * Canonical state = gallery mounted pipettes + gallery modules + explicitly placed labware.
 * The block editor never carries independent pipette models, load names or slot assignments.
 * This is a teaching subset, not a robot execution environment.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORE = 'lifefabs-ot2-visual-flow-v4';
  const CUSTOM_DEFS = 'lifefabs-ot2-official-labware-defs-v5';
  const HWSTORE = 'lifefabs-ot2-labware-placement-v4';
  const rows = 'ABCDEFGH';
  const wells = Array.from({length:96}, (_, i) => `${rows[i % 8]}${Math.floor(i / 8) + 1}`);
  const columnWells = Array.from({length:12}, (_, i) => `A${i+1}`);
  const TYPES = [
    ['transfer','Transfer liquid','Transfer','One full tip → aspirate → dispense → discard cycle'],
    ['distribute','Distribute · one to many','Transfer','One source, individually selected destination wells; Opentrons handles refill and disposal volume'],
    ['consolidate','Consolidate · many to one','Transfer','Individually selected source wells feeding one destination'],
    ['pickup','Pick up tip','Tips','Attach a specified tip or tip column'],
    ['aspirate','Aspirate','Liquid','Draw liquid from a well'],
    ['dispense','Dispense','Liquid','Release liquid into a well'],
    ['mix','Mix','Liquid','Cycle liquid in a selected well'],
    ['airgap','Air gap','Liquid','Draw air into an attached tip'],
    ['blowout','Blow out','Liquid','Expel remaining liquid at a well'],
    ['touch','Touch tip','Liquid','Move the tip around the well rim'],
    ['move','Move to well','Motion','Request a specific target location'],
    ['drop','Drop tip','Tips','Discard the currently attached tip'],
    ['delay','Wait','Control','Delay for a specified duration'],
    ['pause','Pause','Control','Stop and ask the operator to continue'],
    ['module','Operate a module / custom device','Module','Select a placed module and one of its supported actions; custom hardware uses an explicit operator handoff']
  ];
  const MODULE_ACTIONS = {
    heater_shaker:[['close_labware_latch','Close latch'],['open_labware_latch','Open latch'],['set_and_wait_for_temperature','Heat and wait (°C)'],['set_target_temperature','Set heater target (°C); continue'],['deactivate_heater','Stop heating'],['set_and_wait_for_shake_speed','Shake and wait (rpm)'],['deactivate_shaker','Stop shaking']],
    temperature_module:[['set_temperature','Set temperature and wait (°C)'],['start_set_temperature','Start setting temperature (°C)'],['deactivate','Deactivate temperature']],
    thermocycler:[['open_lid','Open lid'],['close_lid','Close lid'],['set_lid_temperature','Heat lid (°C)'],['set_block_temperature','Set block temperature (°C)'],['execute_profile','Run thermocycler profile'],['deactivate_lid','Turn off lid heater'],['deactivate_block','Turn off block']],
    magnetic_module:[['engage','Engage magnets (height from base mm)'],['disengage','Disengage magnets']],
    custom_device:[['manual_handoff','Operator handoff: perform and confirm external-device step']]
  };
  function moduleFamily(m){
    if (m?.custom) return 'custom_device';
    if (m?.family) return m.family;
    const n=(m?.api_load_name||'').toLowerCase();
    if(n.includes('shaker'))return 'heater_shaker';if(n.includes('thermocycler'))return 'thermocycler';
    if(n.includes('temperature'))return 'temperature_module';if(n.includes('magnetic'))return 'magnetic_module';
    return 'unknown';
  }
  function allowedModuleActions(m){
    if(m?.custom){const extra=(Array.isArray(m.operations)?m.operations:[]).slice(0,8).map((label,i)=>['manual_'+i,'Operator: '+label]);return [...MODULE_ACTIONS.custom_device,...extra];}
    return MODULE_ACTIONS[moduleFamily(m)] || [['manual_handoff','Operator check / unsupported operation']];
  }
  const byType = Object.fromEntries(TYPES.map(x => [x[0], { label:x[1], group:x[2], help:x[3] }]));
  const pipetteKnown = {
    p20_single_gen2:{max:20,min:1,channels:1},p300_single_gen2:{max:300,min:20,channels:1},p1000_single_gen2:{max:1000,min:100,channels:1},
    p20_multi_gen2:{max:20,min:1,channels:8},p300_multi_gen2:{max:300,min:20,channels:8}
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = x => Number(x);
  const apiAtLeast = (actual, required) => {const [a,b]=String(actual).split('.').map(Number);const [c,d]=String(required).split('.').map(Number);return a>c||(a===c&&b>=d);};
  const pyNum = x => Number.isFinite(num(x)) ? String(num(x)) : '0';
  let labwareDefinitions = [];
  let labware = [];
  let blocks = [];
  let idCounter = 1;
  let selectedId = null;
  let gallery = {mounted_pipettes:[], placed_modules:[]};
  let ready = false;
  let dragging = null;
  let moduleReady = false;
  let plan = null;
  const hardware = () => ({pipettes:gallery.mounted_pipettes||[],modules:gallery.placed_modules||[],labware});
  const blockId = () => `block-${idCounter++}`;
  const labId = () => `lab-${idCounter++}`;
  const findLab = id => labware.find(x => x.id === id);
  const findPipette = id => hardware().pipettes.find(x => x.mount === id);
  const def = name => labwareDefinitions.find(d => d.loadName === name);
  const tipRequirement = model => model.includes('p1000') ? '1000ul' : model.includes('p20') ? '20ul' : '300ul';
  const pipInfo = mount => pipetteKnown[findPipette(mount)?.api_load_name];
  const compatibleRack = (mount, id) => !!findLab(id) && def(findLab(id).load_name)?.tipRack && findLab(id).load_name.includes(tipRequirement(findPipette(mount)?.api_load_name||''));
  const racks = () => labware.filter(l => def(l.load_name)?.tipRack);
  const plates = () => labware.filter(l => !def(l.load_name)?.tipRack);
  const wellNames = l => { const g=def(l?.load_name)?.wellGeometry; if (!g) return wells; return Array.from({length:g.columns||12},(_,c)=>Array.from({length:g.rows||8},(_,r)=>`${String.fromCharCode(65+r)}${c+1}`)).flat(); };
  const validWell = (l,w) => wellNames(l).includes(w);
  const moduleByUid = uid => hardware().modules.find(m=>m.uid===uid);
  const parentModule = l => l?.moduleUid ? moduleByUid(l.moduleUid) : null;
  const listWells = text => String(text||'').split(/[,;\s]+/).map(v=>v.trim().toUpperCase()).filter(Boolean);
  function save() {
    try {localStorage.setItem(HWSTORE,JSON.stringify(labware)); localStorage.setItem(STORE,JSON.stringify({blocks,name:$('flowName').value,api:$('flowApi').value,idCounter}));} catch(e){console.warn(e)}
  }
  function restore() {
    try {
      let rawHardware = null, rawFlow = null;
      try { rawHardware = localStorage.getItem(HWSTORE); rawFlow = localStorage.getItem(STORE) } catch(e) { /* restricted iframe / file preview */ }
      const saved = JSON.parse(rawHardware || 'null');
      if (Array.isArray(saved)) labware = saved.filter(l => Number.isInteger(num(l.slot)) && def(l.load_name)).map(l => ({...l,slot:num(l.slot)}));
      else labware = [
        {id:labId(),load_name:'nest_96_wellplate_200ul_flat',slot:6,role:'source',label:'Source plate'},
        {id:labId(),load_name:'opentrons_96_wellplate_200ul_pcr_full_skirt',slot:2,role:'destination',label:'Destination plate'},
        {id:labId(),load_name:'opentrons_96_tiprack_300ul',slot:3,role:'tips',label:'Tip rack'}
      ];
      const workflow = JSON.parse(rawFlow||'null');
      if (workflow && Array.isArray(workflow.blocks)) {
        blocks = workflow.blocks.filter(b => byType[b.type]).slice(0,300);
        if (typeof workflow.name==='string') $('flowName').value=workflow.name;
        if (['2.15','2.20','2.28'].includes(workflow.api)) $('flowApi').value=workflow.api;
        idCounter=Math.max(idCounter,Number(workflow.idCounter)||1);
      } else blocks = [makeBlock('transfer')];
      idCounter=Math.max(idCounter,...[...labware,...blocks].map(x => Number(String(x.id).match(/\d+$/)?.[0]||0)+1));
    } catch(e){ console.warn('Could not restore visual blocks',e); if(!labware.length)labware=[{id:labId(),load_name:'nest_96_wellplate_200ul_flat',slot:6,role:'source',label:'Source plate'},{id:labId(),load_name:'opentrons_96_wellplate_200ul_pcr_full_skirt',slot:2,role:'destination',label:'Destination plate'},{id:labId(),load_name:'opentrons_96_tiprack_300ul',slot:3,role:'tips',label:'Tip rack'}];blocks=[makeBlock('transfer')]; }
  }
  function makeBlock(type) {
    const p=hardware().pipettes[0]?.mount || 'right';
    const src=plates().find(x=>x.role==='source')||plates()[0];
    const dst=plates().find(x=>x.role==='destination')||plates()[1]||plates()[0];
    const rack=racks().find(x=>compatibleRack(p,x.id))||racks()[0];
    const prior=blocks.filter(x=>x.type==='transfer').length;
    const order=(pipInfo(p)?.channels===8?columnWells:wells);
    const nextWell=order[prior % order.length]||'A1';
    const volume=Math.min(50,pipInfo(p)?.max||50);
    const firstModule=hardware().modules[0];
    return {id:blockId(),type,moduleUid:firstModule?.uid||'',moduleAction:allowedModuleActions(firstModule)[0][0],moduleValue:37,profile:'95:30,55:30,72:60',profileCycles:20,pipette:p,source:src?.id||'',destination:dst?.id||'',target:(type==='dispense'?dst:src)?.id||'',rack:rack?.id||'',
      sourceWell:nextWell,destWell:nextWell,well:nextWell,tipWell:nextWell,volume,wellList:nextWell,tipPolicy:'once',touchTip:false,mixCycles:0,mixVolume:Math.min(20,volume),reference:'bottom',z:1,repetitions:3,seconds:5,radius:1,offset:-1,message:'Check the OT-2 setup before continuing'};
  }
  function validSlots() {
    const reserved = new Set(hardware().modules.flatMap(m => m.reserved_slots?.length ? m.reserved_slots.map(Number) : [Number(m.location)]));
    return Array.from({length:11},(_,i)=>i+1).filter(slot=>!reserved.has(slot));
  }
  function publishLabware() {
    window.lifefabsDeckLabware=labware.map(l=>({...l,display_name:def(l.load_name)?.displayName,stackedOnModule:!!parentModule(l)}));
    window.lifefabsOccupiedLabwareSlots=labware.filter(l=>!parentModule(l)).map(l=>num(l.slot));
    window.lifefabsGallery?.render();
  }
  function tellHardware(text, bad=false) {
    $('hwLabwareFeedback').textContent=text;
    $('hwLabwareFeedback').dataset.error=String(bad);
  }
  function importOfficialDefinition(raw) {
    if(!raw||!raw.parameters||!raw.wells||!raw.ordering||!raw.dimensions)throw Error('Expected an Opentrons labware definition JSON (with wells, ordering, dimensions, parameters).');
    const name=raw.parameters.loadName,ordering=raw.ordering,grid=ordering.flat();
    if(!name||!grid.length||!grid.every(w=>raw.wells[w]))throw Error('Missing official load name or well details.');
    const rowCount=ordering[0].length,colCount=ordering.length;
    if(!ordering.every(c=>c.length===rowCount)||rowCount>16||colCount>48)throw Error('Only rectangular regular-grid well layouts are supported in this preview.');
    const start=raw.wells[ordering[0][0]],right=raw.wells[ordering[1]?.[0]]||start,down=raw.wells[ordering[0][1]]||start;
    const dx=right.x-start.x,dy=start.y-down.y;
    if((colCount>1&&dx<=0)||(rowCount>1&&dy<=0))throw Error('Irregular orientation/layout cannot be visualized safely.');
    const tol=0.08;
    for(let c=0;c<colCount;c++)for(let r=0;r<rowCount;r++){
      const w=raw.wells[ordering[c][r]];
      if(Math.abs(w.x-(start.x+c*dx))>tol||Math.abs(w.y-(start.y-r*dy))>tol)throw Error('Nonuniform well grid: cannot produce accurate slot geometry.');
    }
    const d={loadName:name,displayName:raw.metadata?.displayName||name,brand:raw.brand?.brand||'Custom official definition',definitionUrl:'User-provided JSON',dimensions:raw.dimensions,custom:true,
      tipRack:!!raw.parameters.isTiprack,wellGeometry:{rows:rowCount,columns:colCount,xFirst:start.x,yFirst:start.y,zBottom:start.z,depth:start.depth,xPitch:dx,yPitch:dy,diameter:start.diameter||null,length:start.length||null,width:start.width||null,capacityUL:start.totalLiquidVolume||0}};
    labwareDefinitions=labwareDefinitions.filter(x=>x.loadName!==name);labwareDefinitions.push(d);
    try{localStorage.setItem(CUSTOM_DEFS,JSON.stringify(labwareDefinitions.filter(x=>x.custom)));}catch(e){console.warn(e)}
    window.lifefabsCore?.registerLabwareDefinition(d);
    renderHardware();tellHardware(`Definition ${name} imported. Place it in Section 1 to synchronize map and Python.`);
  }
  function renderHardware() {
    const free=validSlots().filter(slot=>!labware.some(x=>x.slot===slot));
    const type=$('hwLabwareType'), prev=type.value;
    type.innerHTML=labwareDefinitions.map(d=>`<option value="${escape(d.loadName)}">${escape(d.displayName)}</option>`).join('');
    if (prev && def(prev)) type.value=prev;
    const role=$('hwLabwareRole');
    role.value=def(type.value)?.tipRack?'tips':role.value;
    const sel=$('hwLabwareSlot'), old=sel.value;
    sel.innerHTML=free.map(n=>`<option value="${n}">Slot ${n}</option>`).join('');
    if(free.includes(num(old)))sel.value=old;
    $('hwAddLabware').disabled=!free.length;
    $('hwPlacedLabware').innerHTML=labware.map(l=>{
      const d=def(l.load_name);const slots=validSlots().filter(x=>(x===l.slot&&!l.moduleUid)||!labware.some(y=>y!==l&&y.slot===x));
      const parent=parentModule(l);const supported=hardware().modules.filter(m=>!m.custom&&['thermocycler','temperature_module','heater_shaker','magnetic_module'].includes(moduleFamily(m)));
      const parentOptions=`<option value="" ${!l.moduleUid?'selected':''}>Directly on deck</option>`+supported.map(m=>`<option value="${escape(m.uid)}" ${l.moduleUid===m.uid?'selected':''}>On ${escape(m.name)} · slot ${m.location}</option>`).join('');
      return `<article class="hw-lab-card" draggable="true" data-hw-id="${escape(l.id)}">
        <div class="hw-lab-label"><span class="hw-lab-icon">${d?.tipRack?'▤':'▦'}</span><div><strong>${escape(l.label)}</strong><small>${escape(d?.displayName||l.load_name)}</small></div></div>
        <label>Purpose<select data-hw-prop="role" aria-label="Purpose for ${escape(l.label)}"><option value="source" ${l.role==='source'?'selected':''}>Source</option><option value="destination" ${l.role==='destination'?'selected':''}>Destination</option><option value="labware" ${l.role==='labware'?'selected':''}>Other</option><option value="tips" ${l.role==='tips'?'selected':''}>Tips</option></select></label>
        <label>Mounting<select data-hw-prop="moduleUid" aria-label="Parent module for ${escape(l.label)}">${parentOptions}</select></label>
        <label>Slot<select data-hw-prop="slot" aria-label="Slot for ${escape(l.label)}">${slots.map(n=>`<option value="${n}" ${l.slot===n?'selected':''}>${n}</option>`).join('')}</select></label>
        <button type="button" data-hw-remove="${escape(l.id)}" class="flow-icon-btn" aria-label="Remove ${escape(l.label)}">×</button>
        </article>`;
    }).join('')||'<p class="flow-empty">No labware placed. Add plates and tip racks to begin.</p>';
    publishLabware();
  }
  function hardwareChanged() {save();renderHardware();renderBlocks();renderInspector();compileAndSync();}
  function canPlace(slot,ignoreId=null) {
    if(!validSlots().includes(num(slot)))return `Slot ${slot} is reserved by a module or is invalid.`;
    if(labware.some(x=>x.id!==ignoreId&&num(x.slot)===num(slot)&&!x.moduleUid))return `Slot ${slot} already contains labware.`;
    return '';
  }
  function setSlot(id,slot){const l=findLab(id);if(!l)return;const error=canPlace(slot,id);if(error)return tellHardware(error,true);l.moduleUid='';l.slot=num(slot);tellHardware(`${l.label} moved to slot ${slot}. Viewer and Python updated.`);hardwareChanged();}
  function addLabware(){
    const name=$('hwLabwareType').value,slot=num($('hwLabwareSlot').value),d=def(name);const error=canPlace(slot);
    if(!d||error)return tellHardware(error||'Choose valid labware.',true);
    const role=d.tipRack?'tips':$('hwLabwareRole').value;
    const counter=labware.filter(x=>x.role===role).length+1;
    const label=role==='tips'?`Tip rack ${counter}`:role==='source'?`Source ${counter}`:role==='destination'?`Destination ${counter}`:`Labware ${counter}`;
    labware.push({id:labId(),load_name:name,slot,role,label});tellHardware(`${label} added in slot ${slot}; map and block targets updated.`);hardwareChanged();
  }
  const options=(items,value) => items.map(it=>`<option value="${escape(it.id)}" ${it.id===value?'selected':''}>${escape(it.label)} · slot ${it.slot}</option>`).join('');
  const sel=(key,label,items,value) => `<label class="flow-field">${label}<select data-block-key="${key}" ${items.length?'':'disabled'}>${options(items,value)}</select></label>`;
  const nfield=(key,label,val,min,max,step=1,unit='')=>`<label class="flow-field">${label}<div class="flow-input-unit"><input type="number" data-block-key="${key}" value="${escape(val)}" min="${min}" max="${max}" step="${step}"><span>${unit}</span></div></label>`;
  const txt=(key,label,value)=>`<label class="flow-field">${label}<textarea rows="3" data-block-key="${key}">${escape(value)}</textarea></label>`;
  const wellSelect=(key,label,value,channels=1)=>`<label class="flow-field">${label}<select data-block-key="${key}">${(channels===8?columnWells:wells).map(w=>`<option value="${w}" ${w===value?'selected':''}>${w}</option>`).join('')}</select></label>`;
  function blockCaption(b) {
    const source=findLab(b.source)?.label||'Missing source',dest=findLab(b.destination)?.label||'Missing destination',target=findLab(b.target)?.label||'Missing labware';
    if(['distribute','consolidate'].includes(b.type))return `${b.volume} µL per well · ${source} → ${dest} · ${b.wellList||'choose wells'}`;
    if(b.type==='transfer')return `${b.volume} µL · ${source} ${b.sourceWell} → ${dest} ${b.destWell}`;
    if(b.type==='pickup')return `${findLab(b.rack)?.label||'No tip rack'} · ${b.tipWell}`;
    if(b.type==='aspirate'||b.type==='dispense'||b.type==='mix')return `${b.volume} µL · ${target} ${b.well} · ${b.reference}${b.reference==='center'?'':` ${b.z} mm`}`;
    if(b.type==='touch')return `${target} ${b.well} · rim offset ${b.offset} mm`;
    if(b.type==='move'||b.type==='blowout')return `${target} ${b.well} · ${b.reference}`;
    if(b.type==='airgap')return `${b.volume} µL of air`;
    if(b.type==='drop')return 'Dispose of the attached tip';
    if(b.type==='delay')return `${b.seconds} seconds`;
    if(b.type==='pause')return b.message;
    if(b.type==='module'){const m=hardware().modules.find(x=>x.uid===b.moduleUid);return `${m?.name||'Choose a placed module'} · ${b.moduleAction} · ${b.moduleValue}`;}
    return '';
  }
  function renderBlocks() {
    const root=$('flowBlocks');if(!root)return;
    root.innerHTML=blocks.map((b,i)=>`<div class="flow-insert" data-insert="${i}" tabindex="0" role="button" aria-label="Insert block before step ${i+1}"><span>＋</span></div>
      <article role="listitem" draggable="true" tabindex="0" data-flow-id="${escape(b.id)}" class="flow-block flow-${escape(byType[b.type]?.group.toLowerCase()||'liquid')} ${b.id===selectedId?'selected':''}" aria-label="Step ${i+1}: ${escape(byType[b.type]?.label)}">
      <span class="flow-block-grip" aria-hidden="true">⠿</span><div class="flow-block-main"><div class="flow-block-title"><span class="flow-block-number">${String(i+1).padStart(2,'0')}</span><strong>${escape(byType[b.type]?.label)}</strong><span class="flow-block-chevron">▸</span></div><small>${escape(blockCaption(b))}</small></div>
      <div class="flow-block-actions"><button type="button" data-flow-duplicate="${escape(b.id)}" title="Duplicate block" aria-label="Duplicate step ${i+1}">⧉</button><button type="button" data-flow-remove="${escape(b.id)}" title="Remove block" aria-label="Remove step ${i+1}">×</button></div></article>`).join('')+`<div class="flow-insert" data-insert="${blocks.length}" tabindex="0" role="button" aria-label="Insert block at end"><span>＋ Add next block</span></div>`;
    $('flowCount').textContent=`${blocks.length} block${blocks.length===1?'':'s'}`;
  }
  function renderInspector() {
    const b=blocks.find(x=>x.id===selectedId);
    if(!b){$('flowInspectorTitle').textContent='Select a block';$('flowInspectorSubtitle').textContent='Click a colored block to set its parameters.';$('flowInspector').innerHTML='<p class="flow-empty">Select or add a block. Its real hardware targets, volumes and positions appear here.</p>';return;}
    $('flowInspectorTitle').textContent=byType[b.type].label;
    $('flowInspectorSubtitle').textContent=byType[b.type].help;
    const p=hardware().pipettes.map(x=>({id:x.mount,label:`${x.name} · ${x.mount}`,slot:'mount'}));
    const info=pipInfo(b.pipette);const channels=info?.channels||1;
    const t=['delay','pause','module'].includes(b.type);
    let html='';
    if(!t)html+=sel('pipette','Mounted pipette',p,b.pipette);
    if(b.type==='module'){
      const mods=hardware().modules.map(m=>({id:m.uid,label:m.name,slot:m.location}));
      const m=hardware().modules.find(x=>x.uid===b.moduleUid)||hardware().modules[0];
      html+=sel('moduleUid','Placed module / custom device',mods,b.moduleUid);
      const actions=allowedModuleActions(m);
      html+=`<label class="flow-field">Action<select data-block-key="moduleAction">${actions.map(([key,label])=>`<option value="${escape(key)}" ${b.moduleAction===key?'selected':''}>${escape(label)}</option>`).join('')}</select></label>`;
      const val=b.moduleAction||'';
      if(['set_temperature','start_set_temperature','set_lid_temperature','set_block_temperature','set_and_wait_for_temperature','set_target_temperature'].includes(val))html+=nfield('moduleValue','Target temperature',b.moduleValue,4,110,1,'°C');
      if(val==='set_and_wait_for_shake_speed')html+=nfield('moduleValue','Shaker speed',b.moduleValue,200,3000,50,'rpm');
      if(val==='engage')html+=nfield('moduleValue','Height from labware base',b.moduleValue,0,25,0.5,'mm');
      if(val==='execute_profile'){html+=`<label class="flow-field">Profile (°C : seconds, comma-separated)<input type="text" data-block-key="profile" value="${escape(b.profile)}" placeholder="95:30,55:30,72:60"></label>`+nfield('profileCycles','Profile repetitions',b.profileCycles,1,99,1,'cycles');}
      if(val==='manual_handoff'||/^manual_[0-7]$/.test(val))html+=txt('message','Operator instructions (include external controller and clearance steps)',b.message);
      html+='<p class="flow-field-note">Standard operations generate only documented module-context calls. Custom devices generate a pause for a trained operator; no external-device Python driver is assumed. Real hardware compatibility and safe movement must be checked separately.</p>';
    }
    if(['transfer','distribute','consolidate'].includes(b.type)){
      html+=sel('source','Source labware',plates(),b.source)+wellSelect('sourceWell','Source well / column',b.sourceWell,channels);
      html+=sel('destination','Destination labware',plates(),b.destination)+wellSelect('destWell','Destination well / column',b.destWell,channels);
      html+=sel('rack','Tip rack (must match pipette)',racks(),b.rack)+wellSelect('tipWell','New tip / column',b.tipWell,channels);
      html+=nfield('volume','Volume per destination / source',b.volume,0.1,1000,0.5,'µL');
      if(b.type!=='transfer')html+=`<label class="flow-field">${b.type==='distribute'?'Destination':'Source'} wells (comma separated; cherry-pick any wells)<input type="text" data-block-key="wellList" value="${escape(b.wellList||'A1')}" placeholder="A1, C3, H12"></label><p class="flow-field-note">Uses Opentrons ${b.type}() with the selected well list. The API chooses the exact aspiration/refill/tip movements; viewer targets are illustrative, not a full command expansion.</p>`;
      if(b.type==='transfer')html+=`<label class="flow-field">Touch tip after aspirate/dispense <select data-block-key="touchTip"><option value="false" ${!b.touchTip?'selected':''}>No</option><option value="true" ${b.touchTip?'selected':''}>Yes</option></select></label>`;
    } else if(b.type==='pickup'){
      html+=sel('rack','Tip rack',racks(),b.rack)+wellSelect('tipWell','Tip well / column',b.tipWell,channels);
    } else if(['aspirate','dispense','mix','move','blowout','touch'].includes(b.type)){
      html+=sel('target','Placed labware',plates(),b.target)+wellSelect('well','Well / column',b.well,channels);
      if(['aspirate','dispense','mix'].includes(b.type))html+=nfield('volume','Volume',b.volume,0.1,1000,0.5,'µL');
      if(b.type==='mix')html+=nfield('repetitions','Cycles',b.repetitions,1,100,1,'times');
    } else if(b.type==='airgap') html+=nfield('volume','Air volume',b.volume,0.1,1000,0.5,'µL');
    if(['aspirate','dispense','mix','move','blowout','transfer'].includes(b.type)){
      html+=`<label class="flow-field">Tip reference<select data-block-key="reference"><option value="bottom" ${b.reference==='bottom'?'selected':''}>Bottom + clearance</option><option value="center" ${b.reference==='center'?'selected':''}>Well center</option><option value="top" ${b.reference==='top'?'selected':''}>Top / rim + offset</option></select></label>`;
      if(b.reference!=='center')html+=nfield('z',b.reference==='top'?'Offset from top (negative = below rim)':'Clearance above bottom',b.z,-30,50,0.5,'mm');
    }
    if(b.type==='touch')html+=nfield('offset','Vertical rim offset',b.offset,-10,10,0.5,'mm')+nfield('radius','Rim radius fraction',b.radius,0,1,0.1,'');
    if(b.type==='delay')html+=nfield('seconds','Wait time',b.seconds,0,36000,1,'s');
    if(b.type==='pause')html+=txt('message','Message to operator',b.message);
    if(b.type==='drop')html+='<p class="flow-field-note">Drop the currently attached tip into the OT-2 fixed trash. Its physical coordinates are resolved by the robot, not by this diagram.</p>';
    html+=`<div class="flow-inspector-actions"><button type="button" id="flowMoveUp" class="button button-outline button-small">↑ Up</button><button type="button" id="flowMoveDown" class="button button-outline button-small">↓ Down</button></div>`;
    $('flowInspector').innerHTML=html;
  }
  function selectBlock(id){selectedId=id;renderBlocks();renderInspector();}
  function insertBlock(type,index=blocks.length) {
    if(blocks.length>=300)return $('flowStatus').textContent='Maximum of 300 blocks in this teaching editor.';
    const b=makeBlock(type);blocks.splice(index,0,b);selectBlock(b.id);changed(true);
  }
  function changed(visual=true){save();if(visual)renderBlocks();compileAndSync();}
  function validateAndCompile(){
    const hw=hardware(),errors=[],lines=[],steps=[],warnings=[];
    const usedSlots=new Set(),pt={},pipetteNames={},labNames={},rackNames={};
    const api=$('flowApi').value;
    if(blocks.some(b=>!['module','delay','pause'].includes(b.type))&&!hw.pipettes.length)errors.push('Mount at least one supported pipette in Hardware Configurator.');
    hw.pipettes.forEach(p=>{
      if(!pipetteKnown[p.api_load_name])errors.push(`${p.name} (${p.api_load_name}) is not in the validated protocol-builder model.`);
      if(pipetteKnown[p.api_load_name])pipetteNames[p.mount]=`pipette_${p.mount}`;
    });
    for(const l of hw.labware){
      if(!Number.isInteger(l.slot)||l.slot<1||l.slot>11)errors.push(`${l.label} has invalid slot ${l.slot}.`);
      if(!l.moduleUid && usedSlots.has(l.slot))errors.push(`Two labware items occupy slot ${l.slot}.`);
      if(!l.moduleUid)usedSlots.add(l.slot);
      if(!def(l.load_name))errors.push(`${l.label}: ${l.load_name} has no bundled labware definition.`);
    }
    hw.modules.forEach(m=>(m.reserved_slots||[m.location]).forEach(slot=>{if(usedSlots.has(num(slot)))errors.push(`Module ${m.name} conflicts with standalone labware in slot ${slot}.`)}));
    if(hw.labware.filter(l=>l.moduleUid).some((l,i,arr)=>arr.findIndex(other=>other.moduleUid===l.moduleUid)!==i))errors.push('Only one labware item may be stacked on each module.');
    if(blocks.some(b=>!['module','delay','pause'].includes(b.type))&&!hw.labware.length)errors.push('Place at least one labware item in Section 1.');
    const header=[
      'from opentrons import protocol_api','',
      `metadata = {"protocolName": ${JSON.stringify($('flowName').value||'LifeFabs visual protocol')}, "author": "LifeFabs visual blocks"}`,
      `requirements = {"robotType": "OT-2", "apiLevel": ${JSON.stringify(api)}}`,'',
      'def run(protocol: protocol_api.ProtocolContext):',
      '    # Generated ONLY from Section 1: placed hardware and Section 3: blocks.'
    ];
    lines.push(...header);
    const moduleNames={};
    hw.modules.forEach((m,i)=>{
      if(m.custom){lines.push(`    # EXTERNAL DEVICE: ${String(m.name).replace(/[\r\n]/g,' ')} (slot ${m.location}) — no Opentrons module driver`);return;}
      const min=window.lifefabsGallery?.getCatalogue().find(x=>x.api_load_name===m.api_load_name)?.min_api_version;
      if(min&&!apiAtLeast(api,min))errors.push(`${m.name} requires API ${min} or newer, but protocol uses ${api}.`);
      moduleNames[m.uid]=`module_${i+1}`;
      lines.push(`    ${moduleNames[m.uid]} = protocol.load_module(${JSON.stringify(m.api_load_name)}, ${JSON.stringify(String(m.location))})`);
    });
    hw.labware.forEach((l,i)=>{
      const v=`labware_${i+1}`;labNames[l.id]=v;
      const m=l.moduleUid&&moduleByUid(l.moduleUid);
      if(l.moduleUid&&!m)errors.push(`${l.label}: its parent module was removed. Reassign it in Section 1.`);
      if(m&&m.custom)errors.push(`${l.label}: custom modules cannot be treated as an Opentrons module labware parent.`);
      if(m){
        if(!moduleNames[m.uid])errors.push(`${l.label}: parent ${m.name} has no supported module context.`);
        lines.push(`    ${v} = ${moduleNames[m.uid]||'MISSING_MODULE'}.load_labware(${JSON.stringify(l.load_name)})  # ${l.label} on ${m.name}`);
        warnings.push(`${l.label}: verify the selected labware fits ${m.name} and meets latch/adapter requirements; no adapter compatibility engine is implemented.`);
      }else lines.push(`    ${v} = protocol.load_labware(${JSON.stringify(l.load_name)}, ${JSON.stringify(String(l.slot))})  # ${l.label}`);
    });
    hw.pipettes.forEach(p=>{
      const v=pipetteNames[p.mount];if(!v)return;
      const tipIds=hw.labware.filter(x=>compatibleRack(p.mount,x.id)).map(x=>labNames[x.id]);
      if(!tipIds.length)errors.push(`No compatible tip rack placed for ${p.api_load_name} on ${p.mount}. Add ${tipRequirement(p.api_load_name)} tips in Hardware Configurator.`);
      lines.push(`    ${v} = protocol.load_instrument(${JSON.stringify(p.api_load_name)}, mount=${JSON.stringify(p.mount)}, tip_racks=[${tipIds.join(', ')}])`);
    });
    if(hw.modules.some(m=>m.custom))warnings.push('Custom devices are not recognized Opentrons modules. Their steps require operator-controlled handoffs; no driver or automated synchronization is implied.');
    lines.push('');
    const live={},usedTips=new Set();
    hw.pipettes.forEach(p=>{live[p.mount]={tip:false,ul:0};});
    const event=(type,b,lab,well,volume,note)=>{
      let point=null;
      if(lab&&well&&def(lab.load_name)&&['aspirate','dispense','mix','move','blowout','touch','transfer-aspirate','transfer-dispense'].includes(type)){
        point=window.lifefabsCore?.targetPosition(def(lab.load_name),lab.slot,well,type==='touch'?'top':b.reference,type==='touch'?num(b.offset):b.reference==='center'?0:num(b.z),{known:false,x:0,y:0,z:0})||null;
      }
      steps.push({kind:type.replace('transfer-',''),label:byType[b.type]?.label+ (volume?` · ${volume} µL`:''),note:note||`${lab?.label||'Hardware'} · ${well||'—'} · nominal requested tip endpoint; not a collision-safe motion.`,slot:lab?.slot,labwareName:lab?.load_name,well,pipetteModel:findPipette(b.pipette)?.api_load_name,channels:pipInfo(b.pipette)?.channels||1,point,volume,transferIndex:steps.length+1});
    };
    const address=(l,well,b)=>`${labNames[l?.id]||'UNDEFINED_LABWARE'}[${JSON.stringify(well)}]${b.reference==='center'?'.center()':b.reference==='top'?`.top(z=${pyNum(b.z)})`:`.bottom(z=${pyNum(b.z)})`}`;
    const wellOkay=(p,w,lab)=> validWell(lab,w) && (pipInfo(p)?.channels!==8 || /^A[1-9][0-9]*$/.test(w));
    const checkWell=(p,w,l,context)=>{if(!l)errors.push(`${context}: select a placed labware item.`);if(!wellOkay(p,w,l))errors.push(`${context}: well ${w} is invalid for the selected pipette.`);};
    const checkTarget=(b,l,v,context)=>{
      const d=def(l?.load_name),depth=num(d?.wellGeometry?.depth),capacity=num(d?.wellGeometry?.capacityUL);
      if(!d)return;
      if(Number.isFinite(v)&&v>0&&Number.isFinite(capacity)&&v>capacity)errors.push(`${context}: ${v} µL exceeds the labware's ${capacity} µL nominal well capacity.`);
      if(b.reference==='bottom'&&(!Number.isFinite(num(b.z))||num(b.z)<0.5||Number.isFinite(depth)&&num(b.z)>=depth))errors.push(`${context}: bottom clearance must be ≥0.5 mm and below the defined well depth (${depth} mm).`);
      if(b.reference==='top'&&(!Number.isFinite(num(b.z))||num(b.z)<-10||num(b.z)>10))errors.push(`${context}: top-relative Z offset must be between -10 and +10 mm.`);
    };
    const useTip=(b,blk)=>{
      const rack=findLab(b.rack),tipKey=`${b.rack}:${b.tipWell}`;
      if(!compatibleRack(b.pipette,b.rack))errors.push(`${blk}: select a matching, placed tip rack for ${b.pipette}.`);
      checkWell(b.pipette,b.tipWell,rack,`${blk} tip`);
      if(usedTips.has(tipKey))errors.push(`${blk}: tip ${b.tipWell} was already used in ${rack?.label||'that rack'}.`);
      usedTips.add(tipKey);return `${labNames[b.rack]||'MISSING_RACK'}[${JSON.stringify(b.tipWell)}]`;
    };
    blocks.forEach((b,index)=>{
      const name=`Block ${index+1} (${byType[b.type]?.label||b.type})`;
      if(!['delay','pause','module'].includes(b.type)&&!pipetteNames[b.pipette])errors.push(`${name}: select a pipette currently mounted in Section 1.`);
      const pip=pipetteNames[b.pipette]||'MISSING_PIPETTE',spec=pipInfo(b.pipette),l=live[b.pipette];
      const vol=num(b.volume),hasVolume=['transfer','aspirate','dispense','mix','airgap'].includes(b.type);
      if(hasVolume&&(!Number.isFinite(vol)||vol<=0||spec&&vol>spec.max))errors.push(`${name}: volume must be positive and no greater than ${spec?.max||'the pipette maximum'} µL.`);
      if(hasVolume&&spec&&vol<spec.min)warnings.push(`${name}: ${vol} µL is below the nominal ${spec.min} µL working range.`);
      const pstr=`    # ${index+1}. ${byType[b.type].label}`;lines.push(pstr);
      if(b.type==='module'){
        const m=hw.modules.find(x=>x.uid===b.moduleUid);
        const allowed=allowedModuleActions(m);
        if(!m) errors.push(`${name}: select a module presently placed in Section 1.`);
        else if(!allowed.some(([action])=>action===b.moduleAction))errors.push(`${name}: ${b.moduleAction} is not a supported action for ${m.name}.`);
        else if(b.moduleAction==='manual_handoff'||/^manual_[0-7]$/.test(b.moduleAction)){
          const preset=/^manual_[0-7]$/.test(b.moduleAction)?String((m.operations||[])[Number(b.moduleAction.slice(7))]||'')+' — ':'';
          const instruction=(preset+String(b.message||'Perform external device action and confirm safe clearance')).slice(0,500);
          lines.push(`    protocol.pause(${JSON.stringify('EXTERNAL DEVICE '+m.name+' (slot '+m.location+'): '+instruction)})`);
          warnings.push(`${name}: custom or unsupported hardware requires manual operation and separate safety review.`);
        } else {
          const v=Number(b.moduleValue),method=b.moduleAction,context=moduleNames[m.uid];
          const tempMethods=['set_temperature','start_set_temperature','set_lid_temperature','set_block_temperature','set_and_wait_for_temperature','set_target_temperature'];
          if(tempMethods.includes(method)){
            const [lo,hi]=method==='set_lid_temperature'?[37,110]:method==='set_block_temperature'?[4,99]:moduleFamily(m)==='heater_shaker'?[20,95]:[4,95];
            if(!Number.isFinite(v)||v<lo||v>hi)errors.push(`${name}: temperature must be within ${lo}–${hi} °C.`);
            if(method==='start_set_temperature'&&!apiAtLeast(api,'2.27'))errors.push(`${name}: concurrent temperature setting requires API 2.27 or later.`);
            lines.push(`    ${context}.${method}(${pyNum(v)})`);
          } else if(method==='set_and_wait_for_shake_speed'){
            if(!Number.isInteger(v)||v<200||v>3000)errors.push(`${name}: shaker speed must be 200–3000 rpm.`);
            lines.push(`    ${context}.${method}(${pyNum(v)})`);
          } else if(method==='engage'){
            if(!Number.isFinite(v)||v<0||v>25)errors.push(`${name}: magnet height must be 0–25 mm.`);
            lines.push(`    ${context}.engage(height_from_base=${pyNum(v)})`);
          } else if(method==='execute_profile'){
            const parts=String(b.profile||'').split(',').map(x=>x.trim()).filter(Boolean);
            const cycles=Number(b.profileCycles);
            const parsed=parts.map(x=>x.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/));
            if(!parts.length||parts.length>20||parsed.some(x=>!x||Number(x[1])<4||Number(x[1])>99||Number(x[2])<=0||Number(x[2])>3600)||!Number.isInteger(cycles)||cycles<1||cycles>99)errors.push(`${name}: use 1–20 profile stages °C:seconds (4–99°C, 1–3600s) and 1–99 repetitions.`);
            const stages=parsed.filter(Boolean).map(x=>`{"temperature": ${Number(x[1])}, "hold_time_seconds": ${Number(x[2])}}`);
            lines.push(`    ${context}.execute_profile(steps=[${stages.join(', ')}], repetitions=${Number.isInteger(cycles)?cycles:1})`);
          } else if(['open_lid','close_lid','deactivate_lid','deactivate_block','open_labware_latch','close_labware_latch','deactivate_shaker','deactivate_heater','disengage','deactivate'].includes(method)) {
            lines.push(`    ${context}.${method}()`);
          } else errors.push(`${name}: the operation is not implemented for Python generation.`);
          if(moduleFamily(m)==='heater_shaker'&&method==='set_and_wait_for_shake_speed')warnings.push(`${name}: close the latch first and verify the documented pipette/deck clearance restrictions.`);
        }
        event('module',b,null,null,0,`${m?.name||'Module'}: ${b.moduleAction}; slot ${m?.location||'?'}. Module behavior is not physically simulated.`);
      } else if(b.type==='distribute'||b.type==='consolidate'){
        const src=findLab(b.source),dst=findLab(b.destination),multi=listWells(b.wellList);
        if(!multi.length||multi.length>96||new Set(multi).size!==multi.length)errors.push(`${name}: choose 1–96 distinct wells.`);
        if(l?.tip)errors.push(`${name}: a tip is already attached; finish its lifecycle first.`);
        const single=b.type==='distribute'?src:dst, many=b.type==='distribute'?dst:src;
        checkWell(b.pipette,b.type==='distribute'?b.sourceWell:b.destWell,single,`${name} fixed well`);
        multi.forEach(w=>checkWell(b.pipette,w,many,name));
        if(!src||!dst||def(src.load_name)?.tipRack||def(dst.load_name)?.tipRack)errors.push(`${name}: choose placed, non-tip labware.`);
        if(!racks().some(r=>compatibleRack(b.pipette,r.id)))errors.push(`${name}: a matching tip rack is required.`);
        const fixed=(b.type==='distribute'?labNames[b.source]:labNames[b.destination]);
        const spread=(b.type==='distribute'?labNames[b.destination]:labNames[b.source]);
        const fixedWell=b.type==='distribute'?b.sourceWell:b.destWell;
        lines.push(`    ${pip}.${b.type}(${pyNum(vol)}, ${b.type==='distribute'?`${fixed}[${JSON.stringify(fixedWell)}]`:`[${multi.map(w=>`${spread}[${JSON.stringify(w)}]`).join(', ')}]`}, ${b.type==='distribute'?`[${multi.map(w=>`${spread}[${JSON.stringify(w)}]`).join(', ')}]`:`${fixed}[${JSON.stringify(fixedWell)}]`}, new_tip="once")`);
        const note='Complex OT-2 command: API controls liquid handling, refill, disposal volume and tip movements. Displayed targets are illustrative, not an expanded robot trace.';
        multi.forEach(w=>{event('aspirate',b,src,b.type==='distribute'?fixedWell:w,vol,note);event('dispense',b,dst,b.type==='distribute'?w:fixedWell,vol,note);});
        warnings.push(`${name}: complex command shown as intended well targets. Validate its actual command expansion with the official Opentrons simulator.`);
      } else if(b.type==='transfer'){
        const src=findLab(b.source),dst=findLab(b.destination);
        checkWell(b.pipette,b.sourceWell,src,`${name} source`);checkWell(b.pipette,b.destWell,dst,`${name} destination`);
        checkTarget(b,src,vol,`${name} source`);checkTarget(b,dst,vol,`${name} destination`);
        if(src&&def(src.load_name)?.tipRack||dst&&def(dst.load_name)?.tipRack)errors.push(`${name}: source/destination must be actual wells, not tip racks.`);
        if(l?.tip)errors.push(`${name}: a tip is already attached; drop it before a self-contained transfer.`);
        const tip=useTip(b,name);
        lines.push(`    ${pip}.pick_up_tip(${tip})`,`    ${pip}.aspirate(${pyNum(vol)}, ${address(src,b.sourceWell,b)})`);
        if(b.touchTip===true||b.touchTip==='true')lines.push(`    ${pip}.touch_tip(${labNames[src?.id]}[${JSON.stringify(b.sourceWell)}])`);
        lines.push(`    ${pip}.dispense(${pyNum(vol)}, ${address(dst,b.destWell,b)})`);
        if(b.touchTip===true||b.touchTip==='true')lines.push(`    ${pip}.touch_tip(${labNames[dst?.id]}[${JSON.stringify(b.destWell)}])`);
        lines.push(`    ${pip}.drop_tip()`);
        event('pickup',b,findLab(b.rack),b.tipWell,0,`Pick up ${b.tipWell} from ${findLab(b.rack)?.label||'rack'}. Pickup Z is resolved by the API.`);
        event('transfer-aspirate',b,src,b.sourceWell,vol);event('transfer-dispense',b,dst,b.destWell,vol);event('drop',b,null,null,0,'Tip to fixed trash; position determined by API.');
      } else if(b.type==='pickup'){
        if(l?.tip)errors.push(`${name}: ${b.pipette} already has an attached tip.`);
        const tip=useTip(b,name);lines.push(`    ${pip}.pick_up_tip(${tip})`);
        if(l){l.tip=true;l.ul=0;}event('pickup',b,findLab(b.rack),b.tipWell,0,'Nominal tip-rack address; exact tip pickup depends on calibration.');
      } else if(b.type==='drop'){
        if(l&&!l.tip)errors.push(`${name}: there is no tip to drop on ${b.pipette}.`);
        lines.push(`    ${pip}.drop_tip()`);if(l){l.tip=false;l.ul=0;}event('drop',b,null,null,0,'Tip to fixed trash; exact location is resolved by Opentrons.');
      } else if(['aspirate','dispense','mix','move','blowout','touch'].includes(b.type)){
        const target=findLab(b.target);
        checkWell(b.pipette,b.well,target,name);
        if(b.type!=='touch')checkTarget(b,target,hasVolume?vol:0,name);
        if(target&&def(target.load_name)?.tipRack)errors.push(`${name}: a tip rack is not liquid-handling labware.`);
        if(l&&!l.tip)errors.push(`${name}: pick up a tip first.`);
        const pos=address(target,b.well,b);
        if(b.type==='aspirate'){if(l&&l.ul+vol>spec?.max)errors.push(`${name}: tip would exceed capacity ${spec.max} µL.`);if(l)l.ul+=vol;lines.push(`    ${pip}.aspirate(${pyNum(vol)}, ${pos})`);}
        if(b.type==='dispense'){if(l&&vol>l.ul)errors.push(`${name}: dispense ${vol} µL exceeds liquid/air currently tracked in the tip (${l.ul} µL).`);if(l)l.ul=Math.max(0,l.ul-vol);lines.push(`    ${pip}.dispense(${pyNum(vol)}, ${pos})`);}
        if(b.type==='mix'){if(!Number.isInteger(num(b.repetitions))||num(b.repetitions)<1||num(b.repetitions)>100)errors.push(`${name}: repetitions must be 1–100.`);if(l&&l.ul+vol>spec?.max)errors.push(`${name}: mixing volume plus tip contents would exceed pipette capacity.`);lines.push(`    ${pip}.mix(${Math.max(1,num(b.repetitions)||1)}, ${pyNum(vol)}, ${pos})`);}
        if(b.type==='move')lines.push(`    ${pip}.move_to(${pos})`);
        if(b.type==='blowout'){lines.push(`    ${pip}.blow_out(${pos})`);if(l)l.ul=0;}
        if(b.type==='touch'&&(!Number.isFinite(num(b.offset))||num(b.offset)<-10||num(b.offset)>10||num(b.radius)<=0||num(b.radius)>1))errors.push(`${name}: touch-tip needs rim offset -10..10 mm and radius fraction 0..1.`);
        if(b.type==='touch')lines.push(`    ${pip}.touch_tip(${labNames[b.target]||'MISSING_LABWARE'}[${JSON.stringify(b.well)}], radius=${pyNum(b.radius)}, v_offset=${pyNum(b.offset)})`);
        event(b.type,b,target,b.well,hasVolume?vol:0);
      } else if(b.type==='airgap'){
        if(l&&!l.tip)errors.push(`${name}: pick up a tip first.`);
        if(l&&l.ul+vol>spec?.max)errors.push(`${name}: air gap would exceed pipette capacity.`);
        if(l)l.ul+=vol;lines.push(`    ${pip}.air_gap(${pyNum(vol)})`);event('airgap',b,null,null,vol,'Air gap changes tip contents without a new labware target.');
      } else if(b.type==='delay'){
        if(!Number.isFinite(num(b.seconds))||num(b.seconds)<0)errors.push(`${name}: delay seconds must be nonnegative.`);
        lines.push(`    protocol.delay(seconds=${pyNum(b.seconds)})`);event('delay',b,null,null,0,`Wait ${b.seconds} seconds.`);
      } else if(b.type==='pause'){
        lines.push(`    protocol.pause(${JSON.stringify(String(b.message||'Review protocol'))})`);event('pause',b,null,null,0,String(b.message));
      }
    });
    Object.entries(live).forEach(([mount,l])=>{if(l.tip)warnings.push(`A tip remains attached on ${mount} at protocol end; add a Drop tip block if disposal is intended.`)});
    return {name:$('flowName').value||'LifeFabs OT-2 visual workflow',apiLevel:api,pipettes:hw.pipettes.map(x=>({...x,load_name:x.api_load_name})),modules:hw.modules,labware:hw.labware,blocks,steps:errors.length?[]:steps,errors,warnings,python:lines.join('\n')+'\n'};
  }
  function compileAndSync(){
    if(!ready)return;
    plan=validateAndCompile();
    const errors=$('flowValidation');errors.innerHTML=plan.errors.length?`<strong>Needs attention (${plan.errors.length})</strong><ul>${plan.errors.slice(0,7).map(e=>`<li>${escape(e)}</li>`).join('')}</ul>`:plan.warnings.length?`<strong>Review:</strong> ${escape(plan.warnings.slice(0,2).join(' '))}`:'✓ Hardware, blocks, deck and Python synchronized';
    errors.dataset.bad=String(!!plan.errors.length);
    $('flowHardwareSummary').textContent=`${plan.pipettes.length} pipette(s) · ${labware.length} placed labware · ${plan.modules.length} module(s) · ${blocks.length} blocks · ${plan.steps.length} viewer events`;
    $('flowStatus').textContent=plan.errors.length?'Hardware remains visible; generation is blocked until these issues are fixed.':'Every change is immediately reflected in the deck and Python.';
    if(window.lifefabsCore?.currentMode()==='build')window.lifefabsCore.applyPlan(plan);
    else window.lifefabsCore?.updateHardwareOnly({...gallery,placed_labware:labware});
  }
  function appendCycle(){const b=makeBlock('transfer');blocks.push(b);selectBlock(b.id);changed(true);}
  function saveJson(){const blob=new Blob([JSON.stringify({schema:'lifefabs-visual-v4',name:$('flowName').value,api:$('flowApi').value,labware,blocks},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='lifefabs-visual-protocol.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function attach(){
    $('hwOfficialDefinition').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{importOfficialDefinition(JSON.parse(await f.text()));}catch(error){tellHardware('Definition import rejected: '+error.message,true);}e.target.value='';});
    $('hwLabwareType').addEventListener('change',()=>{$('hwLabwareRole').value=def($('hwLabwareType').value)?.tipRack?'tips':'source'});
    $('hwAddLabware').addEventListener('click',addLabware);
    $('hwPlacedLabware').addEventListener('change',e=>{
      const field=e.target.closest('[data-hw-prop]'),item=e.target.closest('[data-hw-id]');if(!field||!item)return;
      const l=findLab(item.dataset.hwId);if(!l)return;
      if(field.dataset.hwProp==='slot')setSlot(l.id,num(field.value));
      else if(field.dataset.hwProp==='moduleUid'){
        const m=moduleByUid(field.value);
        if(m){if(labware.some(x=>x.id!==l.id&&x.moduleUid===m.uid))return tellHardware('This module already has labware placed on top.',true);l.moduleUid=m.uid;l.slot=Number(m.location);}
        else {l.moduleUid='';if(canPlace(l.slot,l.id)){const slot=validSlots().find(x=>!labware.some(y=>y.id!==l.id&&y.slot===x));if(!slot)return tellHardware('No free deck slot for standalone labware.',true);l.slot=slot;}}
        hardwareChanged();
      } else {l.role=def(l.load_name)?.tipRack?'tips':field.value;hardwareChanged();}
    });
    $('hwPlacedLabware').addEventListener('click',e=>{const b=e.target.closest('[data-hw-remove]');if(!b)return;labware=labware.filter(l=>l.id!==b.dataset.hwRemove);tellHardware('Labware removed. Viewer and generated source refreshed.');hardwareChanged();});
    $('hwPlacedLabware').addEventListener('dragstart',e=>{const card=e.target.closest('[data-hw-id]');if(!card)return;dragging={kind:'labware',id:card.dataset.hwId};e.dataTransfer?.setData('application/x-lifefabs-hw-labware',card.dataset.hwId);e.dataTransfer?.setData('text/plain',card.dataset.hwId);});
    $('instrumentDeck').addEventListener('drop',e=>{
      const id=e.dataTransfer?.getData('application/x-lifefabs-hw-labware')||dragging?.kind==='labware'&&dragging.id;
      if(!id)return;const slot=e.target.closest('[data-drop-slot]')?.dataset.dropSlot;if(!slot)return;
      e.preventDefault();e.stopImmediatePropagation();dragging=null;setSlot(id,num(slot));
    },true);
    $('instrumentDeck').addEventListener('dragover',e=>{if(dragging?.kind==='labware'){e.preventDefault();e.dataTransfer.dropEffect='move';}},true);
    window.addEventListener('lifefabs:hardware-layout-changed',e=>{
      gallery=e.detail||{mounted_pipettes:[],placed_modules:[]};
      const taken=new Set((gallery.placed_modules||[]).flatMap(x=>(x.reserved_slots||[x.location]).map(Number)));
      labware.forEach(l=>{if(l.moduleUid){const m=moduleByUid(l.moduleUid);if(m)l.slot=Number(m.location);}});
      if(labware.some(x=>!x.moduleUid&&taken.has(x.slot)))tellHardware('A module overlaps placed standalone labware. Move the conflicting hardware.',true);
      if(ready){renderHardware();renderBlocks();renderInspector();compileAndSync();}
    });
    const pal=$('flowPalette');pal.innerHTML=TYPES.map(([type,label,group,help])=>`<button type="button" class="flow-palette-block flow-${group.toLowerCase()}" draggable="true" data-palette-type="${type}" title="${escape(help)}"><span>＋</span><strong>${label}</strong></button>`).join('');
    pal.addEventListener('click',e=>{const btn=e.target.closest('[data-palette-type]');if(btn)insertBlock(btn.dataset.paletteType);});
    pal.addEventListener('dragstart',e=>{const btn=e.target.closest('[data-palette-type]');if(!btn)return;dragging={kind:'palette',type:btn.dataset.paletteType};e.dataTransfer?.setData('text/plain',btn.dataset.paletteType);});
    const canvas=$('flowCanvas');canvas.addEventListener('click',e=>{
      const action=e.target.closest('[data-flow-remove],[data-flow-duplicate]');
      if(action){const id=action.dataset.flowRemove||action.dataset.flowDuplicate;const i=blocks.findIndex(b=>b.id===id);if(i<0)return;
        if(action.dataset.flowRemove){blocks.splice(i,1);if(selectedId===id)selectedId=blocks[i]?.id||blocks[i-1]?.id||null;}
        else {if(blocks.length>=300)return;const b={...blocks[i],id:blockId()};blocks.splice(i+1,0,b);selectedId=b.id;}
        renderInspector();changed(true);return;
      }
      const block=e.target.closest('[data-flow-id]');if(block){selectBlock(block.dataset.flowId);return;}
      const insert=e.target.closest('[data-insert]');if(insert){insertBlock('transfer',num(insert.dataset.insert));return;}
    });
    canvas.addEventListener('dragstart',e=>{const node=e.target.closest('[data-flow-id]');if(!node)return;dragging={kind:'block',id:node.dataset.flowId};e.dataTransfer?.setData('text/plain',node.dataset.flowId);});
    const insertionPoint=e=>{
      const explicit=e.target.closest('[data-insert]');if(explicit)return num(explicit.dataset.insert);
      const block=e.target.closest('[data-flow-id]');if(!block)return blocks.length;
      const i=blocks.findIndex(x=>x.id===block.dataset.flowId);
      return Math.max(0,i+(e.clientY>block.getBoundingClientRect().top+block.getBoundingClientRect().height/2?1:0));
    };
    canvas.addEventListener('dragover',e=>{if(!dragging)return;e.preventDefault();const pos=insertionPoint(e);canvas.querySelectorAll('.flow-insert').forEach(n=>n.classList.toggle('drop-active',num(n.dataset.insert)===pos));});
    canvas.addEventListener('drop',e=>{if(!dragging)return;e.preventDefault();let target=insertionPoint(e);
      if(dragging.kind==='palette')insertBlock(dragging.type,target);
      else if(dragging.kind==='block'){
        const i=blocks.findIndex(x=>x.id===dragging.id);if(i>=0){const [b]=blocks.splice(i,1);if(i<target)target--;blocks.splice(Math.max(0,target),0,b);selectedId=b.id;renderInspector();changed(true);}
      }
      dragging=null;
    });
    canvas.addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key))return;const plus=e.target.closest('[data-insert]');if(plus){e.preventDefault();insertBlock('transfer',num(plus.dataset.insert));}});
    document.addEventListener('dragend',()=>{dragging=null;canvas.querySelectorAll('.drop-active').forEach(x=>x.classList.remove('drop-active'));});
    $('flowInspector').addEventListener('input',e=>{
      const key=e.target.dataset.blockKey;if(!key)return;const b=blocks.find(x=>x.id===selectedId);if(!b)return;
      b[key]=e.target.type==='number'?Number(e.target.value):e.target.value;save();compileAndSync();
      const node=canvas.querySelector(`[data-flow-id="${b.id}"] small`);if(node)node.textContent=blockCaption(b);
    });
    $('flowInspector').addEventListener('change',e=>{const key=e.target.dataset.blockKey;if(!key)return;const b=blocks.find(x=>x.id===selectedId);if(!b)return;
      b[key]=e.target.type==='number'?Number(e.target.value):e.target.value;
      if(key==='moduleUid'){const m=hardware().modules.find(x=>x.uid===b.moduleUid);b.moduleAction=allowedModuleActions(m)[0][0];}
      if(key==='moduleAction'){const m=hardware().modules.find(x=>x.uid===b.moduleUid);if(!allowedModuleActions(m).some(x=>x[0]===b.moduleAction))b.moduleAction=allowedModuleActions(m)[0][0];}
      if(key==='pipette'){const spec=pipInfo(b.pipette);if(spec&&num(b.volume)>spec.max)b.volume=spec.max;const r=racks().find(x=>compatibleRack(b.pipette,x.id));if(r)b.rack=r.id;}
      renderInspector();changed(true);
    });
    $('flowInspector').addEventListener('click',e=>{
      const dir=e.target.closest('#flowMoveUp,#flowMoveDown');if(!dir)return;const i=blocks.findIndex(x=>x.id===selectedId),to=i+(dir.id==='flowMoveUp'?-1:1);if(to<0||to>=blocks.length)return;
      [blocks[i],blocks[to]]=[blocks[to],blocks[i]];changed(true);
    });
    $('flowAddCycle').addEventListener('click',appendCycle);
    $('flowExample').addEventListener('click',()=>{blocks=[makeBlock('transfer')];selectedId=blocks[0].id;renderInspector();changed(true);});
    $('flowClear').addEventListener('click',()=>{blocks=[];selectedId=null;renderInspector();changed(true);});
    $('flowSave').addEventListener('click',saveJson);
    $('flowLoad').addEventListener('change',async e=>{
      const file=e.target.files?.[0];if(!file)return;
      try{const data=JSON.parse(await file.text());if(data.schema!=='lifefabs-visual-v4'||!Array.isArray(data.blocks)||!Array.isArray(data.labware))throw Error('Not a version 4 visual workflow JSON');
        if(data.labware.some(l=>!def(l.load_name)))throw Error('Saved workflow references a labware definition unavailable in this bundle');
        labware=data.labware.slice(0,11);blocks=data.blocks.filter(b=>byType[b.type]).slice(0,300);
        if(typeof data.name==='string')$('flowName').value=data.name;if(['2.15','2.20','2.28'].includes(data.api))$('flowApi').value=data.api;
        idCounter=Math.max(idCounter,...[...labware,...blocks].map(x=>Number(String(x.id).match(/\d+$/)?.[0]||0)+1));
        selectedId=blocks[0]?.id||null;hardwareChanged();renderInspector();tellHardware('Saved labware and visual workflow restored. Mounted pipettes/modules stay under Section 1 control.');
      }catch(err){tellHardware(`Could not open design: ${err.message}`,true)}
      e.target.value='';
    });
    $('flowName').addEventListener('input',()=>changed(false));$('flowApi').addEventListener('change',()=>changed(false));
    $('modeBuild').addEventListener('click',()=>{requestAnimationFrame(compileAndSync)});
  }
  async function init(){
    try{
      const res=await fetch('data/labware-presets.json',{cache:'no-cache'});if(!res.ok)throw Error('Could not fetch labware presets');
      labwareDefinitions=(await res.json()).definitions||[];
      try{const extras=JSON.parse(localStorage.getItem(CUSTOM_DEFS)||'[]');if(Array.isArray(extras))extras.filter(x=>x.custom&&x.loadName&&x.wellGeometry).forEach(x=>{if(!def(x.loadName))labwareDefinitions.push(x);window.lifefabsCore?.registerLabwareDefinition(x);});}catch(e){console.warn('No custom labware restored',e)}
      restore();attach();ready=true;
      if(window.lifefabsHardwareLayout)gallery=window.lifefabsHardwareLayout;
      window.lifefabsV4Active=true;
      publishLabware();renderHardware();renderBlocks();selectedId=blocks[0]?.id||null;renderInspector();
      if(window.lifefabsCore){labwareDefinitions.filter(x=>x.custom).forEach(x=>window.lifefabsCore.registerLabwareDefinition(x));compileAndSync();}else window.addEventListener('lifefabs:core-ready',()=>{labwareDefinitions.filter(x=>x.custom).forEach(x=>window.lifefabsCore?.registerLabwareDefinition(x));compileAndSync();},{once:true});
    }catch(err){console.error(err);$('flowStatus').textContent=`Could not load visual editor: ${err.message}`;}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
