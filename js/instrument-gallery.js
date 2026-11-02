/*
 * LifeFabs OT-2 instrument gallery
 * - Catalogue data is stored in data/opentrons-instruments.json.
 * - Pipettes are carriage-mounted; modules are deck-mounted.
 * - This UI enforces selected catalogue restrictions, not every physical collision rule.
 */
(() => {
  'use strict';

  const CATALOG_URL = 'data/opentrons-instruments.json';
  const STORAGE_KEY = 'lifefabs-ot2-instrument-layout-v1';
  const CUSTOM_KEY = 'lifefabs-custom-devices-v6';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const slotPosition = {
    10: { row: 1, col: 1 }, 11: { row: 1, col: 2 },
    7: { row: 2, col: 1 }, 8: { row: 2, col: 2 }, 9: { row: 2, col: 3 },
    4: { row: 3, col: 1 }, 5: { row: 3, col: 2 }, 6: { row: 3, col: 3 },
    1: { row: 4, col: 1 }, 2: { row: 4, col: 2 }, 3: { row: 4, col: 3 },
  };
  const fixedTrashSlot = 'trash';
  const state = {
    catalogue: [],
    catalogueMeta: null,
    filter: 'all',
    search: '',
    selectedCatalogId: null,
    selectedPlacedId: null,
    deck: [],
    mounts: { left: null, right: null },
  };
  let dragPayload = null;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  const instrumentFor = id => state.catalogue.find(item => item.id === id);
  const placedFor = uid => [...state.deck, state.mounts.left, state.mounts.right].filter(Boolean).find(item => item.uid === uid);
  const uid = () => `gear-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const iconFor = item => item.category === 'pipette' ? '⇣' : ({
    temperature_module: '♨', magnetic_module: '◉', thermocycler: '▥', heater_shaker: '≋',
  }[item.family] || '▦');
  const placementText = item => item.category === 'pipette'
    ? `Gantry mount · ${item.channels}-channel · ${item.min_volume_ul}–${item.max_volume_ul} µL`
    : item.occupied_slots === 'single'
      ? `Deck module · slots ${item.allowed_slots.join(', ')}`
      : `Multi-slot module · reserves ${item.occupied_slots.join(', ')}`;

  function say(message, kind = '') {
    const node = $('#instrumentFeedback');
    if (!node) return;
    node.textContent = message;
    node.classList.remove('success', 'error');
    if (kind) node.classList.add(kind);
  }

  function validatedCustomDefinition(raw) {
    if (!raw || typeof raw !== 'object' || !/^custom_[a-z0-9_]{2,50}$/.test(raw.id) ||
        typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 65 ||
        !Array.isArray(raw.allowed_slots) || !raw.allowed_slots.length ||
        !raw.allowed_slots.every(x => Number.isInteger(x) && x >= 1 && x <= 11)) return null;
    const operations = Array.isArray(raw.operations) ? raw.operations.slice(0, 8).filter(x => typeof x === 'string').map(x => x.trim().slice(0, 85)).filter(Boolean) : [];
    return { id:raw.id,name:raw.name.trim(),description:String(raw.description || '').slice(0, 300),
      allowed_slots:[...new Set(raw.allowed_slots)],operations,category:'module',family:'custom_device',
      api_method:'manual_handoff',occupied_slots:'single',api_load_name:'manual:' + raw.id,
      custom:true,deck_placeable:true,generation:'CUSTOM',lifecycle:'user-defined',
      safety_note:'Operator-controlled steps only; third-party hardware must be independently validated.' };
  }
  function saveCustomDefinitions() {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(state.catalogue.filter(x => x.custom))); }
    catch (e) { say('Could not save custom registry in this browser.', 'error'); }
  }
  function loadCustomDefinitions() {
    try {
      const definitions=JSON.parse(localStorage.getItem(CUSTOM_KEY)||'[]');
      if(Array.isArray(definitions)) definitions.slice(0,30).forEach(d=>{
        const checked=validatedCustomDefinition(d);
        if(checked && !instrumentFor(checked.id))state.catalogue.push(checked);
      });
    } catch(e){console.warn('Could not read custom devices',e)}
  }
  function addCustomDevice() {
    const name=$('#customDeviceName')?.value.trim();
    const slots=String($('#customDeviceSlots')?.value||'').split(/[,;\s]+/).filter(Boolean).map(Number);
    const description=$('#customDevicePurpose')?.value.trim()||'Manual external operation';
    const operations=String($('#customDeviceActions')?.value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    if(!name || name.length>65 || description.length>300 || !slots.length ||
       slots.some(x=>!Number.isInteger(x)||x<1||x>11) || operations.length>8 || operations.some(x=>x.length>85))
      return say('Specify a device name (≤65 chars), slots 1–11, notes (≤300 chars), and up to 8 named actions (≤85 chars each).','error');
    const id='custom_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6);
    const checked=validatedCustomDefinition({id,name,description,allowed_slots:slots,operations});
    if(!checked)return say('Device definition is invalid.','error');
    state.catalogue.push(checked);saveCustomDefinitions();
    $('#customDeviceName').value='';$('#customDeviceActions').value='';renderAll();publishLayout();
    say(`Registered ${name}. Place it on the deck, then choose its manual actions in the composer.`, 'success');
  }
  function exportCustomRegistry(){
    downloadBlob('lifefabs-custom-deck-devices.json','application/json;charset=utf-8',JSON.stringify({schema:'lifefabs-custom-deck-devices-v1',devices:state.catalogue.filter(x=>x.custom)},null,2));
    say('Custom device definitions exported (no firmware or executable drivers).','success');
  }
  async function importCustomRegistry(e){
    const file=e.target.files?.[0];if(!file)return;
    try{
      if(file.size>100000)throw new Error('JSON registry is too large (100 KB maximum).');
      const data=JSON.parse(await file.text());
      if(data?.schema!=='lifefabs-custom-deck-devices-v1'||!Array.isArray(data.devices)||data.devices.length>30)throw new Error('Expected a LifeFabs custom deck device registry with ≤30 entries.');
      let count=0;
      for(const d of data.devices){
        const checked=validatedCustomDefinition(d);
        if(!checked)throw new Error('Registry contains an invalid device definition.');
        if(!instrumentFor(checked.id)){state.catalogue.push(checked);count++;}
      }
      if(state.catalogue.filter(x=>x.custom).length>30)throw new Error('Maximum 30 custom devices across registry.');
      saveCustomDefinitions();renderAll();publishLayout();
      say(`Imported ${count} new custom device definitions. Place and review each one before use.`,'success');
    } catch(error){say(`Custom device import failed: ${error.message}`,'error');}
    finally{e.target.value='';}
  }
  function loadSavedState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return;
      const validId = id => state.catalogue.some(item => item.id === id);
      state.deck = Array.isArray(saved.deck)
        ? saved.deck.filter(item => item && validId(item.catalogId) && instrumentFor(item.catalogId)?.category === 'module' && Number.isInteger(Number(item.slot)))
          .map(item => ({ uid: String(item.uid || uid()), catalogId: item.catalogId, slot: Number(item.slot) }))
        : [];
      for (const mount of ['left', 'right']) {
        const item = saved.mounts?.[mount];
        state.mounts[mount] = item && validId(item.catalogId) && instrumentFor(item.catalogId)?.category === 'pipette'
          ? { uid: String(item.uid || uid()), catalogId: item.catalogId, mount }
          : null;
      }
    } catch (error) {
      console.warn('Could not restore instrument layout:', error);
    }
  }

  function publishLayout() {
    // Same-page event bridge: the protocol viewer can show this proposed layout
    // and detect slot conflicts without pretending the gallery is robot calibration.
    try {
      const snapshot = exportLayout();
      // Cache a snapshot as well as dispatching an event. The protocol module
      // loads asynchronous labware JSON, so it may subscribe after the gallery's
      // first render; the cached snapshot prevents that startup race.
      window.lifefabsHardwareLayout = snapshot;
      window.dispatchEvent(new CustomEvent('lifefabs:hardware-layout-changed', { detail: snapshot }));
    } catch (error) {
      console.warn('Could not publish instrument layout to the protocol viewer:', error);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ deck: state.deck, mounts: state.mounts }));
    } catch (error) {
      console.warn('Could not save instrument layout:', error);
    }
    publishLayout();
  }

  function renderCatalogue() {
    const root = $('#instrumentCatalogue');
    if (!root) return;
    const query = state.search.trim().toLowerCase();
    const list = state.catalogue.filter(item => {
      if (state.filter !== 'all' && item.category !== state.filter) return false;
      if (!query) return true;
      return [item.name, item.description, item.api_load_name, item.generation, item.family, item.lifecycle]
        .filter(Boolean).join(' ').toLowerCase().includes(query);
    });
    $('#catalogCount').textContent = `${list.length} / ${state.catalogue.length}`;
    if (!list.length) {
      root.innerHTML = '<p class="catalog-loading">No instruments match that filter.</p>';
      return;
    }
    root.innerHTML = list.map(item => {
      const legacy = item.lifecycle === 'legacy';
      const meta = item.category === 'pipette'
        ? `${item.generation} · ${item.channels}-channel · ${item.min_volume_ul}–${item.max_volume_ul} µL`
        : item.custom ? 'CUSTOM · manual control · no API driver' : `${item.generation} · API ≥ ${item.min_api_version}`;
      return `<article class="instrument-catalog-card ${state.selectedCatalogId === item.id ? 'selected' : ''}"
          draggable="true" tabindex="0" role="button" aria-pressed="${state.selectedCatalogId === item.id}"
          data-catalog-id="${escapeHtml(item.id)}" aria-label="Select or drag ${escapeHtml(item.name)}">
        <div class="instrument-card-top"><div class="instrument-icon" aria-hidden="true">${iconFor(item)}</div><div style="min-width:0;flex:1"><div class="instrument-card-title-row"><h4 class="instrument-card-title">${escapeHtml(item.name)}</h4><button type="button" class="info-i instrument-card-info" data-help="${escapeHtml(`${item.description} API load name: ${item.api_load_name}. ${item.category === 'pipette' ? `Mount: left or right. Channel count: ${item.channels}. Nominal working range: ${item.min_volume_ul}–${item.max_volume_ul} µL.` : `Placement: deck module. Allowed anchor slots: ${(item.allowed_slots || []).join(', ')}. Reserved footprint: ${Array.isArray(item.occupied_slots) ? item.occupied_slots.join(', ') : item.occupied_slots || 'single slot'}.`}`)}" aria-expanded="false" aria-label="Help for ${escapeHtml(item.name)}" title="${escapeHtml(item.description)}">i</button></div><div class="instrument-card-meta">${escapeHtml(meta)}</div></div></div>
        <p class="instrument-card-description">${escapeHtml(item.description)}</p>
        <div class="instrument-card-bottom"><span class="instrument-api-name" title="API load name">${escapeHtml(item.api_load_name)}</span><span class="instrument-quick-action"><button type="button" class="instrument-quick-place" data-quick-place="${escapeHtml(item.id)}">Quick place</button><button type="button" class="info-i instrument-quick-help" data-help="Quick place puts this item in the first compatible free gantry mount or deck slot. It updates only the proposed gallery layout; it does not load hardware on a physical robot or validate full module compatibility." aria-expanded="false" aria-label="Help for Quick place" title="Quick place help">i</button></span></div>
        <div class="instrument-card-bottom" style="margin-top:8px"><span class="instrument-badge">${item.category === 'pipette' ? 'Mount-mounted' : 'Deck-mounted'}</span>${legacy ? '<span class="instrument-badge legacy">LEGACY</span>' : '<span class="instrument-badge">CURRENT</span>'}</div>
      </article>`;
    }).join('');
  }

  function getReservedSlots(entry, slotOverride = null) {
    const item = instrumentFor(entry.catalogId);
    if (!item) return [];
    const slot = Number(slotOverride ?? entry.slot);
    if (Array.isArray(item.occupied_slots)) return [...item.occupied_slots];
    return Number.isInteger(slot) ? [slot] : [];
  }

  function isSlotReserved(slot, ignoreUid = null) {
    return state.deck.some(entry => entry.uid !== ignoreUid && getReservedSlots(entry).includes(Number(slot)));
  }

  function familyAlreadyPlaced(item, ignoreUid = null) {
    return state.deck.some(entry => {
      const other = instrumentFor(entry.catalogId);
      return entry.uid !== ignoreUid && other && other.family === item.family;
    });
  }

  function slotsAdjacent(a, b) {
    const pa = slotPosition[Number(a)];
    const pb = slotPosition[Number(b)];
    return Boolean(pa && pb && Math.abs(pa.row - pb.row) + Math.abs(pa.col - pb.col) === 1);
  }

  function validateModulePlacement(item, targetSlot, ignoreUid = null) {
    const slot = Number(targetSlot);
    if (!item || item.category !== 'module') return 'Only a deck module can be placed in a deck slot. Pipettes attach to gantry mounts.';
    if (!state.catalogueMeta?.deck?.placeable_slots?.includes(slot)) return `Slot ${targetSlot} is not a placeable OT-2 deck slot.`;
    if (!item.allowed_slots.includes(slot)) {
      if (item.family === 'thermocycler') return 'The OT-2 Thermocycler uses the 2 × 2 footprint across slots 7, 8, 10 and 11. Drop it on slot 7 in this layout model.';
      return `${item.name} is restricted in this catalogue to slots ${item.allowed_slots.join(', ')}.`;
    }
    if (!item.custom && familyAlreadyPlaced(item, ignoreUid)) return `Only one ${item.family.replaceAll('_', ' ')} family module is included in this OT-2 layout. Remove or move the existing module first.`;
    const candidateSlots = Array.isArray(item.occupied_slots) ? item.occupied_slots : [slot];
    for (const usedSlot of candidateSlots) {
      if ((window.lifefabsOccupiedLabwareSlots || []).includes(Number(usedSlot))) return `Slot ${usedSlot} already contains labware. Move or remove that labware before placing a module.`;
    }
    for (const target of candidateSlots) {
      if (isSlotReserved(target, ignoreUid)) return `Slot ${target} is already occupied or reserved by a multi-slot module.`;
    }
    const otherModules = state.deck.filter(entry => entry.uid !== ignoreUid);
    const existingHeater = otherModules.find(entry => instrumentFor(entry.catalogId)?.family === 'heater_shaker');
    if (item.family === 'heater_shaker') {
      for (const other of otherModules) {
        for (const otherSlot of getReservedSlots(other)) {
          for (const target of candidateSlots) {
            if (slotsAdjacent(target, otherSlot)) return `The Heater-Shaker requires adjacent deck slots to remain clear; slot ${target} is adjacent to the item in slot ${otherSlot}.`;
          }
        }
      }
    } else if (existingHeater) {
      const hsSlots = getReservedSlots(existingHeater);
      for (const target of candidateSlots) {
        for (const hsSlot of hsSlots) {
          if (slotsAdjacent(target, hsSlot)) return `The Heater-Shaker in slot ${hsSlot} requires adjacent deck slots to remain clear.`;
        }
      }
    }
    return '';
  }

  function firstAvailableSlot(item) {
    for (const slot of item.allowed_slots) {
      if (validateModulePlacement(item, slot)) continue;
      return Number(slot);
    }
    return null;
  }

  function placeCatalog(itemId, target) {
    const item = instrumentFor(itemId);
    if (!item) return say('That catalogue item is unavailable.', 'error');
    if (target.type === 'slot') {
      if (item.category !== 'module') return say('Pipettes are mounted on the carriage, not placed on deck slots. Drop this pipette on the left or right mount.', 'error');
      const error = validateModulePlacement(item, target.slot);
      if (error) return say(error, 'error');
      state.deck.push({ uid: uid(), catalogId: item.id, slot: Number(target.slot) });
      state.selectedCatalogId = null;
      state.selectedPlacedId = null;
      saveState(); renderAll();
      return say(`${item.name} placed in OT-2 slot ${target.slot}.`, 'success');
    }
    if (target.type === 'mount') {
      if (item.category !== 'pipette') return say('Deck modules attach to deck slots, not to pipette mounts.', 'error');
      if (state.mounts[target.mount]) return say(`The ${target.mount} mount is already occupied. Move or recycle its pipette first.`, 'error');
      state.mounts[target.mount] = { uid: uid(), catalogId: item.id, mount: target.mount };
      state.selectedCatalogId = null;
      state.selectedPlacedId = null;
      saveState(); renderAll();
      return say(`${item.name} attached to the ${target.mount} mount.`, 'success');
    }
  }

  function movePlaced(entry, target) {
    const item = instrumentFor(entry.catalogId);
    if (!item) return say('The selected item is not in the current catalogue.', 'error');
    if (target.type === 'slot') {
      if (item.category !== 'module') return say('Pipettes cannot be moved into deck slots; use a left/right mount.', 'error');
      const error = validateModulePlacement(item, target.slot, entry.uid);
      if (error) return say(error, 'error');
      entry.slot = Number(target.slot);
      state.selectedCatalogId = null;
      state.selectedPlacedId = entry.uid;
      saveState(); renderAll();
      return say(`${item.name} moved to slot ${target.slot}.`, 'success');
    }
    if (target.type === 'mount') {
      if (item.category !== 'pipette') return say('Deck modules cannot attach to pipette mounts.', 'error');
      const currentMount = entry.mount;
      if (target.mount !== currentMount && state.mounts[target.mount]) return say(`The ${target.mount} mount is already occupied.`, 'error');
      if (currentMount && state.mounts[currentMount]?.uid === entry.uid) state.mounts[currentMount] = null;
      state.mounts[target.mount] = { uid: entry.uid, catalogId: entry.catalogId, mount: target.mount };
      state.selectedCatalogId = null;
      state.selectedPlacedId = entry.uid;
      saveState(); renderAll();
      return say(`${item.name} moved to the ${target.mount} mount.`, 'success');
    }
  }

  function placeSelectedOnTarget(target) {
    if (!state.selectedCatalogId) {
      if (state.selectedPlacedId) {
        const entry = placedFor(state.selectedPlacedId);
        if (entry) return movePlaced(entry, target);
      }
      return say('Select or drag an item from the instrument plenum first.');
    }
    return placeCatalog(state.selectedCatalogId, target);
  }

  function quickPlace(itemId) {
    const item = instrumentFor(itemId);
    if (!item) return;
    state.selectedCatalogId = itemId;
    state.selectedPlacedId = null;
    if (item.category === 'pipette') {
      const mount = !state.mounts.left ? 'left' : !state.mounts.right ? 'right' : null;
      if (!mount) { renderAll(); return say('Both pipette mounts are occupied. Recycle or move a pipette first.', 'error'); }
      placeCatalog(itemId, { type: 'mount', mount });
    } else {
      const slot = firstAvailableSlot(item);
      if (slot == null) { renderAll(); return say('No compatible unoccupied slot is available for this module.', 'error'); }
      placeCatalog(itemId, { type: 'slot', slot });
    }
  }

  function removePlaced(uidToRemove) {
    const deckIndex = state.deck.findIndex(item => item.uid === uidToRemove);
    if (deckIndex >= 0) {
      const [entry] = state.deck.splice(deckIndex, 1);
      const item = instrumentFor(entry.catalogId);
      state.selectedPlacedId = null;
      saveState(); renderAll();
      return say(`${item?.name || 'Module'} removed from the deck layout.`, 'success');
    }
    for (const mount of ['left', 'right']) {
      if (state.mounts[mount]?.uid === uidToRemove) {
        const entry = state.mounts[mount];
        state.mounts[mount] = null;
        const item = instrumentFor(entry.catalogId);
        state.selectedPlacedId = null;
        saveState(); renderAll();
        return say(`${item?.name || 'Pipette'} removed from the ${mount} mount.`, 'success');
      }
    }
  }

  function removeSelected() {
    if (state.selectedPlacedId) return removePlaced(state.selectedPlacedId);
    return say('Select a placed item or drag it to the recycle bin to remove it.');
  }

  function renderPlacedGear(entry, isLarge = false) {
    const item = instrumentFor(entry.catalogId);
    if (!item) return '';
    if (isLarge) {
      return `<div class="large-module-tile placed-gear ${state.selectedPlacedId === entry.uid ? 'selected' : ''}" draggable="true" tabindex="0" role="button" aria-label="Select ${escapeHtml(item.name)} in slots 7, 8, 10 and 11" data-placed-id="${escapeHtml(entry.uid)}" title="Drag to move or recycle">
        <span class="large-module-icon" aria-hidden="true">${iconFor(item)}</span><strong>${escapeHtml(item.name)}</strong><code>${escapeHtml(item.api_load_name)}</code><small>FOOTPRINT: SLOTS ${item.occupied_slots.join(' · ')}</small>
      </div>`;
    }
    return `<div class="placed-gear ${state.selectedPlacedId === entry.uid ? 'selected' : ''}" draggable="true" tabindex="0" role="button" aria-label="Select or drag ${escapeHtml(item.name)}" data-placed-id="${escapeHtml(entry.uid)}" title="Drag to move or recycle"><span class="placed-gear-icon" aria-hidden="true">${iconFor(item)}</span><span style="min-width:0"><span class="placed-gear-label">${escapeHtml(item.name.replace(' Module', ''))}</span><span class="placed-gear-sub">${escapeHtml(item.api_load_name)}</span>${(window.lifefabsDeckLabware||[]).filter(l=>l.moduleUid===entry.uid).map(l=>`<span class="placed-gear-sub">↳ ${escapeHtml(l.label)}</span>`).join('')}</span></div>`;
  }

  function renderDeck() {
    const deck = $('#instrumentDeck');
    if (!deck) return;
    for (const slotNode of $$('.instrument-slot', deck)) {
      const slot = Number(slotNode.dataset.dropSlot);
      const content = $('.instrument-slot-content', slotNode);
      const occ = state.deck.find(entry => getReservedSlots(entry).includes(slot));
      const item = occ ? instrumentFor(occ.catalogId) : null;
      slotNode.classList.remove('is-occupied', 'is-covered', 'drag-over');
      if (occ && item && Array.isArray(item.occupied_slots)) {
        slotNode.classList.add('is-covered');
        content.textContent = 'Reserved';
      } else if (occ && item) {
        slotNode.classList.add('is-occupied');
        content.innerHTML = renderPlacedGear(occ);
      } else {
        const labware = (window.lifefabsDeckLabware || []).find(x => Number(x.slot) === slot);
        if (labware) {
          slotNode.classList.add('is-occupied');
          content.innerHTML = `<span class="hw-slot-labware"><strong>${escapeHtml(labware.label)}</strong><small>${escapeHtml(labware.display_name || labware.load_name)}</small></span>`;
        } else content.textContent = 'Empty slot';
      }
    }
    const layer = $('#largeModuleLayer');
    layer.innerHTML = '';
    const largeEntry = state.deck.find(entry => Array.isArray(instrumentFor(entry.catalogId)?.occupied_slots));
    if (largeEntry) layer.innerHTML = renderPlacedGear(largeEntry, true);
    const reserved = new Set();
    state.deck.forEach(entry => getReservedSlots(entry).forEach(slot => reserved.add(slot)));
    (window.lifefabsOccupiedLabwareSlots || []).forEach(slot => reserved.add(Number(slot)));
    $('#deckUsage').textContent = `${reserved.size} / 11 slots occupied`;
  }

  function renderMount(mount) {
    const target = $(`#mount${mount[0].toUpperCase()}${mount.slice(1)}`);
    const entry = state.mounts[mount];
    target.innerHTML = entry ? renderPlacedGear(entry) : '<span class="empty-equipment">Drop a pipette here</span>';
    const zone = target.closest('.mount-dropzone');
    zone.classList.remove('drag-over');
    zone.classList.toggle('mount-occupied', Boolean(entry));
  }

  function generateSetupCode() {
    const apiVersions = state.deck.map(entry => String(instrumentFor(entry.catalogId)?.min_api_version || '2.0'));
    const minVersion = ['2.15', ...apiVersions].sort((a,b)=>{const [a1,a2]=a.split('.').map(Number),[b1,b2]=b.split('.').map(Number);return a1-b1||a2-b2;}).at(-1);
    const lines = [
      'from opentrons import protocol_api',
      '',
      `metadata = {"apiLevel": "${minVersion}"}`,
      '',
      'def run(protocol: protocol_api.ProtocolContext):',
    ];
    let count = 0;
    for (const mount of ['left', 'right']) {
      const entry = state.mounts[mount];
      if (!entry) continue;
      const item = instrumentFor(entry.catalogId);
      const variable = `pipette_${mount}`;
      lines.push(`    ${variable} = protocol.load_instrument(`);
      lines.push(`        instrument_name=${JSON.stringify(item.api_load_name)},`);
      lines.push(`        mount=${JSON.stringify(mount)},`);
      lines.push('    )');
      lines.push('');
      count += 1;
    }
    for (const entry of [...state.deck].sort((a, b) => a.slot - b.slot)) {
      const item = instrumentFor(entry.catalogId);
      const variable = `${item.family.replace(/[^a-zA-Z0-9]+/g, '_')}_${entry.slot}`;
      if (item.custom) {
        lines.push(`    # CUSTOM DECK DEVICE: ${JSON.stringify(item.name)} in slot ${entry.slot}. No Opentrons API module driver; use a manual handoff block.`);
        lines.push('');count++;continue;
      }
      lines.push(`    ${variable} = protocol.load_module(`);
      lines.push(`        module_name=${JSON.stringify(item.api_load_name)},`);
      lines.push(`        location=${Number(entry.slot)},`);
      lines.push('    )');
      lines.push('');
      count += 1;
    }
    // The hardware setup excerpt follows the same placed labware as the visual composer.
    for (const [i, labware] of (window.lifefabsDeckLabware || []).entries()) {
      const parent = labware.moduleUid && state.deck.find(entry => entry.uid === labware.moduleUid);
      const item = parent && instrumentFor(parent.catalogId);
      const moduleVar = item && `${item.family.replace(/[^a-zA-Z0-9]+/g, '_')}_${parent.slot}`;
      if(parent && !item.custom)lines.push(`    labware_${i + 1} = ${moduleVar}.load_labware(${JSON.stringify(labware.load_name)})  # stacked: ${labware.label}; verify adapter`);
      else lines.push(`    labware_${i + 1} = protocol.load_labware(${JSON.stringify(labware.load_name)}, ${JSON.stringify(String(labware.slot))})  # ${labware.label}`);
      count += 1;
    }
    if (!count) lines.push('    # Mount an OT-2 pipette and place labware or modules above.');
    lines.push('');
    lines.push('    # Hardware declarations only; the visual composer below generates the action sequence.');
    return lines.join('\n');
  }

  function renderCode() {
    $('#instrumentSetupCode').value = generateSetupCode();
  }

  function renderAll() {
    renderCatalogue();
    renderDeck();
    renderMount('left');
    renderMount('right');
    renderCode();
  }

  function transferData(event) {
    const transfer = event.dataTransfer;
    if (transfer) {
      const catalogId = transfer.getData('application/x-lifefabs-catalog-id');
      const placedId = transfer.getData('application/x-lifefabs-placed-id');
      const source = transfer.getData('application/x-lifefabs-source');
      if (source === 'catalog' && catalogId) return { source, catalogId };
      if (source === 'placed' && placedId) return { source, placedId };
    }
    return dragPayload;
  }

  function beginDrag(event, sourceData) {
    dragPayload = sourceData;
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = sourceData.source === 'catalog' ? 'copy' : 'move';
    if (sourceData.source === 'catalog') event.dataTransfer.setData('application/x-lifefabs-catalog-id', sourceData.catalogId);
    if (sourceData.source === 'placed') event.dataTransfer.setData('application/x-lifefabs-placed-id', sourceData.placedId);
    event.dataTransfer.setData('application/x-lifefabs-source', sourceData.source);
    event.dataTransfer.setData('text/plain', sourceData.source === 'catalog' ? sourceData.catalogId : sourceData.placedId);
  }

  function handleTargetDrop(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const payload = transferData(event);
    clearDragHighlights();
    if (!payload) return say('No instrument was detected in the drag. Try selecting the card and using Quick place.', 'error');
    if (payload.source === 'catalog') {
      state.selectedCatalogId = payload.catalogId;
      state.selectedPlacedId = null;
      return placeCatalog(payload.catalogId, target);
    }
    if (payload.source === 'placed') {
      const entry = placedFor(payload.placedId);
      if (!entry) return say('That placed item is no longer in the layout.', 'error');
      return movePlaced(entry, target);
    }
  }

  function clearDragHighlights() {
    $$('.drag-over').forEach(node => node.classList.remove('drag-over'));
    dragPayload = null;
  }

  function attachDnD() {
    const palette = $('#instrumentCatalogue');
    palette.addEventListener('dragstart', event => {
      const card = event.target.closest('[data-catalog-id]');
      if (!card) return;
      beginDrag(event, { source: 'catalog', catalogId: card.dataset.catalogId });
    });
    palette.addEventListener('click', event => {
      const quick = event.target.closest('[data-quick-place]');
      if (quick) { event.preventDefault(); event.stopPropagation(); return quickPlace(quick.dataset.quickPlace); }
      const card = event.target.closest('[data-catalog-id]');
      if (!card) return;
      state.selectedCatalogId = card.dataset.catalogId;
      state.selectedPlacedId = null;
      renderCatalogue();
      const item = instrumentFor(state.selectedCatalogId);
      say(`${item.name} selected. Drag it to a compatible ${item.category === 'pipette' ? 'mount' : 'slot'}, or use Quick place.`, 'success');
    });
    palette.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      const card = event.target.closest('[data-catalog-id]');
      if (!card || event.target.closest('button')) return;
      event.preventDefault();
      state.selectedCatalogId = card.dataset.catalogId;
      state.selectedPlacedId = null;
      renderCatalogue();
      const item = instrumentFor(state.selectedCatalogId);
      say(`${item.name} selected. Choose a compatible mount or slot, or use Quick place.`, 'success');
    });

    const deck = $('#instrumentDeck');
    deck.addEventListener('dragstart', event => {
      const placed = event.target.closest('[data-placed-id]');
      if (!placed) return;
      beginDrag(event, { source: 'placed', placedId: placed.dataset.placedId });
    });
    deck.addEventListener('dragover', event => {
      const target = event.target.closest('[data-drop-slot]');
      if (!target) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = dragPayload?.source === 'catalog' ? 'copy' : 'move';
      target.classList.add('drag-over');
    });
    deck.addEventListener('dragleave', event => {
      const target = event.target.closest('[data-drop-slot]');
      if (target && !target.contains(event.relatedTarget)) target.classList.remove('drag-over');
    });
    deck.addEventListener('drop', event => {
      const target = event.target.closest('[data-drop-slot]');
      if (target) handleTargetDrop(event, { type: 'slot', slot: Number(target.dataset.dropSlot) });
    });
    deck.addEventListener('click', event => {
      const gear = event.target.closest('[data-placed-id]');
      if (gear) {
        state.selectedPlacedId = gear.dataset.placedId;
        state.selectedCatalogId = null;
        renderAll();
        const entry = placedFor(state.selectedPlacedId);
        const item = entry && instrumentFor(entry.catalogId);
        say(`${item?.name || 'Placed item'} selected. Drag it to another compatible location or to the recycle bin.`, 'success');
        return;
      }
      const slot = event.target.closest('[data-drop-slot]');
      if (slot && (state.selectedCatalogId || state.selectedPlacedId)) placeSelectedOnTarget({ type: 'slot', slot: Number(slot.dataset.dropSlot) });
    });
    deck.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      const slot = event.target.closest('[data-drop-slot]');
      if (!slot || !(state.selectedCatalogId || state.selectedPlacedId)) return;
      event.preventDefault();
      placeSelectedOnTarget({ type: 'slot', slot: Number(slot.dataset.dropSlot) });
    });

    for (const mount of ['left', 'right']) {
      const zone = $(`[data-drop-mount="${mount}"]`);
      zone.addEventListener('dragover', event => {
        event.preventDefault(); event.dataTransfer && (event.dataTransfer.dropEffect = dragPayload?.source === 'catalog' ? 'copy' : 'move'); zone.classList.add('drag-over');
      });
      zone.addEventListener('dragleave', event => { if (!zone.contains(event.relatedTarget)) zone.classList.remove('drag-over'); });
      zone.addEventListener('drop', event => handleTargetDrop(event, { type: 'mount', mount }));
      zone.addEventListener('click', event => {
        const gear = event.target.closest('[data-placed-id]');
        if (gear) {
          state.selectedPlacedId = gear.dataset.placedId;
          state.selectedCatalogId = null;
          renderAll();
          const entry = placedFor(state.selectedPlacedId);
          const item = entry && instrumentFor(entry.catalogId);
          say(`${item?.name || 'Pipette'} selected. Drag it to the other mount or to the recycle bin.`, 'success');
          return;
        }
        if (state.selectedCatalogId || state.selectedPlacedId) placeSelectedOnTarget({ type: 'mount', mount });
      });
      zone.addEventListener('keydown', event => {
        if (!['Enter', ' '].includes(event.key) || !(state.selectedCatalogId || state.selectedPlacedId)) return;
        event.preventDefault(); placeSelectedOnTarget({ type: 'mount', mount });
      });
      zone.addEventListener('dragstart', event => {
        const gear = event.target.closest('[data-placed-id]');
        if (gear) beginDrag(event, { source: 'placed', placedId: gear.dataset.placedId });
      });
    }

    const bin = $('#instrumentRecycleBin');
    bin.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer && (event.dataTransfer.dropEffect = 'move'); bin.classList.add('drag-over'); });
    bin.addEventListener('dragleave', event => { if (!bin.contains(event.relatedTarget)) bin.classList.remove('drag-over'); });
    bin.addEventListener('drop', event => {
      event.preventDefault(); event.stopPropagation(); bin.classList.remove('drag-over');
      const payload = transferData(event); clearDragHighlights();
      if (!payload || payload.source !== 'placed') return say('Drop an item that is already placed on a mount or deck slot into the recycle bin.', 'error');
      removePlaced(payload.placedId);
    });
    bin.addEventListener('click', removeSelected);
    bin.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); removeSelected(); } });
    document.addEventListener('dragend', clearDragHighlights);
    window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) { loadSavedState(); renderAll(); } });
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const helper = document.createElement('textarea'); helper.value = text; helper.style.position = 'fixed'; helper.style.opacity = '0';
        document.body.appendChild(helper); helper.select(); const ok = document.execCommand('copy'); helper.remove(); if (!ok) throw new Error('Copy command denied');
      }
      say('Hardware setup copied to clipboard.', 'success');
    } catch (error) { say('Copy failed in this browser. Select the generated code and copy it manually.', 'error'); }
  }

  function downloadBlob(filename, mime, text) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportLayout() {
    const deckItems = state.deck.map(entry => {
      const item = instrumentFor(entry.catalogId);
      return { uid: entry.uid, catalogue_id: entry.catalogId, name: item.name, api_load_name: item.api_load_name, method: item.api_method, location: entry.slot, reserved_slots: getReservedSlots(entry), family:item.family, custom:!!item.custom, description:item.description, operations:item.operations||[] };
    });
    const pipettes = ['left', 'right'].map(mount => {
      const entry = state.mounts[mount];
      if (!entry) return null;
      const item = instrumentFor(entry.catalogId);
      return { uid: entry.uid, catalogue_id: item.id, name: item.name, api_load_name: item.api_load_name, method: item.api_method, mount };
    }).filter(Boolean);
    return {
      catalogue_name: state.catalogueMeta?.catalogue_name,
      catalogue_version: state.catalogueMeta?.catalogue_version,
      robot: 'OT-2',
      generated_at: new Date().toISOString(),
      placed_modules: deckItems,
      mounted_pipettes: pipettes,
      placed_labware: (window.lifefabsDeckLabware || []).map(x => ({id:x.id,label:x.label,load_name:x.load_name,slot:x.slot,role:x.role,moduleUid:x.moduleUid||''})),
      warnings: [
        'Layout is a planning aid; validate the full protocol with Opentrons analysis/simulation and the exact robot configuration.',
        'The gallery does not certify cable orientation, labware-to-module compatibility, height clearances, pipette reach or collision-free motion.',
      ],
    };
  }

  function attachControls() {
    $$('.instrument-filter-row [data-instrument-filter]').forEach(button => button.addEventListener('click', () => {
      state.filter = button.dataset.instrumentFilter;
      $$('.instrument-filter-row button').forEach(other => other.classList.toggle('active', other === button));
      renderCatalogue();
    }));
    $('#instrumentSearch').addEventListener('input', event => { state.search = event.target.value; renderCatalogue(); });
    $('#registerCustomDevice')?.addEventListener('click', addCustomDevice);
    $('#exportCustomDevices')?.addEventListener('click',exportCustomRegistry);
    $('#importCustomDevices')?.addEventListener('change',importCustomRegistry);
    $('#resetInstrumentLayout').addEventListener('click', () => {
      state.deck = []; state.mounts = { left: null, right: null }; state.selectedCatalogId = null; state.selectedPlacedId = null;
      saveState(); renderAll(); say('Instrument layout reset. The catalogue is unchanged.', 'success');
    });
    $('#copyInstrumentSetup').addEventListener('click', () => copyText(generateSetupCode()));
    $('#downloadInstrumentSetup').addEventListener('click', () => downloadBlob('lifefabs-ot2-hardware-setup.py', 'text/x-python;charset=utf-8', generateSetupCode()));
    $('#downloadInstrumentLayout').addEventListener('click', () => downloadBlob('lifefabs-ot2-layout.json', 'application/json;charset=utf-8', JSON.stringify(exportLayout(), null, 2)));
  }

  async function init() {
    const panel = $('#instrumentGalleryPanel');
    if (!panel) return;
    try {
      const response = await fetch(CATALOG_URL, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.catalogueMeta = await response.json();
      state.catalogue = Array.isArray(state.catalogueMeta.instruments) ? state.catalogueMeta.instruments : [];
      loadCustomDefinitions();
      if (!state.catalogue.length) throw new Error('Catalogue is empty');
      loadSavedState();
      // Fresh visitors see an explicitly mounted demo pipette; never recreate it after a saved reset.
      let hadPreviousLayout = false;
      try { hadPreviousLayout = localStorage.getItem(STORAGE_KEY) !== null } catch (e) {}
      if (!hadPreviousLayout && !state.mounts.left && !state.mounts.right) {
        const demo = state.catalogue.find(x => x.api_load_name === 'p300_single_gen2');
        if (demo) state.mounts.right = { uid: uid(), catalogId: demo.id, mount: 'right' };
      }
      attachDnD();
      attachControls();
      renderAll();
      publishLayout();
      say('Catalogue loaded. Drag a pipette to a mount or a module to a compatible slot.', 'success');
    } catch (error) {
      console.error('Instrument gallery failed to initialise:', error);
      $('#instrumentCatalogue').innerHTML = `<p class="catalog-loading">Could not load instrument JSON: ${escapeHtml(error.message)}. Serve this site over HTTP (for example, <code>python -m http.server 8000</code>) instead of opening the file directly.</p>`;
      $('#catalogCount').textContent = 'Catalogue unavailable';
      say('Instrument JSON failed to load. Check that data/opentrons-instruments.json is deployed with the website.', 'error');
    }
  }

  window.lifefabsGallery = {
    render: () => { if (state.catalogue.length) renderAll(); },
    getLayout: () => exportLayout(),
    getReservedSlots: () => state.deck.flatMap(getReservedSlots),
    getCatalogue: () => state.catalogue.slice(),
    catalogueReady: () => state.catalogue.length > 0,
  };
  document.addEventListener('DOMContentLoaded', init);
})();
