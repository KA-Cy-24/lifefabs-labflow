const PRESET_DATA_URL = 'data/labware-presets.json'
const SLOT_PITCH_X = 132.5
const SLOT_PITCH_Y = 90.5
const SLOT_WIDTH = 128.0
const SLOT_DEPTH = 86.0
const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const SLOT_MAP = {
  1: { col: 0, row: 3 }, 2: { col: 1, row: 3 }, 3: { col: 2, row: 3 },
  4: { col: 0, row: 2 }, 5: { col: 1, row: 2 }, 6: { col: 2, row: 2 },
  7: { col: 0, row: 1 }, 8: { col: 1, row: 1 }, 9: { col: 2, row: 1 },
  10: { col: 0, row: 0 }, 11: { col: 1, row: 0 }
}
const PIPETTES = {
  p20_single_gen2: { label: 'P20 Single-Channel GEN2', channels: 1, min: 1, max: 20, tipRack: 'opentrons_96_tiprack_20ul' },
  p300_single_gen2: { label: 'P300 Single-Channel GEN2', channels: 1, min: 20, max: 300, tipRack: 'opentrons_96_tiprack_300ul' },
  p1000_single_gen2: { label: 'P1000 Single-Channel GEN2', channels: 1, min: 100, max: 1000, tipRack: 'opentrons_96_tiprack_1000ul' },
  p20_multi_gen2: { label: 'P20 8-Channel GEN2', channels: 8, min: 1, max: 20, tipRack: 'opentrons_96_tiprack_20ul' },
  p300_multi_gen2: { label: 'P300 8-Channel GEN2', channels: 8, min: 20, max: 300, tipRack: 'opentrons_96_tiprack_300ul' }
}
const COLORS = { source: '#278a7c', destination: '#648ac1', tips: '#d8a15c', trash: '#9aa6a2', active: '#cf6a55', deck: '#e1e8e2', deckEdge: '#cad7ce', ink: '#233d44', muted: '#768782' }

let labwareDefs = []
let customDefs = []
let activeView = '2d'
let activeMode = 'build'
let currentSteps = []
let activeStepIndex = 0
let generatedConfig = null
let cadViewer = null
let lastDiagnostics = []
let hardwareLayout = { placed_modules: [], mounted_pipettes: [] }
let viewerSource = 'none'
let previewStale = false
let previewFailed = false
let builderFormStale = false
let builderEditorStale = false
let inspectEditorStale = false
let inspectedStats = null
let lastInspectedCode = ''
let lastGeneratedCode = ''
let composerStyle = 'sequence'
let sequenceActions = []
let sequenceNextId = 1
let hardwareAutoSyncing = false
let externalPlan = null // V4 canonical hardware/block model takes priority in Build mode

const $ = id => document.getElementById(id)
const all = selector => Array.from(document.querySelectorAll(selector))

function fallbackDefinitions() {
  const rows = 8
  const columns = 12
  return [
    { loadName: 'nest_96_wellplate_200ul_flat', displayName: 'NEST 96 Well Plate 200 µL Flat', dimensions: { x: 127.56, y: 85.36, z: 14.3 }, wellGeometry: { rows, columns, xFirst: 14.28, yFirst: 74.18, zBottom: 3.5, depth: 10.8, xPitch: 9, yPitch: 9, diameter: 6.85, capacityUL: 200 }, custom: false },
    { loadName: 'opentrons_96_wellplate_200ul_pcr_full_skirt', displayName: 'Opentrons Tough 96 Well Plate 200 µL PCR Full Skirt', dimensions: { x: 127.76, y: 85.48, z: 16 }, wellGeometry: { rows, columns, xFirst: 14.38, yFirst: 74.24, zBottom: 1.05, depth: 14.95, xPitch: 9, yPitch: 9, diameter: 5.5, capacityUL: 200 }, custom: false },
    { loadName: 'opentrons_96_tiprack_20ul', displayName: 'Opentrons OT-2 96 Tip Rack 20 µL', dimensions: { x: 127.76, y: 85.48, z: 64.69 }, wellGeometry: { rows, columns, xFirst: 14.38, yFirst: 74.24, zBottom: 25.49, depth: 39.2, xPitch: 9, yPitch: 9, diameter: 3.27, capacityUL: 20 }, tipRack: true, custom: false },
    { loadName: 'opentrons_96_tiprack_300ul', displayName: 'Opentrons OT-2 96 Tip Rack 300 µL', dimensions: { x: 127.76, y: 85.48, z: 64.49 }, wellGeometry: { rows, columns, xFirst: 14.38, yFirst: 74.24, zBottom: 5.39, depth: 59.3, xPitch: 9, yPitch: 9, diameter: 5.23, capacityUL: 300 }, tipRack: true, custom: false },
    { loadName: 'opentrons_96_tiprack_1000ul', displayName: 'Opentrons OT-2 96 Tip Rack 1000 µL', dimensions: { x: 127.76, y: 85.48, z: 97.47 }, wellGeometry: { rows, columns, xFirst: 14.38, yFirst: 74.24, zBottom: 9.47, depth: 88, xPitch: 9, yPitch: 9, diameter: 7.23, capacityUL: 1000 }, tipRack: true, custom: false }
  ]
}

async function loadDefinitions() {
  try {
    const response = await fetch(PRESET_DATA_URL)
    if (!response.ok) throw new Error('Could not load bundled definitions')
    const data = await response.json()
    labwareDefs = data.definitions || fallbackDefinitions()
  } catch (error) {
    labwareDefs = fallbackDefinitions()
    console.warn('Falling back to embedded labware geometry:', error)
  }
}

function getDefinition(loadName) {
  return [...labwareDefs, ...customDefs].find(def => def.loadName === loadName) || null
}

function plateDefinitions() {
  return [...labwareDefs, ...customDefs].filter(def => !def.tipRack)
}

function populateLabwareSelects() {
  const source = $('sourceLabware')
  const dest = $('destLabware')
  const oldSource = source.value || 'nest_96_wellplate_200ul_flat'
  const oldDest = dest.value || 'opentrons_96_wellplate_200ul_pcr_full_skirt'
  const options = plateDefinitions().map(def => `<option value="${escapeHtml(def.loadName)}">${escapeHtml(def.displayName || def.loadName)}${def.custom ? ' · custom' : ''}</option>`).join('')
  source.innerHTML = options
  dest.innerHTML = options
  source.value = getDefinition(oldSource) && !getDefinition(oldSource).tipRack ? oldSource : (plateDefinitions()[0]?.loadName || '')
  dest.value = getDefinition(oldDest) && !getDefinition(oldDest).tipRack ? oldDest : (plateDefinitions()[1]?.loadName || plateDefinitions()[0]?.loadName || '')
}

function populateSlotSelects() {
  const html = Object.keys(SLOT_MAP).map(slot => `<option value="${slot}">Slot ${slot}</option>`).join('')
  all('.slot-select').forEach((select, index) => {
    const current = select.value
    select.innerHTML = html
    select.value = current || ['1', '2', '3'][index] || '1'
  })
}

function allWellNames() {
  const names = []
  for (let col = 1; col <= 12; col++) for (const row of ROWS) names.push(`${row}${col}`)
  return names
}

function wellsForChannels(channels) {
  if (channels === 8) return Array.from({ length: 12 }, (_, i) => `A${i + 1}`)
  return allWellNames()
}

function populateWellSelectors(preserve = true) {
  const channels = PIPETTES[$('pipetteModel').value]?.channels || 1
  const wells = wellsForChannels(channels)
  ;['sourceStart', 'destStart'].forEach((id, index) => {
    const select = $(id)
    const old = preserve ? select.value : ''
    select.innerHTML = wells.map(well => `<option value="${well}">${well}</option>`).join('')
    if (old && wells.includes(old)) select.value = old
    else select.value = index === 0 ? 'A1' : 'A1'
  })
  $('transferCount').max = channels === 8 ? 12 : 96
  $('transferCount').value = Math.min(Number($('transferCount').value || 4), channels === 8 ? 12 : 96)
  $('transferCountHelp').textContent = channels === 8 ? 'Each event is one 8-tip column (A–H).' : 'Each transfer consumes one tip; one 96-well rack holds 96 tips.'
  $('tipRackName').textContent = `Uses ${PIPETTES[$('pipetteModel').value].tipRack} for this pipette preset.`
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}

function getConfig() {
  return {
    robotType: $('robotType').value,
    apiLevel: $('apiLevel').value,
    pipetteModel: $('pipetteModel').value,
    mount: $('mount').value,
    clearance: Number($('wellClearance').value),
    targetMode: $('targetMode').value,
    sourceLoadName: $('sourceLabware').value,
    sourceSlot: Number($('sourceSlot').value),
    sourceStart: $('sourceStart').value,
    destLoadName: $('destLabware').value,
    destSlot: Number($('destSlot').value),
    destStart: $('destStart').value,
    tipSlot: Number($('tipSlot').value),
    volume: Number($('volume').value),
    transferCount: Number($('transferCount').value),
    composerStyle,
    actions: sequenceActions.map(action => ({ ...action })),
    protocolName: $('protocolName').value.trim() || 'LifeFabs OT-2 teaching protocol',
    origin: readOriginTransform(),
  }
}

function readOriginTransform() {
  const raw = ['originX', 'originY', 'originZ'].map(id => $(id).value.trim())
  const known = raw.every(value => value !== '' && Number.isFinite(Number(value)))
  return {
    known,
    x: known ? Number(raw[0]) : 0,
    y: known ? Number(raw[1]) : 0,
    z: known ? Number(raw[2]) : 0,
  }
}

function validateConfig(config) {
  const errors = []
  const pipette = PIPETTES[config.pipetteModel]
  if (!pipette) errors.push('Choose a supported OT-2 pipette preset.')
  if (config.robotType !== 'OT-2') errors.push('Only OT-2 is implemented in this prototype. Flex is reserved for a future version.')
  if (![config.sourceSlot, config.destSlot, config.tipSlot].every(slot => SLOT_MAP[slot])) errors.push('Deck slots must be valid OT-2 slots 1–11.')
  if (new Set([config.sourceSlot, config.destSlot, config.tipSlot]).size !== 3) errors.push('Source plate, destination plate and tip rack must occupy three different slots in this simple template.')
  if (!getDefinition(config.sourceLoadName)) errors.push('Source labware definition is missing. Load a known definition or choose a bundled preset.')
  if (!getDefinition(config.destLoadName)) errors.push('Destination labware definition is missing. Load a known definition or choose a bundled preset.')
  const countMax = pipette?.channels === 8 ? 12 : 96
  if (config.composerStyle === 'quick' && (!Number.isInteger(config.transferCount) || config.transferCount < 1 || config.transferCount > countMax)) errors.push(`Transfer count must be an integer between 1 and ${countMax} for this pipette.`)
  if (config.composerStyle === 'quick' && pipette && (!Number.isFinite(config.volume) || config.volume < pipette.min || config.volume > pipette.max)) errors.push(`${pipette.label} has a configured working range of ${pipette.min}–${pipette.max} µL in this teaching preset.`)
  if (!['bottom', 'center', 'top'].includes(config.targetMode)) errors.push('Choose a supported well reference: bottom, center or top.')
  if (config.targetMode === 'bottom' && (!Number.isFinite(config.clearance) || config.clearance < 1 || config.clearance > 10)) errors.push('Keep well-bottom clearance between 1 and 10 mm in this template; values below 1 mm are excluded to reduce collision risk.')
  const sourceWells = wellsForChannels(pipette?.channels || 1)
  const destWells = wellsForChannels(pipette?.channels || 1)
  const sourceStartIndex = sourceWells.indexOf(config.sourceStart)
  const destStartIndex = destWells.indexOf(config.destStart)
  if (config.composerStyle === 'quick' && sourceStartIndex < 0) errors.push(pipette?.channels === 8 ? 'For an 8-channel pipette, source start must be in row A (A1–A12).' : 'Source start must be a valid well address.')
  if (config.composerStyle === 'quick' && destStartIndex < 0) errors.push(pipette?.channels === 8 ? 'For an 8-channel pipette, destination start must be in row A (A1–A12).' : 'Destination start must be a valid well address.')
  if (config.composerStyle === 'quick' && sourceStartIndex >= 0 && sourceStartIndex + config.transferCount > sourceWells.length) errors.push('The selected source start plus transfer count runs past the available wells.')
  if (config.composerStyle === 'quick' && destStartIndex >= 0 && destStartIndex + config.transferCount > destWells.length) errors.push('The selected destination start plus transfer count runs past the available wells.')
  const source = getDefinition(config.sourceLoadName)
  const dest = getDefinition(config.destLoadName)
  if (config.composerStyle === 'quick' && source?.wellGeometry?.capacityUL && config.volume > source.wellGeometry.capacityUL) errors.push(`Transfer volume exceeds the defined ${source.wellGeometry.capacityUL} µL well capacity of the source labware.`)
  if (config.composerStyle === 'quick' && dest?.wellGeometry?.capacityUL && config.volume > dest.wellGeometry.capacityUL) errors.push(`Transfer volume exceeds the defined ${dest.wellGeometry.capacityUL} µL well capacity of the destination labware.`)
  if (source?.tipRack || dest?.tipRack) errors.push('A tip rack cannot be used as source or destination labware.')
  // Custom labware is permitted in the planner, but must be installed in the Opentrons App before execution.
  const protocolSlots = [
    { slot: config.sourceSlot, role: 'source labware' },
    { slot: config.destSlot, role: 'destination labware' },
    { slot: config.tipSlot, role: 'tip rack' },
  ]
  for (const module of hardwareLayout.placed_modules || []) {
    const reserved = Array.isArray(module.reserved_slots) && module.reserved_slots.length ? module.reserved_slots : [module.location]
    for (const target of protocolSlots) {
      if (reserved.map(Number).includes(Number(target.slot))) {
        errors.push(`Hardware gallery conflict: ${module.name} reserves slot ${target.slot}, which the transfer builder assigns to ${target.role}. Move the module or change the protocol slots.`)
      }
    }
  }
  if (config.composerStyle === 'sequence') errors.push(...validateSequence(config))
  return errors
}

function genWellAddress(index, channels) {
  if (channels === 8) return `A${index + 1}`
  return allWellNames()[index]
}

function wellIndex(name, channels) {
  if (channels === 8) return /^A(?:[1-9]|1[0-2])$/.test(name) ? Number(name.slice(1)) - 1 : -1
  return allWellNames().indexOf(name)
}

function locationExpression(labwareVariable, well, config) {
  if (config.targetMode === 'top') return `${labwareVariable}[${JSON.stringify(well)}].top()`
  if (config.targetMode === 'center') return `${labwareVariable}[${JSON.stringify(well)}].center()`
  return `${labwareVariable}[${JSON.stringify(well)}].bottom(z=${formatNumber(config.clearance)})`
}

function locationLabel(config) {
  if (config.targetMode === 'top') return 'well top'
  if (config.targetMode === 'center') return 'well centre'
  return `${formatNumber(config.clearance)} mm above well bottom`
}


// Editable, explicit command sequence. Intentional limits: the OT-2 preset's
// one pipette, two plates and one tip rack; no arbitrary Python or module control.
const ACTION_TYPES = {
  pickup: 'Pick up tip', aspirate: 'Aspirate', dispense: 'Dispense', mix: 'Mix',
  airgap: 'Air gap', move: 'Move tip to well target', blowout: 'Blow out', touch: 'Touch tip',
  delay: 'Wait / delay', pause: 'Pause for operator', drop: 'Drop tip'
}
const WELL_ACTIONS = new Set(['aspirate', 'dispense', 'mix', 'blowout', 'touch', 'move'])
const VOLUME_ACTIONS = new Set(['aspirate', 'dispense', 'mix', 'airgap'])
let buildTimer = null
function scheduleBuild() {
  if (activeMode !== 'build') return
  if (buildTimer) window.clearTimeout(buildTimer)
  buildTimer = window.setTimeout(() => { buildTimer = null; buildProtocol() }, 350)
}
function newAction(type = 'aspirate', initial = {}) {
  return { id: sequenceNextId++, type, plate: type === 'dispense' ? 'destination' : 'source',
    well: 'A1', volume: 50, reference: 'bottom', z: 1, tipWell: 'A1', repetitions: 3,
    seconds: 5, touchOffset: -1, touchRadius: 1, message: 'Check protocol before continuing', ...initial }
}
function setComposerStyle(style) {
  composerStyle = style
  document.querySelectorAll('input[name="composerStyle"]').forEach(r => { r.checked = r.value === style })
  $('sequenceSection').hidden = style !== 'sequence'
  $('quickTransferSection').hidden = style !== 'quick'
  all('.quick-only').forEach(el => { el.hidden = style !== 'quick' })
  $('composerModeHint').textContent = style === 'quick'
    ? 'Beginner path: choose pipette, plates and slots; select how many transfers you want; then generate. “4” means four complete transfers, not four actions.'
    : 'Sequence mode: every row is exactly one API command. Choose wells and requested tip positions separately. You control when to pick up, reuse and drop a tip.'
  if (style === 'sequence') {
    if (!sequenceActions.length) sequenceActions = makeCycle(getConfig())
    renderSequence()
  }
  scheduleBuild()
}
function makeCycle(config) {
  const channels = PIPETTES[config.pipetteModel]?.channels || 1
  const tipWells = wellsForChannels(channels)
  const used = new Set(sequenceActions.filter(a => a.type === 'pickup').map(a => a.tipWell))
  const free = tipWells.find(w => !used.has(w)) || tipWells[0]
  return [
    newAction('pickup', { tipWell: free }),
    newAction('aspirate', { plate: 'source', well: config.sourceStart, volume: config.volume, reference: config.targetMode, z: config.clearance }),
    newAction('dispense', { plate: 'destination', well: config.destStart, volume: config.volume, reference: config.targetMode, z: config.clearance }),
    newAction('drop'),
  ]
}
function appendTransferCycle() {
  const config = getConfig()
  const wells = wellsForChannels(PIPETTES[config.pipetteModel]?.channels || 1)
  const cycle = makeCycle(config)
  for (const [type, index] of [['aspirate',1],['dispense',2]]) {
    const last = sequenceActions.filter(a => a.type === type && a.plate === (type === 'aspirate' ? 'source' : 'destination')).at(-1)
    const previous = last?.well || (index === 1 ? config.sourceStart : config.destStart)
    const next = last ? wells.indexOf(previous) + 1 : wells.indexOf(previous)
    if (next < 0 || next >= wells.length) {
      $('formError').classList.add('show')
      $('formError').textContent = `Cannot add another transfer: ${type} well would be beyond the selected labware's supported ${wells.length} ${PIPETTES[config.pipetteModel]?.channels === 8 ? 'columns' : 'wells'}.`
      return
    }
    cycle[index].well = wells[next]
  }
  sequenceActions.push(...cycle)
  renderSequence()
  scheduleBuild()
}
function convertBatchToSequence() {
  const config = getConfig()
  const wells = wellsForChannels(PIPETTES[config.pipetteModel]?.channels || 1)
  const srcStart = Math.max(0, wells.indexOf(config.sourceStart))
  const dstStart = Math.max(0, wells.indexOf(config.destStart))
  if (config.transferCount < 1 || srcStart + config.transferCount > wells.length || dstStart + config.transferCount > wells.length) {
    $('formError').classList.add('show')
    $('formError').textContent = 'The requested batch does not fit the selected well range; shorten the count or change the starting well.'
    return
  }
  sequenceActions = []
  for (let i = 0; i < config.transferCount; i++) {
    const cycle = makeCycle(config)
    cycle[0].tipWell = wells[i]
    cycle[1].well = wells[srcStart + i]
    cycle[2].well = wells[dstStart + i]
    sequenceActions.push(...cycle)
  }
  setComposerStyle('sequence')
}
function sequenceOptions(values, value) {
  return values.map(([id, name]) => `<option value="${escapeHtml(id)}"${id === value ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')
}
let focusedBlockId = null
let draggingBlockId = null
function blockDescription(a) {
  if (a.type === 'pickup') return `Tip rack · ${a.tipWell}`
  if (a.type === 'drop') return 'Release current tip into fixed trash'
  if (a.type === 'pause') return a.message
  if (a.type === 'delay') return `Wait ${a.seconds} seconds`
  if (a.type === 'airgap') return `${a.volume} µL air gap`
  const target = `${a.plate === 'source' ? 'Source' : 'Destination'} ${a.well}`
  const position = a.type === 'touch' ? `rim ${a.touchOffset} mm` : `${a.reference}${a.reference === 'center' ? '' : ' ' + a.z + ' mm'}`
  return `${VOLUME_ACTIONS.has(a.type) ? a.volume + ' µL · ' : ''}${target} · ${position}`
}
function renderSequence() {
  const channels = PIPETTES[$('pipetteModel').value]?.channels || 1
  const wells = wellsForChannels(channels).map(w => [w, w])
  const targetOptions = [['bottom','Bottom + Z mm'],['center','Well centre'],['top','Top + Z mm']]
  const list = $('sequenceList')
  if (!sequenceActions.some(a => a.id === focusedBlockId)) focusedBlockId = sequenceActions[0]?.id ?? null
  list.innerHTML = sequenceActions.map((a, index) => {
    const valueInput = (key, label, value, min, max, step = '1') => `<label class="seq-control">${label}<input data-key="${key}" type="number" value="${escapeHtml(value)}" min="${min}" max="${max}" step="${step}" aria-label="Command ${index + 1} ${label}"></label>`
    const selectInput = (key, label, choices, selected) => `<label class="seq-control">${label}<select data-key="${key}" aria-label="Command ${index + 1} ${label}">${sequenceOptions(choices, selected)}</select></label>`
    let fields = ''
    if (a.type === 'pickup') fields += selectInput('tipWell', 'Tip rack well / column', wells, a.tipWell)
    if (WELL_ACTIONS.has(a.type)) {
      fields += selectInput('plate', 'Labware', [['source','Source plate'],['destination','Destination plate']], a.plate)
      fields += selectInput('well', 'Well / column', wells, a.well)
      if (a.type !== 'touch') fields += selectInput('reference', 'Position reference', targetOptions, a.reference)
      if (a.type === 'touch') { fields += valueInput('touchOffset', 'Offset from rim (mm)', a.touchOffset, -10, 10, '0.5'); fields += valueInput('touchRadius', 'Radius fraction (0–1)', a.touchRadius, 0.1, 1, '0.1') }
      if (a.reference !== 'center' && a.type !== 'touch') fields += valueInput('z', a.reference === 'bottom' ? 'Above bottom (mm)' : 'Relative to top (mm)', a.z, a.reference === 'bottom' ? 0.5 : -10, a.reference === 'bottom' ? 30 : 10, '0.5')
    }
    if (VOLUME_ACTIONS.has(a.type)) fields += valueInput('volume', 'Volume (µL)', a.volume, 0.1, 1000, '0.1')
    if (a.type === 'mix') fields += valueInput('repetitions', 'Mix cycles', a.repetitions, 1, 100)
    if (a.type === 'delay') fields += valueInput('seconds', 'Wait (seconds)', a.seconds, 0.1, 3600, '0.1')
    if (a.type === 'pause') fields += `<label class="seq-control seq-message">Operator prompt<input data-key="message" type="text" maxlength="150" value="${escapeHtml(a.message)}"></label>`
    return `<div class="sequence-row block-node block-${a.type}${focusedBlockId === a.id ? ' block-expanded' : ''}" data-id="${a.id}" draggable="true"><div class="block-entry"><span class="block-grip" aria-label="Drag block to reorder" title="Drag to reorder" draggable="true">⠿</span><span class="seq-number" aria-label="Block ${index + 1}">${index + 1}</span><button type="button" class="block-toggle" data-act="expand" aria-expanded="${focusedBlockId === a.id}"><strong>${escapeHtml(ACTION_TYPES[a.type])}</strong><small>${escapeHtml(blockDescription(a))}</small></button><span class="block-chevron" aria-hidden="true">${focusedBlockId === a.id ? '▾' : '▸'}</span></div><div class="block-editor"><div class="seq-top"><span class="seq-number" aria-label="Command ${index + 1}">${index + 1}</span>${selectInput('type', 'Command', Object.entries(ACTION_TYPES), a.type)}<div class="seq-buttons"><button type="button" data-act="up" title="Move command up" aria-label="Move command ${index + 1} up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-act="down" title="Move command down" aria-label="Move command ${index + 1} down" ${index === sequenceActions.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-act="duplicate" title="Duplicate command" aria-label="Duplicate command ${index + 1}">⧉</button><button type="button" data-act="delete" title="Remove command" aria-label="Remove command ${index + 1}">×</button></div></div><div class="seq-fields">${fields}</div></div></div>`
  }).join('') || '<p class="sequence-empty">There are no commands. Add a complete transfer cycle or choose an individual action above.</p>'
  const tipPicks = sequenceActions.filter(a => a.type === 'pickup').length
  $('sequenceSummary').textContent = `${sequenceActions.length} command(s), ${tipPicks} explicit tip pickup(s). Commands execute top to bottom. Generation validates tip order and liquid-volume limits.`
}
function attachSequenceEvents() {
  document.querySelectorAll('input[name="composerStyle"]').forEach(r => r.addEventListener('change', () => setComposerStyle(r.value)))
  $('convertSequence').addEventListener('click', convertBatchToSequence)
  $('addTransferCycle').addEventListener('click', appendTransferCycle)
  $('clearSequence').addEventListener('click', () => { sequenceActions = []; renderSequence(); scheduleBuild() })
  $('addAction').addEventListener('click', () => { const action = newAction($('newActionType').value); sequenceActions.push(action); focusedBlockId = action.id; renderSequence(); scheduleBuild() })
  $('saveSequence').addEventListener('click', () => {
    const config = getConfig()
    const out = { format: 'lifefabs-ot2-composer', version: 1, created: new Date().toISOString(),
      protocolName: config.protocolName, apiLevel: config.apiLevel, pipetteModel: config.pipetteModel,
      mount: config.mount, sourceLoadName: config.sourceLoadName, sourceSlot: config.sourceSlot,
      destLoadName: config.destLoadName, destSlot: config.destSlot, tipSlot: config.tipSlot,
      actions: config.actions }
    downloadFile(`${fileSafeName(config.protocolName)}-design.json`, JSON.stringify(out, null, 2) + '\n', 'application/json')
  })
  $('loadSequence').addEventListener('change', async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      if (file.size > 250000) throw new Error('Design JSON is too large (limit 250 KB).')
      const saved = JSON.parse(await file.text())
      if (saved.format !== 'lifefabs-ot2-composer' || saved.version !== 1 || !Array.isArray(saved.actions) || saved.actions.length > 300) throw new Error('Not a supported LifeFabs composer design (v1, max 300 actions).')
      if (saved.actions.some(a => !a || !ACTION_TYPES[a.type])) throw new Error('The saved file includes an unknown command.')
      const fields = ['apiLevel','pipetteModel','mount','sourceLabware','sourceSlot','destLabware','destSlot','tipSlot','protocolName']
      const values = [saved.apiLevel,saved.pipetteModel,saved.mount,saved.sourceLoadName,saved.sourceSlot,saved.destLoadName,saved.destSlot,saved.tipSlot,saved.protocolName]
      for (let i=0;i<fields.length;i++) {
        const el = $(fields[i])
        if (el.tagName === 'SELECT' && !Array.from(el.options).some(o => o.value === String(values[i]))) throw new Error(`Unknown or unavailable selection for ${fields[i]}: ${values[i]}`)
      }
      fields.forEach((id,i) => { $(id).value = values[i] })
      populateWellSelectors(true)
      sequenceActions = saved.actions.map(raw => newAction(raw.type, {
        type:raw.type, plate:raw.plate, well:raw.well, volume:Number(raw.volume),
        reference:raw.reference, z:Number(raw.z), tipWell:raw.tipWell,
        repetitions:Number(raw.repetitions), seconds:Number(raw.seconds),
        message:String(raw.message ?? '').slice(0,150),
        touchOffset:Number(raw.touchOffset ?? -1), touchRadius:Number(raw.touchRadius ?? 1)
      }))
      setComposerStyle('sequence')
      buildProtocol()
    } catch(error) {
      $('formError').classList.add('show')
      $('formError').textContent = `Could not open the design: ${error.message}`
    }
  })
  $('sequenceList').addEventListener('change', event => {
    const control = event.target.closest('[data-key]')
    if (!control) return
    const row = control.closest('[data-id]')
    const action = sequenceActions.find(a => a.id === Number(row?.dataset.id))
    if (!action) return
    action[control.dataset.key] = control.type === 'number' ? Number(control.value) : control.value
    if (control.dataset.key === 'type' && action.type === 'dispense') action.plate = 'destination'
    renderSequence(); scheduleBuild()
  })
  $('sequenceList').addEventListener('click', event => {
    const button = event.target.closest('[data-act]')
    if (!button) return
    const index = sequenceActions.findIndex(a => a.id === Number(button.closest('[data-id]')?.dataset.id))
    if (index < 0) return
    const type = button.dataset.act
    if (type === 'expand') { focusedBlockId = sequenceActions[index].id; renderSequence(); return }
    if (type === 'delete') sequenceActions.splice(index, 1)
    if (type === 'duplicate') sequenceActions.splice(index + 1, 0, newAction(sequenceActions[index].type, { ...sequenceActions[index], id: sequenceNextId++ }))
    if (type === 'up' && index > 0) [sequenceActions[index - 1], sequenceActions[index]] = [sequenceActions[index], sequenceActions[index - 1]]
    if (type === 'down' && index < sequenceActions.length - 1) [sequenceActions[index], sequenceActions[index + 1]] = [sequenceActions[index + 1], sequenceActions[index]]
    renderSequence(); scheduleBuild()
  })
  const sequenceList = $('sequenceList')
  sequenceList.addEventListener('dragstart', event => {
    const row = event.target.closest('.block-node')
    if (!row) return
    draggingBlockId = Number(row.dataset.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(draggingBlockId))
    row.classList.add('block-dragging')
  })
  sequenceList.addEventListener('dragover', event => {
    const row = event.target.closest('.block-node')
    if (!row || draggingBlockId === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    sequenceList.querySelectorAll('.block-drop-target').forEach(el => el.classList.remove('block-drop-target'))
    row.classList.add('block-drop-target')
  })
  sequenceList.addEventListener('drop', event => {
    const target = event.target.closest('.block-node')
    if (!target || draggingBlockId === null) return
    event.preventDefault()
    const from = sequenceActions.findIndex(a => a.id === draggingBlockId)
    const to = sequenceActions.findIndex(a => a.id === Number(target.dataset.id))
    if (from >= 0 && to >= 0 && from !== to) sequenceActions.splice(to, 0, sequenceActions.splice(from, 1)[0])
    draggingBlockId = null
    renderSequence(); scheduleBuild()
  })
  sequenceList.addEventListener('dragend', () => {
    draggingBlockId = null
    sequenceList.querySelectorAll('.block-drop-target,.block-dragging').forEach(el => el.classList.remove('block-drop-target','block-dragging'))
  })
}
function validateSequence(config) {
  const errors = []
  const actions = config.actions
  const pipette = PIPETTES[config.pipetteModel]
  if (!pipette) return errors
  const wells = wellsForChannels(pipette.channels)
  if (!actions.length) errors.push('Add at least one command to the sequence.')
  if (actions.length > 300) errors.push('For browser reliability this composer limits protocols to 300 commands; use inspected Python for longer scripts.')
  let tipLoaded = false
  let held = 0
  let airHeld = 0
  const usedTips = new Set()
  let hadLiquidAction = false
  actions.forEach((a, index) => {
    const where = `Command ${index + 1} (${ACTION_TYPES[a.type] || a.type}): `
    if (!ACTION_TYPES[a.type]) { errors.push(where + 'Unsupported action.'); return }
    if (a.type === 'pickup') {
      if (tipLoaded) errors.push(where + 'Drop the previous tip before picking up a new one.')
      if (!wells.includes(a.tipWell)) errors.push(where + 'Select a valid tip rack well or column.')
      if (usedTips.has(a.tipWell)) errors.push(where + `Tip ${a.tipWell} was already used; choose an unused tip.`)
      tipLoaded = true; held = 0; airHeld = 0; usedTips.add(a.tipWell)
    } else if (a.type === 'drop') {
      if (!tipLoaded) errors.push(where + 'There is no attached tip to drop.')
      tipLoaded = false; held = 0; airHeld = 0
    } else if (a.type === 'delay') {
      if (!Number.isFinite(a.seconds) || a.seconds <= 0 || a.seconds > 3600) errors.push(where + 'Delay must be greater than zero and at most 3600 seconds.')
    } else if (a.type === 'pause') {
      if (!String(a.message).trim()) errors.push(where + 'Enter a short message for the operator.')
    } else {
      if (!tipLoaded) errors.push(where + 'Pick up a tip before this liquid-handling action.')
      if (WELL_ACTIONS.has(a.type)) {
        const def = getDefinition(a.plate === 'source' ? config.sourceLoadName : config.destLoadName)
        const well = getWell(def, a.well)
        if (!wells.includes(a.well) || !well) errors.push(where + 'Choose a valid well/column for the selected labware and pipette.')
        if (!['bottom','center','top'].includes(a.reference)) errors.push(where + 'Choose bottom, centre or top reference.')
        if (a.type === 'touch' && (!Number.isFinite(a.touchOffset) || a.touchOffset < -10 || a.touchOffset > 10 || !Number.isFinite(a.touchRadius) || a.touchRadius < 0.1 || a.touchRadius > 1)) errors.push(where + 'Touch offset must be -10 to +10 mm and radius fraction 0.1 to 1.0.')
        if (a.type !== 'touch' && a.reference !== 'center' && (!Number.isFinite(a.z) || (a.reference === 'bottom' && (a.z < 0.5 || a.z > (well?.depth || 30))) || (a.reference === 'top' && (a.z < -10 || a.z > 10)))) errors.push(where + 'Requested Z adjustment is outside this educational editor’s limits or the well depth.')
        if (well?.totalLiquidVolume && (a.type === 'aspirate' || a.type === 'dispense' || a.type === 'mix') && a.volume > well.totalLiquidVolume) errors.push(where + `Volume exceeds the well's nominal ${well.totalLiquidVolume} µL capacity.`)
      }
      if (VOLUME_ACTIONS.has(a.type) && (!Number.isFinite(a.volume) || a.volume < 0.1 || a.volume > pipette.max || (a.type !== 'airgap' && a.volume < pipette.min))) errors.push(where + `Volume must be ${a.type === 'airgap' ? '0.1' : pipette.min}–${pipette.max} µL for the selected pipette preset.`)
      if (a.type === 'aspirate') held += Number(a.volume) || 0
      if (a.type === 'airgap') { if (held <= 0) errors.push(where + 'Aspirate liquid before adding an air gap.'); airHeld += Number(a.volume) || 0 }
      if (a.type === 'dispense') { held -= Number(a.volume) || 0; if (held < -0.0001) errors.push(where + 'Dispense volume exceeds the estimated liquid held in the tip (air gaps do not count as liquid).') }
      if (a.type === 'blowout') { held = 0; airHeld = 0 }
      if (a.type === 'mix' && (!Number.isInteger(a.repetitions) || a.repetitions < 1 || a.repetitions > 100)) errors.push(where + 'Mix cycles must be 1–100.')
      if (held + airHeld > pipette.max + 0.0001) errors.push(where + `Estimated tip contents (including air gaps) exceed ${pipette.max} µL. Split into multiple cycles.`)
      if (a.type === 'mix' && held + Number(a.volume) > pipette.max + 0.0001) errors.push(where + 'Mix volume plus tip contents exceeds the nominal pipette capacity.')
      if (VOLUME_ACTIONS.has(a.type)) hadLiquidAction = true
    }
  })
  if (tipLoaded) errors.push('The sequence ends with a tip attached: add Drop tip at the end.')
  if (!hadLiquidAction) errors.push('Add at least one aspirate, dispense, mix or air-gap action.')
  return errors.slice(0, 18)
}
function sequenceLocation(a, config) {
  const variable = a.plate === 'destination' ? 'destination_plate' : 'source_plate'
  const ref = `${variable}[${JSON.stringify(a.well)}]`
  if (a.reference === 'center') return `${ref}.center()`
  if (a.reference === 'top') return `${ref}.top(z=${formatNumber(a.z)})`
  return `${ref}.bottom(z=${formatNumber(a.z)})`
}
function galleryModuleLoadLines() {
  // Placement catalogue only; no implicit labware loading onto a module or
  // temperature/shaking/magnet commands. The official API validates module support.
  const allowed = new Set(['temperature module', 'temperature module gen2', 'magnetic module', 'magnetic module gen2', 'thermocycler module', 'thermocycler module gen2', 'heaterShakerModuleV1'])
  return (hardwareLayout.placed_modules || [])
    .filter(item => allowed.has(item.api_load_name) && SLOT_MAP[Number(item.location)])
    .map((item, i) => `    gallery_module_${i + 1} = protocol.load_module(${JSON.stringify(item.api_load_name)}, ${JSON.stringify(String(item.location))})  # Gallery module: loaded but not operated`)
}

function makeSequenceCode(config) {
  const pipette = PIPETTES[config.pipetteModel]
  const lines = [
    'from opentrons import protocol_api', '',
    `metadata = {"protocolName": ${JSON.stringify(config.protocolName)}, "author": "LifeFabs educational composer"}`,
    `requirements = {"robotType": "OT-2", "apiLevel": ${JSON.stringify(config.apiLevel)}}`, '',
    'def run(protocol: protocol_api.ProtocolContext):',
    `    source_plate = protocol.load_labware(${JSON.stringify(config.sourceLoadName)}, ${JSON.stringify(String(config.sourceSlot))})`,
    `    destination_plate = protocol.load_labware(${JSON.stringify(config.destLoadName)}, ${JSON.stringify(String(config.destSlot))})`,
    `    tip_rack = protocol.load_labware(${JSON.stringify(pipette.tipRack)}, ${JSON.stringify(String(config.tipSlot))})`,
    `    pipette = protocol.load_instrument(${JSON.stringify(config.pipetteModel)}, mount=${JSON.stringify(config.mount)}, tip_racks=[tip_rack])`,
    ...galleryModuleLoadLines(),
    '    # Ordered sequence; targets are requested API positions, not calibrated simulation.',
  ]
  for (const [index, a] of config.actions.entries()) {
    lines.push(`    # ${index + 1}. ${ACTION_TYPES[a.type]}`)
    const pos = WELL_ACTIONS.has(a.type) ? sequenceLocation(a, config) : ''
    const expressions = {
      pickup: () => `pipette.pick_up_tip(tip_rack[${JSON.stringify(a.tipWell)}])`,
      drop: () => 'pipette.drop_tip()',
      aspirate: () => `pipette.aspirate(${formatNumber(a.volume)}, ${pos})`,
      dispense: () => `pipette.dispense(${formatNumber(a.volume)}, ${pos})`,
      mix: () => `pipette.mix(${a.repetitions}, ${formatNumber(a.volume)}, ${pos})`,
      airgap: () => `pipette.air_gap(${formatNumber(a.volume)})`,
      move: () => `pipette.move_to(${pos})`,
      blowout: () => `pipette.blow_out(${pos})`,
      touch: () => `pipette.touch_tip(${a.plate === 'destination' ? 'destination_plate' : 'source_plate'}[${JSON.stringify(a.well)}], radius=${formatNumber(a.touchRadius)}, v_offset=${formatNumber(a.touchOffset)})`,
      delay: () => `protocol.delay(seconds=${formatNumber(a.seconds)})`,
      pause: () => `protocol.pause(${JSON.stringify(a.message)})`,
    }
    lines.push('    ' + expressions[a.type]())
  }
  return lines.join('\n') + '\n'
}
function planFromSequence(config) {
  const pipette = PIPETTES[config.pipetteModel]
  const tips = getDefinition(pipette.tipRack)
  return config.actions.map((a, index) => {
    if (a.type === 'pickup') {
      const well = getWell(tips, a.tipWell)
      const slot = getSlotOrigin(config.tipSlot)
      const visualPoint = well && slot ? { relative: { x: slot.x + well.x, y: slot.y + well.y, z: tips.dimensions.z }, global: null, originKnown: false } : null
      return { ...makeEvent({ kind: 'pickup', label: `Pick up ${a.tipWell}`, note: `Tip rack ${pipette.tipRack}, slot ${config.tipSlot}, well/column ${a.tipWell}. Dot is only a nominal well-column indicator; pickup Z and nozzle offsets are resolved by Opentrons.`, slot: config.tipSlot, labwareName: pipette.tipRack, well: a.tipWell, pipetteModel: config.pipetteModel, channels: pipette.channels, transferIndex: index + 1 }), visualPoint }
    }
    if (a.type === 'drop') return makeEvent({ kind: 'drop', label: 'Drop tip', note: 'Fixed trash is handled by the API, not a guessed XYZ position.', labwareName: 'fixed trash', pipetteModel: config.pipetteModel, channels: pipette.channels, transferIndex: index + 1 })
    if (!WELL_ACTIONS.has(a.type)) return makeEvent({ kind: a.type, label: a.type === 'airgap' ? `Air gap ${formatNumber(a.volume)} µL` : a.type === 'delay' ? `Wait ${formatNumber(a.seconds)} seconds` : 'Pause for operator', note: a.type === 'pause' ? a.message : 'This command does not define a new well-target point.', pipetteModel: config.pipetteModel, channels: pipette.channels, volume: a.volume, transferIndex: index + 1 })
    const isDest = a.plate === 'destination'
    const def = getDefinition(isDest ? config.destLoadName : config.sourceLoadName)
    const slot = isDest ? config.destSlot : config.sourceSlot
    const pos = targetPosition(def, slot, a.well, a.type === 'touch' ? 'top' : a.reference, a.type === 'touch' ? a.touchOffset : a.reference === 'center' ? 0 : a.z, config.origin)
    return makeEvent({ kind: a.type, label: `${ACTION_TYPES[a.type]}${VOLUME_ACTIONS.has(a.type) ? ` ${formatNumber(a.volume)} µL` : ''}`, note: `${a.plate} ${def?.displayName || def?.loadName}, well ${a.well}, ${a.type === 'touch' ? `touching walls at ${formatNumber(a.touchOffset)} mm from the rim, radius fraction ${formatNumber(a.touchRadius)}` : `${a.reference}${a.reference === 'center' ? '' : ` with Z ${formatNumber(a.z)} mm`}`}. This is a nominal requested tip location, not a safe motion path.${a.type === 'touch' ? ' The API performs a multi-point wall-contact motion, not the plotted nominal point.' : ''}`, slot, labwareName: def?.loadName, well: a.well, pipetteModel: config.pipetteModel, channels: pipette.channels, point: pos, volume: a.volume, transferIndex: index + 1 })
  })
}
function autoSyncMountedPipette() {
  // Live sync only in composer, never overwrite imported/inspected Python.
  if (hardwareAutoSyncing || activeMode !== 'build') return
  const mounted = (hardwareLayout.mounted_pipettes || []).filter(p => !!PIPETTES[p.api_load_name])
  if (!mounted.length) { scheduleBuild(); return }
  let selected = mounted.find(p => p.mount === $('mount').value)
  if (!selected && mounted.length === 1) selected = mounted[0]
  if (selected && (selected.api_load_name !== $('pipetteModel').value || selected.mount !== $('mount').value)) {
    hardwareAutoSyncing = true
    $('pipetteModel').value = selected.api_load_name
    $('mount').value = selected.mount
    populateWellSelectors(true)
    if (composerStyle === 'sequence') renderSequence()
    hardwareAutoSyncing = false
    markPreviewStale()
  }
  scheduleBuild()
}

function makeGeneratedCode(config) {
  if (config.composerStyle === 'sequence') return makeSequenceCode(config)
  const pipette = PIPETTES[config.pipetteModel]
  const sourceStart = wellIndex(config.sourceStart, pipette.channels)
  const destStart = wellIndex(config.destStart, pipette.channels)
  const isMulti = pipette.channels === 8
  const srcVar = 'source_plate'
  const dstVar = 'destination_plate'
  const tipVar = 'tip_rack'
  const lines = [
    'from opentrons import protocol_api',
    '',
    'metadata = {',
    `    "protocolName": ${JSON.stringify(config.protocolName)},`,
    '    "author": "LifeFabs educational template",',
    '    "description": "Generated transfer protocol. Inspect, analyse, and dry-run before execution.",',
    '}',
    '',
    `requirements = {"robotType": "OT-2", "apiLevel": ${JSON.stringify(config.apiLevel)}}`,
    '',
    'def run(protocol: protocol_api.ProtocolContext):',
    `    ${srcVar} = protocol.load_labware(${JSON.stringify(config.sourceLoadName)}, ${JSON.stringify(String(config.sourceSlot))})`,
    `    ${dstVar} = protocol.load_labware(${JSON.stringify(config.destLoadName)}, ${JSON.stringify(String(config.destSlot))})`,
    `    ${tipVar} = protocol.load_labware(${JSON.stringify(pipette.tipRack)}, ${JSON.stringify(String(config.tipSlot))})`,
    `    pipette = protocol.load_instrument(${JSON.stringify(config.pipetteModel)}, mount=${JSON.stringify(config.mount)}, tip_racks=[${tipVar}])`,
    ...galleryModuleLoadLines(),
    '',
    `    # Explicitly unrolled transfers: ${config.transferCount} ${isMulti ? '8-channel column(s)' : 'single-channel transfer(s)'}.`,
    `    # Target: ${locationLabel(config)}. API resolves labware plus robot calibration/offsets.`,
  ]
  const tipRackNames = wellsForChannels(pipette.channels)
  for (let i = 0; i < config.transferCount; i++) {
    const sourceWell = genWellAddress(sourceStart + i, pipette.channels)
    const destWell = genWellAddress(destStart + i, pipette.channels)
    const tipWell = tipRackNames[i]
    lines.push('', `    # Transfer ${String(i + 1).padStart(2, '0')}: ${sourceWell} -> ${destWell}`)
    lines.push(`    pipette.pick_up_tip(${tipVar}[${JSON.stringify(tipWell)}])`)
    lines.push(`    pipette.aspirate(${formatNumber(config.volume)}, ${locationExpression(srcVar, sourceWell, config)})`)
    lines.push(`    pipette.dispense(${formatNumber(config.volume)}, ${locationExpression(dstVar, destWell, config)})`)
    lines.push('    pipette.drop_tip()')
  }
  lines.push('')
  return lines.join('\n')
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)))
}

function getSlotOrigin(slot) {
  const position = SLOT_MAP[Number(slot)]
  if (!position) return null
  return { x: position.col * SLOT_PITCH_X, y: (3 - position.row) * SLOT_PITCH_Y, z: 0, ...position }
}

function getWell(def, address) {
  if (!def || !address) return null
  if (def.wellMap && def.wellMap[address]) return def.wellMap[address]
  const geo = def.wellGeometry
  if (!geo) return null
  const match = /^([A-H])([1-9]|1[0-2])$/.exec(address)
  if (!match) return null
  const rowIndex = ROWS.indexOf(match[1])
  const colIndex = Number(match[2]) - 1
  if (rowIndex < 0 || rowIndex >= geo.rows || colIndex < 0 || colIndex >= geo.columns) return null
  return {
    x: geo.xFirst + colIndex * geo.xPitch,
    y: geo.yFirst - rowIndex * geo.yPitch,
    z: geo.zBottom,
    depth: geo.depth,
    diameter: geo.diameter,
    totalLiquidVolume: geo.capacityUL,
  }
}

function targetPosition(def, slot, address, method = 'bottom', zAdjustment = 0, origin = readOriginTransform()) {
  const well = getWell(def, address)
  const slotOrigin = getSlotOrigin(slot)
  if (!well || !slotOrigin) return null
  const zRelativeWell = method === 'top' ? well.z + well.depth + zAdjustment : method === 'center' ? well.z + well.depth / 2 + zAdjustment : well.z + zAdjustment
  const relative = {
    x: slotOrigin.x + well.x + (def.cornerOffsetFromSlot?.x || 0),
    y: slotOrigin.y + well.y + (def.cornerOffsetFromSlot?.y || 0),
    z: slotOrigin.z + zRelativeWell + (def.cornerOffsetFromSlot?.z || 0),
  }
  const global = { x: relative.x + origin.x, y: relative.y + origin.y, z: relative.z + origin.z }
  return { relative, global: origin.known ? global : null, well, slotOrigin, method, zAdjustment, originKnown: origin.known }
}

function makeEvent({ kind, label, note, slot, labwareName, well, pipetteModel, channels, point, volume, transferIndex }) {
  return { kind, label, note, slot: slot == null ? null : Number(slot), labwareName: labwareName || null, well: well || null, pipetteModel: pipetteModel || null, channels: channels || 1, point: point || null, volume: volume ?? null, transferIndex: transferIndex || null }
}

function planFromConfig(config) {
  if (config.composerStyle === 'sequence') return planFromSequence(config)
  const pipette = PIPETTES[config.pipetteModel]
  const src = getDefinition(config.sourceLoadName)
  const dst = getDefinition(config.destLoadName)
  const tips = getDefinition(pipette.tipRack)
  const srcStart = wellIndex(config.sourceStart, pipette.channels)
  const dstStart = wellIndex(config.destStart, pipette.channels)
  const tipWells = wellsForChannels(pipette.channels)
  const srcWells = wellsForChannels(pipette.channels)
  const dstWells = wellsForChannels(pipette.channels)
  const steps = []
  for (let i = 0; i < config.transferCount; i++) {
    const sw = srcWells[srcStart + i]
    const dw = dstWells[dstStart + i]
    const tw = tipWells[i]
    const tipDef = tips
    const tipWell = getWell(tipDef, tw)
    const tipSlotOrigin = getSlotOrigin(config.tipSlot)
    const pickupVisualPoint = tipWell && tipSlotOrigin ? { relative: { x: tipSlotOrigin.x + tipWell.x, y: tipSlotOrigin.y + tipWell.y, z: tipDef.dimensions.z }, global: null, originKnown: false } : null
    steps.push({ ...makeEvent({ kind: 'pickup', label: `Pick up tip${pipette.channels === 8 ? ' column' : ''}`, note: `Tip-rack address: ${pipette.tipRack} ${tw}, slot ${config.tipSlot}. The marker shows the nominal tip-well column only; actual pickup Z and XY are determined by the tip-rack definition, pipette/tip geometry and calibration, so no exact pickup coordinate is claimed.`, slot: config.tipSlot, labwareName: pipette.tipRack, well: tw, pipetteModel: config.pipetteModel, channels: pipette.channels, transferIndex: i + 1 }), visualPoint: pickupVisualPoint })
    steps.push(makeEvent({ kind: 'aspirate', label: `Aspirate ${formatNumber(config.volume)} µL`, note: `${src.displayName}: well ${sw}. Target: ${locationLabel(config)}. Position uses the labware definition plus a slot-grid placement; calibrated motion strategy is resolved by the Opentrons API.`, slot: config.sourceSlot, labwareName: src.loadName, well: sw, pipetteModel: config.pipetteModel, channels: pipette.channels, point: targetPosition(src, config.sourceSlot, sw, config.targetMode, config.targetMode === 'bottom' ? config.clearance : 0, config.origin), volume: config.volume, transferIndex: i + 1 }))
    steps.push(makeEvent({ kind: 'dispense', label: `Dispense ${formatNumber(config.volume)} µL`, note: `${dst.displayName}: well ${dw}. Target: ${locationLabel(config)}. Position uses the labware definition plus a slot-grid placement; calibrated motion strategy is resolved by the Opentrons API.`, slot: config.destSlot, labwareName: dst.loadName, well: dw, pipetteModel: config.pipetteModel, channels: pipette.channels, point: targetPosition(dst, config.destSlot, dw, config.targetMode, config.targetMode === 'bottom' ? config.clearance : 0, config.origin), volume: config.volume, transferIndex: i + 1 }))
    steps.push(makeEvent({ kind: 'drop', label: 'Drop tip', note: 'The fixed OT-2 trash location is handled by the API. This visualiser does not invent a deck-space coordinate for the trash target.', slot: null, labwareName: 'fixed trash', pipetteModel: config.pipetteModel, channels: pipette.channels, transferIndex: i + 1 }))
  }
  return steps
}

function setDiagnostics(items, status = 'ready', title = 'Protocol checks', subtitle = '') {
  lastDiagnostics = items
  const list = $('diagnosticList')
  list.innerHTML = ''
  items.forEach(item => {
    const li = document.createElement('li')
    if (item.level === 'warn' || item.level === 'error') li.classList.add('warn')
    const icon = document.createElement('span')
    icon.className = 'diag-icon'
    icon.textContent = item.level === 'pass' ? '✓' : item.level === 'error' ? '!' : item.level === 'warn' ? '△' : 'i'
    const text = document.createElement('span')
    text.textContent = item.text
    li.append(icon, text)
    list.append(li)
  })
  const warns = items.filter(item => item.level === 'warn' || item.level === 'error').length
  const statusEl = $('analysisStatus')
  statusEl.textContent = warns ? '!' : '✓'
  statusEl.classList.toggle('warn', warns > 0)
  $('analysisTitle').textContent = title
  $('analysisSubtitle').textContent = subtitle || (warns ? `${warns} issue(s) or limitations need attention.` : 'No issues detected within this checker’s scope.')
}

function hardwareModuleAtSlot(slot) {
  return (hardwareLayout.placed_modules || []).find(module => {
    const reserved = Array.isArray(module.reserved_slots) && module.reserved_slots.length ? module.reserved_slots : [module.location]
    return reserved.map(Number).includes(Number(slot))
  }) || null
}

function describeTargetMode(config) {
  if (config.targetMode === 'top') return 'Well top'
  if (config.targetMode === 'center') return 'Well centre'
  return `${formatNumber(config.clearance)} mm above well bottom`
}

function getHardwareReview(config) {
  const issues = []
  const mounted = hardwareLayout.mounted_pipettes || []
  let title = ''
  let description = ''

  if (!config) {
    title = mounted.length ? 'Gallery layout is configured; no builder plan to compare yet' : 'Hardware gallery is still unconfigured'
    description = 'The gallery is a proposed hardware layout, not a live connection to a robot. Generate a builder plan or analyse a Python script to compare declared pipettes and labware against this layout.'
  } else if (!mounted.length) {
    title = 'Hardware gallery has no mounted pipette yet'
    description = 'The viewer follows the transfer builder, while the gallery below remains a separate proposed hardware layout. Mount a supported pipette in the gallery to synchronize it automatically with Build mode.'
  } else {
    const onSelectedMount = mounted.find(item => item.mount === config.mount)
    const otherMounts = mounted.map(item => `${item.name} on ${item.mount}`).join('; ')
    if (onSelectedMount && onSelectedMount.api_load_name === config.pipetteModel) {
      title = `Pipette match: ${onSelectedMount.name} on the ${config.mount} mount`
      description = `The gallery's mounted pipette matches the protocol builder. Mounted pipettes: ${otherMounts}. Review the module overlays below before treating the plan as ready.`
    } else if (onSelectedMount) {
      title = 'Hardware mismatch: selected mount has a different pipette'
      description = `Builder: ${PIPETTES[config.pipetteModel]?.label || config.pipetteModel} on ${config.mount}. Gallery: ${onSelectedMount.name} on ${onSelectedMount.mount}. Select the intended active mount or use “Sync pipette now”; unsupported gallery models do not auto-populate the composer.`
      issues.push(`Pipette mismatch: builder expects ${config.pipetteModel} on ${config.mount}, but the gallery shows ${onSelectedMount.api_load_name} on that mount.`)
    } else if (mounted.length === 1) {
      title = 'Hardware mismatch: protocol mount is empty in the gallery'
      description = `The protocol requests ${PIPETTES[config.pipetteModel]?.label || config.pipetteModel} on ${config.mount}, but the gallery has ${mounted[0].name} on ${mounted[0].mount}. Apply the gallery pipette or adjust the gallery.`
      issues.push(`Mount mismatch: the builder uses ${config.mount}, while the gallery pipette is attached to ${mounted[0].mount}.`)
    } else {
      title = 'Review the gallery’s two mounted pipettes'
      description = `Mounted in gallery: ${otherMounts}. The transfer builder uses ${PIPETTES[config.pipetteModel]?.label || config.pipetteModel} on ${config.mount}. Confirm that the intended instrument is installed on the selected mount.`
      issues.push('Two pipettes are configured in the gallery; verify the transfer protocol’s selected mount and actual hardware configuration.')
    }
  }

  if (config) {
    for (const module of hardwareLayout.placed_modules || []) {
      const reserved = Array.isArray(module.reserved_slots) && module.reserved_slots.length ? module.reserved_slots.map(Number) : [Number(module.location)]
      for (const row of [
        { slot: config.sourceSlot, role: 'source labware' },
        { slot: config.destSlot, role: 'destination labware' },
        { slot: config.tipSlot, role: 'tip rack' },
      ]) {
        if (row.slot != null && reserved.includes(Number(row.slot))) issues.push(`${module.name} reserves slot ${row.slot}, which the transfer builder assigns to ${row.role}.`)
      }
    }
  }
  return { title, description, issues, hasConflict: issues.length > 0, hasPipette: mounted.length > 0 }
}

function getHardwareReviewForInspected(stats) {
  const issues = []
  const mounted = hardwareLayout.mounted_pipettes || []
  const scriptPipettes = stats?.rawPipettes || []
  const scriptLabwares = stats?.rawLabwares || []

  // An empty gallery is an unconfigured comparison, not evidence that the
  // inspected script's pipette declaration is wrong. Report model/mount
  // mismatches only when the user has placed at least one gallery pipette.
  if (mounted.length) {
    for (const pipette of scriptPipettes) {
      const galleryAtMount = mounted.find(item => item.mount === pipette.mount)
      if (!galleryAtMount) {
        issues.push(`Inspected script declares ${pipette.model} on ${pipette.mount}, but the gallery has no pipette on that mount.`)
      } else if (galleryAtMount.api_load_name !== pipette.model) {
        issues.push(`Pipette mismatch on ${pipette.mount}: inspected script uses ${pipette.model}; gallery shows ${galleryAtMount.api_load_name}.`)
      }
    }
  }
  for (const labware of scriptLabwares) {
    const module = hardwareModuleAtSlot(labware.slot)
    if (module) issues.push(`Inspected script loads ${labware.loadName} in slot ${labware.slot}, which is reserved by gallery module ${module.name}.`)
  }

  let title
  let description
  if (!scriptPipettes.length && !scriptLabwares.length) {
    title = 'Inspected script has too little literal hardware information to compare'
    description = 'The static browser parser did not identify literal load_instrument/load_labware declarations. This does not prove the Python is invalid; use official API simulation and review the declared setup manually.'
  } else if (issues.length) {
    title = 'Hardware review required for inspected Python'
    description = 'The gallery is compared with literal hardware declarations found by static inspection. Dynamic code, labware stacks, module offsets and calibration are not inferred.'
  } else if (!scriptPipettes.length || !scriptLabwares.length) {
    title = 'Partial hardware comparison only'
    description = `The parser found ${scriptPipettes.length} literal pipette declaration(s) and ${scriptLabwares.length} literal labware declaration(s). The gallery comparison is incomplete; unsupported/dynamic Python may contain additional hardware configuration.`
  } else if (!mounted.length) {
    title = 'Script parsed; gallery pipettes are not configured'
    description = 'The viewer follows the most recently analysed code. The module gallery is overlaid for comparison, but no pipette is attached in the proposed layout; this is not a physical robot-state readout.'
  } else {
    title = 'No mismatch found in the parsed hardware declarations'
    description = `The gallery pipette mount/model and the inspected script's literal labware slots show no detected mismatch. This is a partial static check, not proof of full protocol or physical compatibility.`
  }
  return { title, description, issues, hasConflict: issues.length > 0, hasPipette: mounted.length > 0 }
}

function updateProtocolOverview() {
  if (externalPlan && activeMode === 'build') {
    const plan = externalPlan
    $('activeProtocolName').textContent = plan.name
    $('activeProtocolDescription').textContent = plan.errors.length ? 'Hardware and blocks are synchronized, but the Python build is blocked until the listed issues are resolved.' : 'Live preview from the placed hardware and visual blocks. This is not robot telemetry or a calibrated path.'
    $('protocolOverview').dataset.state = plan.errors.length ? 'error' : 'synced'
    $('protocolSyncBadge').textContent = plan.errors.length ? 'FIX BLOCKS / HARDWARE' : 'LIVE · SYNCED'
    $('summaryRobot').textContent = 'OT-2 · API ' + plan.apiLevel
    $('summaryPipette').textContent = plan.pipettes.map(p => p.load_name + ' · ' + p.mount).join(' / ') || 'No mounted pipette'
    $('summaryTransfers').textContent = plan.blocks.length + ' visual blocks · ' + plan.steps.length + ' events'
    $('summaryLabware').textContent = plan.labware.map(l => 'S' + l.slot + ' ' + l.label).join(' · ') || 'No deck labware'
    $('summaryTarget').textContent = 'Per block · bottom / center / top / tip address'
    $('hardwareLinkTitle').textContent = 'Single source of truth: hardware configurator'
    $('hardwareLinkDescription').textContent = 'Every mounted pipette, placed labware/tip rack and module in Section 1 is read directly into the map and Python. Blocks target those same placed items; missing or incompatible hardware disables code generation.'
    $('syncHardwareSettings').hidden = true
    const conflicts = $('hardwareConflictList'); conflicts.hidden = !plan.errors.length
    conflicts.innerHTML = plan.errors.length ? '<strong>Resolve before running:</strong><ul>' + plan.errors.map(e => '<li>' + escapeHtml(e) + '</li>').join('') + '</ul>' : ''
    return
  }
  const overview = $('protocolOverview')
  if (!overview) return
  const badge = $('protocolSyncBadge')
  const title = $('activeProtocolName')
  const description = $('activeProtocolDescription')
  const config = generatedConfig
  let state = 'empty'
  let badgeText = 'NO PLAN'

  if (viewerSource === 'inspectPending') {
    state = 'stale'
    badgeText = 'ANALYSE TO SYNC'
    title.textContent = config?.protocolName || 'Python inspection selected'
    description.textContent = 'Inspect mode is selected, but the viewer still shows the previous event trace. Click “Analyse / inspect script” to make the viewer follow the current Python editor contents.'
  } else if (viewerSource === 'inspect' && inspectedStats) {
    state = previewStale ? 'stale' : 'inspect'
    badgeText = previewStale ? 'CODE CHANGED' : 'STATIC INSPECTION'
    title.textContent = inspectedStats.protocolName || 'Uploaded / edited Python protocol'
    description.textContent = previewStale
      ? 'The editor contents changed after the last analysis. The viewer still shows the last analysed trace; analyse again to update it.'
      : `Viewer follows the last static analysis: ${inspectedStats.eventCount} mapped event(s), ${inspectedStats.labwareCount} literal labware load(s), ${inspectedStats.pipetteCount} literal pipette load(s). This is not full Python execution.`
    $('summaryRobot').textContent = `${inspectedStats.robotType || 'Robot unconfirmed'} · API ${inspectedStats.apiLevel || 'unconfirmed'}`
    $('summaryPipette').textContent = inspectedStats.pipetteSummary || 'Not detected'
    $('summaryTransfers').textContent = `${inspectedStats.eventCount} mapped event(s)`
    $('summaryLabware').textContent = inspectedStats.labwareSummary || 'Not mapped'
    $('summaryTarget').textContent = 'Varies by selected event'
  } else if (!config) {
    state = previewFailed ? 'error' : 'empty'
    badgeText = previewFailed ? 'BUILD FAILED' : 'NO PLAN'
    title.textContent = 'No generated protocol yet'
    description.textContent = 'Choose guided batch or editable sequence in the left panel. Valid changes refresh the viewer automatically; the Generate button also rebuilds it.'
  } else {
    const editorDiffers = viewerSource === 'builder' && builderEditorStale
    state = previewFailed ? 'error' : previewStale ? 'stale' : 'synced'
    badgeText = previewFailed ? 'BUILD FAILED' : previewStale ? (editorDiffers ? 'CODE / VIEWER STALE' : 'PREVIEW STALE') : 'PREVIEW CURRENT'
    title.textContent = config.protocolName
    description.textContent = previewFailed
      ? 'The latest build attempt failed. The viewer retains the last successful plan, so it may not match the current form values.'
      : previewStale
        ? editorDiffers
          ? 'The Python editor now differs from the generated source. The viewer still represents the last generated builder plan, not your edited code. Switch to inspect mode and analyse the script, or regenerate the builder template.'
          : 'One or more builder settings have changed since this preview was generated. The drawing and event list below still represent the previous successful plan; the preview refreshes after valid changes; use the Generate button if needed.'
        : 'This viewer is synchronised with the last successful Build-mode generation. It shows the requested event target, not actual robot telemetry or a calibrated/collision-checked gantry path.'
    const pipette = PIPETTES[config.pipetteModel]
    $('summaryRobot').textContent = `${config.robotType} · API ${config.apiLevel}`
    $('summaryPipette').textContent = `${pipette?.label || config.pipetteModel} · ${config.mount}`
    $('summaryTransfers').textContent = config.composerStyle === 'sequence' ? `${config.actions.length} editable command(s)` : `${formatNumber(config.volume)} µL × ${config.transferCount} ${pipette?.channels === 8 ? 'column(s)' : 'transfer(s)'}`
    $('summaryLabware').textContent = `S${config.sourceSlot} ${config.sourceStart} → S${config.destSlot} ${config.destStart} · tips S${config.tipSlot}`
    $('summaryTarget').textContent = config.composerStyle === 'sequence' ? 'Per-command bottom / centre / top' : describeTargetMode(config)
  }

  const review = viewerSource === 'inspect' && inspectedStats
    ? getHardwareReviewForInspected(inspectedStats)
    : getHardwareReview(config)
  $('hardwareLinkTitle').textContent = review.title
  $('hardwareLinkDescription').textContent = review.description
  const conflictList = $('hardwareConflictList')
  conflictList.hidden = !review.issues.length
  conflictList.innerHTML = review.issues.length
    ? `<strong>Review before using this layout:</strong><ul>${review.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>`
    : ''

  // Keep preview freshness distinct from hardware compatibility: a current preview can still have hardware conflicts.
  if (!previewStale && !previewFailed && ['builder', 'inspect'].includes(viewerSource) && review.hasConflict) {
    state = 'conflict'
    badgeText = 'HARDWARE REVIEW'
  }
  overview.dataset.state = state
  badge.textContent = badgeText
}

function markPreviewStale() {
  // Builder form changes only invalidate a builder-generated trace. If the
  // viewer is showing an inspected script, the form is a separate draft.
  if (viewerSource === 'builder' && generatedConfig) {
    builderFormStale = true
    previewStale = true
    previewFailed = false
  }
  updateProtocolOverview()
}

function syncHardwarePipetteToBuilder() {
  if (activeMode !== 'build') switchMode('build')
  const mounted = hardwareLayout.mounted_pipettes || []
  if (!mounted.length) {
    $('hardwareLinkTitle').textContent = 'No pipette is mounted in the gallery yet'
    $('hardwareLinkDescription').textContent = 'Drag a supported pipette from the catalogue to the left or right mount, then use this button again.'
    return
  }
  const selectedMount = $('mount').value
  let selected = mounted.find(item => item.mount === selectedMount)
  if (!selected && mounted.length === 1) selected = mounted[0]
  if (!selected) {
    $('hardwareLinkTitle').textContent = 'Choose which gallery pipette to apply'
    $('hardwareLinkDescription').textContent = `The gallery has ${mounted.map(item => `${item.name} on ${item.mount}`).join('; ')}. Select the desired mount in the builder first, or leave only one pipette mounted, then press this button.`
    return
  }
  const option = Array.from($('pipetteModel').options).find(item => item.value === selected.api_load_name && !item.disabled)
  if (!option) {
    $('hardwareLinkTitle').textContent = `${selected.name} is not supported by the current transfer-builder preset list`
    $('hardwareLinkDescription').textContent = `The gallery item uses API load name ${selected.api_load_name}; add a validated builder preset for this model before syncing it. The gallery layout remains available for planning.`
    return
  }
  $('pipetteModel').value = selected.api_load_name
  $('mount').value = selected.mount
  populateWellSelectors(true)
  builderFormStale = true
  builderEditorStale = $('codeEditor').value !== lastGeneratedCode
  previewStale = true
  previewFailed = false
  viewerSource = 'builder'
  updateProtocolOverview()
  $('hardwareLinkTitle').textContent = `Applied ${selected.name} to the transfer builder`
  $('hardwareLinkDescription').textContent = `The composer uses ${selected.api_load_name} on ${selected.mount}. The preview and Python refresh automatically when compatible; check the volume range if the previous liquid plan was designed for a different pipette.`
  scheduleBuild()
}

function buildProtocol() {
  if (window.lifefabsV4Active && activeMode === 'build') return
  const config = getConfig()
  const errors = validateConfig(config)
  if (errors.length) {
    $('formError').classList.add('show')
    $('formError').textContent = errors.join(' ')
    previewFailed = true
    if (generatedConfig) previewStale = true
    setDiagnostics(errors.map(text => ({ level: 'error', text })), 'warn', 'Protocol not generated', 'Resolve the builder issues first.')
    updateProtocolOverview()
    return
  }
  $('formError').classList.remove('show')
  $('formError').textContent = ''
  generatedConfig = config
  viewerSource = 'builder'
  previewStale = false
  previewFailed = false
  builderFormStale = false
  builderEditorStale = false
  inspectEditorStale = false
  currentSteps = planFromConfig(config)
  activeStepIndex = Math.min(activeStepIndex, currentSteps.length - 1)
  $('codeEditor').value = makeGeneratedCode(config)
  lastGeneratedCode = $('codeEditor').value
  $('codeTitle').textContent = 'Generated OT-2 Python protocol'
  $('codeState').textContent = 'Generated template · editable'
  updateCodeMeta()
  updateTimelineAndView()
  const checks = [
    { level: 'pass', text: 'Robot target is OT-2; API level and deck locations are set in the generated header.' },
    { level: 'pass', text: config.composerStyle === 'sequence' ? `${config.actions.length} ordered commands generated from the editable sequence, with explicit tip lifecycle.` : `${config.transferCount} explicit ${PIPETTES[config.pipetteModel].channels === 8 ? '8-channel column transfer(s)' : 'single-channel transfer(s)'} generated with separate tips.` },
    { level: 'pass', text: config.composerStyle === 'sequence' ? 'Command ordering, tip availability, simple liquid volume bounds and literal well addresses passed sequence checks.' : 'The three deck locations are distinct; selected addresses fit the supported 96-well layouts and volume does not exceed each defined well capacity.' },
    { level: config.origin.known ? 'pass' : 'warn', text: config.origin.known ? 'A manual origin transform is entered; review its provenance before interpreting coordinates as robot deck coordinates.' : 'X/Y/Z are shown in the visualiser’s slot-1-relative frame because no calibrated slot-1 origin transform was supplied.' },
    { level: 'warn', text: 'This is not official API execution or collision analysis. Review the code and run Opentrons App analysis/simulation before a physical run.' },
    ...(galleryModuleLoadLines().length ? [{ level: 'warn', text: `${galleryModuleLoadLines().length} module load declaration(s) copied from the gallery. They are idle: module operations, labware-on-module loading and physical compatibility are NOT created automatically.` }] : []),
  ]
  if (getDefinition(config.sourceLoadName)?.custom || getDefinition(config.destLoadName)?.custom) checks.push({ level: 'warn', text: 'One or more custom labware definitions are used only for local geometry. The same definition must be installed in the robot software.' })
  setDiagnostics(checks, 'ready', 'Protocol generated', 'The selected design is internally consistent within the composer’s supported command subset.')
  updateCodeMeta()
  updateProtocolOverview()
}

function makeSlotMap() {
  if (externalPlan) {
    const mapping = {}
    externalPlan.labware.forEach(l => { mapping[Number(l.slot)] = { kind: l.role === 'tips' ? 'tips' : l.role === 'source' ? 'source' : l.role === 'destination' ? 'destination' : 'labware', name: l.label.toUpperCase().slice(0, 11), loadName: l.load_name, moduleUid:l.moduleUid||null } })
    return mapping
  }
  const roleForSlot = {}
  if (viewerSource === 'inspect' && Array.isArray(inspectedStats?.rawLabwares)) {
    let labwareIndex = 0
    for (const labware of inspectedStats.rawLabwares) {
      if (!SLOT_MAP[Number(labware.slot)]) continue
      const def = getDefinition(labware.loadName)
      const isTipRack = Boolean(def?.tipRack) || /tiprack/i.test(labware.loadName || '')
      if (isTipRack) {
        roleForSlot[Number(labware.slot)] = { kind: 'tips', name: 'TIPS', loadName: labware.loadName }
      } else {
        labwareIndex += 1
        roleForSlot[Number(labware.slot)] = { kind: 'labware', name: `LOAD ${labwareIndex}`, loadName: labware.loadName }
      }
    }
    return roleForSlot
  }
  const config = generatedConfig
  if (config) {
    roleForSlot[config.sourceSlot] = { kind: 'source', name: 'SOURCE', loadName: config.sourceLoadName }
    roleForSlot[config.destSlot] = { kind: 'destination', name: 'DEST', loadName: config.destLoadName }
    roleForSlot[config.tipSlot] = { kind: 'tips', name: 'TIPS', loadName: PIPETTES[config.pipetteModel].tipRack }
  }
  return roleForSlot
}

function relativePointForStep(step) {
  if (!step?.point) return null
  return step.point.relative
}

function activeStep() {
  return currentSteps[activeStepIndex] || null
}

function getPathPoints() {
  const path = []
  currentSteps.slice(0, activeStepIndex + 1).forEach(step => {
    const pos = relativePointForStep(step)
    if (pos) path.push(pos)
  })
  return path
}

function renderDeck2D() {
  const svg = $('deckSvg')
  svg.setAttribute('viewBox', '0 0 760 480')
  const esc = escapeHtml
  const scaleX = 1.22
  const scaleY = 1.02
  const left = 62
  const bottom = 430
  const sx = x => left + x * scaleX
  const sy = y => bottom - y * scaleY
  const roleMap = makeSlotMap()
  const active = activeStep()
  const path = getPathPoints()
  const pieces = []
  pieces.push(`<rect x="34" y="28" width="565" height="421" rx="13" fill="#f0f4f0" stroke="#cedbd2" stroke-width="1.5"/>`)
  pieces.push(`<text x="47" y="18" fill="${COLORS.muted}" font-size="10" font-family="monospace" letter-spacing="1.1">OT-2 SLOT MAP · TOP-DOWN</text>`)
  pieces.push(`<text x="63" y="464" fill="${COLORS.muted}" font-size="10" font-family="monospace">FRONT / OPERATOR SIDE</text>`)
  for (const [slotString, location] of Object.entries(SLOT_MAP)) {
    const slot = Number(slotString)
    const xBase = location.col * SLOT_PITCH_X
    const yBase = (3 - location.row) * SLOT_PITCH_Y
    const x = sx(xBase)
    const y = sy(yBase + SLOT_DEPTH)
    const w = SLOT_WIDTH * scaleX
    const h = SLOT_DEPTH * scaleY
    const role = roleMap[slot]
    const module = hardwareModuleAtSlot(slot)
    const moduleConflict = Boolean(module && role && role.moduleUid !== module.uid)
    const fill = role ? role.kind === 'source' ? '#d8eee7' : role.kind === 'destination' ? '#e0e9f8' : role.kind === 'labware' ? '#eee9ff' : '#f8ead8' : module ? '#e1e7fb' : '#fff'
    const stroke = moduleConflict ? COLORS.active : role ? role.kind === 'source' ? COLORS.source : role.kind === 'destination' ? COLORS.destination : role.kind === 'labware' ? '#8b6fce' : COLORS.tips : module ? '#6479bd' : '#d5dfd8'
    pieces.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="${role ? 2 : 1}"/>`)
    pieces.push(`<text x="${x + 8}" y="${y + 15}" fill="${COLORS.ink}" font-size="11" font-weight="700" font-family="monospace">${slot}</text>`)
    if (role) {
      pieces.push(`<text x="${x + w - 8}" y="${y + 15}" text-anchor="end" fill="${stroke}" font-size="9" font-weight="700" font-family="monospace">${role.name}</text>`)
      const def = getDefinition(role.loadName)
      if (def && def.wellGeometry) {
        for (let row = 0; row < (def.wellGeometry.rows || 8); row++) {
          for (let col = 0; col < (def.wellGeometry.columns || 12); col++) {
            const wx = sx(xBase + def.wellGeometry.xFirst + col * def.wellGeometry.xPitch)
            const wy = sy(yBase + def.wellGeometry.yFirst - row * def.wellGeometry.yPitch)
            if (def.wellGeometry.length && def.wellGeometry.width) {
              const ww = def.wellGeometry.length * scaleX * .6, hh = def.wellGeometry.width * scaleY * .6
              pieces.push(`<rect x="${wx-ww/2}" y="${wy-hh/2}" width="${ww}" height="${hh}" rx="1" fill="${stroke}" opacity=".45"/>`)
            } else pieces.push(`<circle cx="${wx}" cy="${wy}" r="1.8" fill="${stroke}" opacity=".55"/>`)
          }
        }
      }
    }
    if (module) {
      pieces.push(`<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="5" fill="${moduleConflict ? '#ffe4df' : '#dbe4ff'}" fill-opacity=".48" stroke="${moduleConflict ? COLORS.active : '#6479bd'}" stroke-width="2" stroke-dasharray="4 3"/>`)
      const moduleLabel = moduleConflict ? 'SLOT CONFLICT' : (role && role.moduleUid === module.uid) ? 'STACKED ON MODULE' : Number(module.location) === slot ? `MODULE · ${(module.name || 'module').replace(/ Module.*/i, '').slice(0, 18)}` : 'RESERVED FOOTPRINT'
      pieces.push(`<text x="${x + w / 2}" y="${y + h - 12}" text-anchor="middle" fill="${moduleConflict ? '#9f4534' : '#344c91'}" font-size="8.5" font-weight="700" font-family="monospace">${esc(moduleLabel)}</text>`)
    }
  }
  const trashX = sx(2 * SLOT_PITCH_X)
  const trashY = sy(3 * SLOT_PITCH_Y + SLOT_DEPTH) - 5
  pieces.push(`<path d="M${trashX + 12} ${trashY + 12} h${SLOT_WIDTH * scaleX - 24} v${SLOT_DEPTH * scaleY - 12} h-${SLOT_WIDTH * scaleX - 24} Z" fill="#e5e9e6" stroke="#9ba9a1" stroke-dasharray="4 3"/>`)
  pieces.push(`<text x="${trashX + SLOT_WIDTH * scaleX / 2}" y="${trashY + 45}" text-anchor="middle" fill="#74817b" font-size="10" font-family="monospace">FIXED</text><text x="${trashX + SLOT_WIDTH * scaleX / 2}" y="${trashY + 59}" text-anchor="middle" fill="#74817b" font-size="10" font-family="monospace">TRASH</text>`)
  // Axis arrows: +x points right; +y points toward the back (up the drawing).
  pieces.push(`<path d="M95 394 h62 m-8 -6 l8 6 -8 6" fill="none" stroke="${COLORS.teal || '#147c73'}" stroke-width="1.5"/><text x="163" y="398" fill="#147c73" font-size="10" font-family="monospace">+X</text>`)
  pieces.push(`<path d="M95 394 v-49 m-6 8 l6 -8 6 8" fill="none" stroke="#147c73" stroke-width="1.5"/><text x="103" y="350" fill="#147c73" font-size="10" font-family="monospace">+Y</text>`)
  if (path.length > 1) {
    const points = path.map(point => `${sx(point.x)},${sy(point.y)}`).join(' ')
    pieces.push(`<polyline points="${points}" fill="none" stroke="${COLORS.active}" stroke-width="2.6" stroke-dasharray="6 5" opacity=".9"/>`)
  }
  const activeMapPoint = active?.point?.relative || active?.visualPoint?.relative || null
  if (activeMapPoint) {
    const pos = activeMapPoint
    const cx = sx(pos.x), cy = sy(pos.y)
    pieces.push(`<circle cx="${cx}" cy="${cy}" r="10" fill="${COLORS.active}" fill-opacity=".16" stroke="${COLORS.active}" stroke-width="2.2"/><circle cx="${cx}" cy="${cy}" r="3.3" fill="${COLORS.active}"/>`)
    pieces.push(`<path d="M${cx + 8} ${cy - 8} l18 -18" stroke="${COLORS.active}" stroke-width="1.2"/><rect x="${Math.min(cx + 22, 590)}" y="${Math.max(cy - 38, 36)}" width="115" height="24" rx="5" fill="#fff" stroke="#e5b4a8"/><text x="${Math.min(cx + 28, 596)}" y="${Math.max(cy - 22, 52)}" fill="#9f4534" font-size="9" font-family="monospace">${esc(active.well || '')} · ${esc(active.point ? active.kind.toUpperCase() : 'TIP-WELL XY')}</text>`)
    if ((active.channels || 1) === 8 && active.well) {
      for (let row = 1; row < 8; row++) pieces.push(`<circle cx="${cx}" cy="${sy(pos.y - row * 9)}" r="3.3" fill="${COLORS.active}" fill-opacity=".76"/>`)
    }
  } else if (active) {
    const slot = active.slot
    const loc = SLOT_MAP[slot]
    if (loc) {
      const x = sx(loc.col * SLOT_PITCH_X) + SLOT_WIDTH * scaleX / 2
      const y = sy((3 - loc.row) * SLOT_PITCH_Y + SLOT_DEPTH / 2)
      pieces.push(`<circle cx="${x}" cy="${y}" r="10" fill="${COLORS.active}" fill-opacity=".15" stroke="${COLORS.active}" stroke-width="2"/><text x="${x + 13}" y="${y - 11}" fill="#9f4534" font-size="9" font-family="monospace">${esc(active.kind.toUpperCase())}</text>`)
    }
  }
  pieces.push(`<text x="610" y="80" fill="${COLORS.ink}" font-size="11" font-weight="700" font-family="monospace">DECK FRAME</text>`)
  pieces.push(`<text x="610" y="100" fill="${COLORS.muted}" font-size="9" font-family="monospace">1–11 slots</text>`)
  pieces.push(`<text x="610" y="116" fill="${COLORS.muted}" font-size="9" font-family="monospace">SBS footprint</text>`)
  pieces.push(`<text x="610" y="132" fill="${COLORS.muted}" font-size="9" font-family="monospace">nominal pitch</text>`)
  pieces.push(`<text x="610" y="150" fill="${COLORS.muted}" font-size="9" font-family="monospace">132.5 × 90.5 mm</text>`)
  pieces.push(`<text x="610" y="186" fill="${COLORS.ink}" font-size="10" font-weight="700" font-family="monospace">ACTIVE EVENT</text>`)
  pieces.push(`<text x="610" y="204" fill="${COLORS.muted}" font-size="9" font-family="monospace">${esc(active ? active.kind.toUpperCase() : '—')}</text>`)
  pieces.push(`<text x="610" y="220" fill="${COLORS.muted}" font-size="9" font-family="monospace">${esc(active?.well || 'No well')}</text>`)
  pieces.push(`<text x="610" y="253" fill="${COLORS.ink}" font-size="10" font-weight="700" font-family="monospace">NOTE</text>`)
  pieces.push(`<text x="610" y="270" fill="${COLORS.muted}" font-size="9" font-family="monospace">Coordinates are</text><text x="610" y="284" fill="${COLORS.muted}" font-size="9" font-family="monospace">not calibrated</text><text x="610" y="298" fill="${COLORS.muted}" font-size="9" font-family="monospace">target links only.</text>`)
  // Mounted pipettes do not occupy a deck slot; render both gantry mounts separately.
  pieces.push(`<text x="610" y="333" fill="${COLORS.ink}" font-size="10" font-weight="700" font-family="monospace">GANTRY MOUNTS</text>`)
  for (const [i, mount] of ['left','right'].entries()) {
    const pip = (hardwareLayout.mounted_pipettes || []).find(x => x.mount === mount)
    const title = pip ? (pip.api_load_name || pip.name).slice(0, 21) : 'empty'
    const y = 343 + i * 48
    pieces.push(`<rect x="606" y="${y}" width="143" height="39" rx="7" fill="${pip ? '#daefe8' : '#e7ecea'}" stroke="${pip ? '#278a7c' : '#bdc7c3'}"/>`)
    pieces.push(`<text x="613" y="${y+13}" fill="#39535c" font-size="9" font-weight="700" font-family="monospace">${mount.toUpperCase()}</text>`)
    pieces.push(`<text x="613" y="${y+27}" fill="#39535c" font-size="8.3" font-family="monospace">${esc(title)}</text>`)
  }
  svg.innerHTML = pieces.join('')
}

function renderDeck3D() {
  const svg = $('deckSvg')
  svg.setAttribute('viewBox', '0 0 760 480')
  const pieces = []
  const roleMap = makeSlotMap()
  const active = activeStep()
  const path = getPathPoints()
  const p = (x, y, z = 0) => ({ x: 350 + (x - y) * 0.64, y: 68 + (x + y) * 0.27 - z * 0.48 })
  const poly = points => points.map(pt => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(' ')
  const rectFace = (x, y, w, h, z = 0) => [p(x, y, z), p(x + w, y, z), p(x + w, y + h, z), p(x, y + h, z)]
  pieces.push(`<rect x="24" y="20" width="712" height="432" rx="13" fill="#f5f8f5" stroke="#d5e0d8"/>`)
  pieces.push(`<text x="42" y="42" fill="${COLORS.muted}" font-size="10" font-family="monospace" letter-spacing="1">ISOMETRIC COORDINATE PROJECTION · MILLIMETRES</text>`)
  const deck = rectFace(0, 0, SLOT_PITCH_X * 3, SLOT_PITCH_Y * 4, 0)
  const deckFrontLeft = p(0, 0, -8), deckFrontRight = p(SLOT_PITCH_X * 3, 0, -8), deckBackRight = p(SLOT_PITCH_X * 3, SLOT_PITCH_Y * 4, -8), deckBackLeft = p(0, SLOT_PITCH_Y * 4, -8)
  pieces.push(`<polygon points="${poly([deck[0], deck[3], deckBackLeft, deckFrontLeft])}" fill="#cdd8d1" stroke="#aebeb4"/>`)
  pieces.push(`<polygon points="${poly([deck[1], deck[2], deckBackRight, deckFrontRight])}" fill="#c0cdc5" stroke="#aebeb4"/>`)
  pieces.push(`<polygon points="${poly(deck)}" fill="#e9efea" stroke="#9fb2a6" stroke-width="1.5"/>`)
  // slots and labware objects
  for (const [slotStr, location] of Object.entries(SLOT_MAP)) {
    const slot = Number(slotStr)
    const x0 = location.col * SLOT_PITCH_X
    const y0 = (3 - location.row) * SLOT_PITCH_Y
    const role = roleMap[slot]
    const def = role ? getDefinition(role.loadName) : null
    const height = def?.dimensions?.z || 0
    const labwareWidth = def?.dimensions?.x || SLOT_WIDTH
    const labwareDepth = def?.dimensions?.y || SLOT_DEPTH
    const base = rectFace(x0, y0, role ? labwareWidth : SLOT_WIDTH, role ? labwareDepth : SLOT_DEPTH, 0)
    const top = rectFace(x0, y0, role ? labwareWidth : SLOT_WIDTH, role ? labwareDepth : SLOT_DEPTH, height)
    const front = [base[0], base[1], top[1], top[0]]
    const right = [base[1], base[2], top[2], top[1]]
    const fill = role ? role.kind === 'source' ? '#9cd0c0' : role.kind === 'destination' ? '#a9c1e6' : role.kind === 'labware' ? '#cfc3f2' : '#e8bd7f' : '#f8faf8'
    const edge = role ? role.kind === 'source' ? COLORS.source : role.kind === 'destination' ? COLORS.destination : role.kind === 'labware' ? '#8b6fce' : COLORS.tips : '#c7d5cc'
    pieces.push(`<polygon points="${poly(front)}" fill="${role ? '#c6dcd2' : '#d5ded7'}" stroke="${edge}" stroke-width=".7"/>`)
    pieces.push(`<polygon points="${poly(right)}" fill="${role ? '#b5cfc4' : '#cbd7ce'}" stroke="${edge}" stroke-width=".7"/>`)
    pieces.push(`<polygon points="${poly(top)}" fill="${fill}" stroke="${edge}" stroke-width="${role ? 1.6 : .7}"/>`)
    const labelPos = p(x0 + 9, y0 + 8, height + 1)
    pieces.push(`<text x="${labelPos.x}" y="${labelPos.y}" fill="${COLORS.ink}" font-size="9" font-family="monospace" font-weight="700">${slot}${role ? ` / ${role.name}` : ''}</text>`)
    if (def?.wellGeometry) {
      for (let row = 0; row < (def.wellGeometry.rows || 8); row++) for (let col = 0; col < (def.wellGeometry.columns || 12); col++) {
        const wp = p(x0 + def.wellGeometry.xFirst + col * def.wellGeometry.xPitch, y0 + def.wellGeometry.yFirst - row * def.wellGeometry.yPitch, height + 0.4)
        pieces.push(`<circle cx="${wp.x}" cy="${wp.y}" r="1.15" fill="${edge}" opacity=".7"/>`)
      }
    }
    const module = hardwareModuleAtSlot(slot)
    if (module) {
      const conflict = Boolean(role && role.moduleUid !== module.uid)
      const modPoly = rectFace(x0 + 3, y0 + 3, SLOT_WIDTH - 6, SLOT_DEPTH - 6, Math.max(height, 1) + 1.5)
      pieces.push(`<polygon points="${poly(modPoly)}" fill="${conflict ? '#efb3aa' : '#b8c6f5'}" fill-opacity=".42" stroke="${conflict ? COLORS.active : '#6479bd'}" stroke-width="2" stroke-dasharray="4 3"/>`)
      const ml = p(x0 + 8, y0 + 17, Math.max(height, 1) + 2)
      const text = conflict ? 'SLOT CONFLICT' : role?.moduleUid === module.uid ? 'STACKED' : Number(module.location) === slot ? 'MODULE' : 'RESERVED'
      pieces.push(`<text x="${ml.x}" y="${ml.y}" fill="${conflict ? '#9f4534' : '#344c91'}" font-size="8.5" font-family="monospace" font-weight="700">${escapeHtml(text)}</text>`)
    }
  }
  // Fixed trash: location is pictured, but its robot target is intentionally API-defined.
  const trash = rectFace(SLOT_PITCH_X * 2 + 8, SLOT_PITCH_Y * 3 + 2, 110, 66, 27)
  pieces.push(`<polygon points="${poly(trash)}" fill="#d2d9d4" stroke="#8e9e96" stroke-dasharray="3 3"/>`)
  const trashLabel = p(SLOT_PITCH_X * 2 + 35, SLOT_PITCH_Y * 3 + 24, 28)
  pieces.push(`<text x="${trashLabel.x}" y="${trashLabel.y}" fill="#65736e" font-size="8" font-family="monospace">TRASH</text>`)
  if (path.length > 1) {
    pieces.push(`<polyline points="${poly(path.map(q => p(q.x, q.y, q.z)))}" fill="none" stroke="${COLORS.active}" stroke-width="2.5" stroke-dasharray="5 4"/>`)
  }
  const activeMapPoint = active?.point?.relative || active?.visualPoint?.relative || null
  if (activeMapPoint) {
    const pos = activeMapPoint
    const screen = p(pos.x, pos.y, pos.z)
    const base = p(pos.x, pos.y, 0)
    pieces.push(`<line x1="${base.x}" y1="${base.y}" x2="${screen.x}" y2="${screen.y}" stroke="${COLORS.active}" stroke-dasharray="3 3" stroke-width="1.3"/>`)
    pieces.push(`<circle cx="${screen.x}" cy="${screen.y}" r="8" fill="${COLORS.active}" fill-opacity=".18" stroke="${COLORS.active}" stroke-width="2"/><circle cx="${screen.x}" cy="${screen.y}" r="2.5" fill="${COLORS.active}"/>`)
    if ((active.channels || 1) === 8) for (let i = 1; i < 8; i++) {
      const rowPt = p(pos.x, pos.y - i * 9, pos.z)
      pieces.push(`<circle cx="${rowPt.x}" cy="${rowPt.y}" r="2.4" fill="${COLORS.active}" fill-opacity=".85"/>`)
    }
    const tx = Math.min(screen.x + 12, 630), ty = Math.max(screen.y - 15, 52)
    pieces.push(`<text x="${tx}" y="${ty}" fill="#a64938" font-size="9" font-family="monospace">${escapeHtml(active.well || '')} · ${active.point ? `Z ${formatNumber(pos.z)} mm` : 'tip-rack column (visual only)'}</text>`)
  }
  // Axis triad in the same right-handed coordinate directions as the plotted deck frame.
  pieces.push(`<path d="M95 389 h58 m-8 -6 l8 6 -8 6" fill="none" stroke="#147c73" stroke-width="1.6"/><text x="158" y="393" fill="#147c73" font-size="10" font-family="monospace">+X</text>`)
  pieces.push(`<path d="M95 389 l-28 -18 m9 0 l-9 0 2 9" fill="none" stroke="#147c73" stroke-width="1.6"/><text x="50" y="364" fill="#147c73" font-size="10" font-family="monospace">+Y</text>`)
  pieces.push(`<path d="M95 389 v-38 m-5 8 l5 -8 5 8" fill="none" stroke="#147c73" stroke-width="1.6"/><text x="102" y="354" fill="#147c73" font-size="10" font-family="monospace">+Z</text>`)
  pieces.push(`<text x="555" y="410" fill="${COLORS.muted}" font-size="9" font-family="monospace">X right · Y back · Z up</text>`)
  pieces.push(`<text x="555" y="425" fill="${COLORS.muted}" font-size="9" font-family="monospace">Slot-1-relative frame</text>`)
  svg.innerHTML = pieces.join('')
}

function renderCadView() {
  if (cadViewer) {
    cadViewer.resize()
    return
  }
  initCadViewer().catch(error => {
    const loading = $('cadLoading')
    loading.innerHTML = `Could not load the CAD viewer: ${escapeHtml(error.message || String(error))}<br><br>The 2D and 3D coordinate views remain available. Try using the site over HTTP/HTTPS rather than opening the HTML file directly.`
  })
}

async function initCadViewer() {
  const THREE = await import('three')
  const { STLLoader } = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/STLLoader.js')
  const { OrbitControls } = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js')
  const host = $('cadView')
  const width = host.clientWidth || 700
  const height = host.clientHeight || 440
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#f3f6f3')
  const camera = new THREE.PerspectiveCamera(37, width / height, 1, 10000)
  camera.up.set(0, 1, 0)
  camera.position.set(880, 720, 900)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  host.append(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.07
  controls.target.set(0, 0, 0)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x65756f, 2.0))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
  keyLight.position.set(500, 900, 500)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.8)
  fillLight.position.set(-600, 300, -500)
  scene.add(fillLight)
  const grid = new THREE.GridHelper(900, 18, 0xc8d5cc, 0xe0e7e2)
  grid.position.y = -280
  scene.add(grid)
  const axes = new THREE.AxesHelper(160)
  axes.position.set(-310, -280, -280)
  scene.add(axes)
  const loading = $('cadLoading')
  const loader = new STLLoader()
  await new Promise((resolve, reject) => loader.load('assets/ot2-reference-model-detailed.stl', geometry => {
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.center()
    const material = new THREE.MeshStandardMaterial({ color: 0x8a9992, metalness: 0.18, roughness: 0.6, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)
    const bounds = geometry.boundingBox
    const extent = new THREE.Vector3()
    bounds.getSize(extent)
    const largest = Math.max(extent.x, extent.y, extent.z)
    camera.position.set(largest * 1.35, largest * 1.12, largest * 1.5)
    camera.near = 1
    camera.far = largest * 10
    camera.updateProjectionMatrix()
    controls.target.set(0, 0, 0)
    controls.update()
    resolve()
  }, undefined, reject))
  loading.classList.add('hidden')
  let rafId = 0
  const renderLoop = () => {
    rafId = window.requestAnimationFrame(renderLoop)
    controls.update()
    renderer.render(scene, camera)
  }
  renderLoop()
  const resize = () => {
    const w = host.clientWidth || width
    const h = host.clientHeight || height
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  cadViewer = { resize, dispose: () => { window.cancelAnimationFrame(rafId); observer.disconnect(); renderer.dispose(); controls.dispose() } }
}

function updateVisualMode() {
  $('deckVisual').classList.toggle('hidden', activeView === 'cad')
  $('cadPanel').classList.toggle('hidden', activeView !== 'cad')
  all('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === activeView))
  if (activeView === '2d') {
    $('visualTitle').textContent = 'OT-2 deck map'
    $('visualSubtitle').textContent = 'Last synced plan + selected endpoint · not robot telemetry'
    renderDeck2D()
  } else if (activeView === '3d') {
    $('visualTitle').textContent = 'Isometric target view'
    $('visualSubtitle').textContent = 'Nominal deck projection + active endpoint · not calibrated motion'
    renderDeck3D()
  } else {
    $('visualTitle').textContent = 'OT-2 CAD reference'
    $('visualSubtitle').textContent = 'Rotatable STL model supplied with the reference materials'
    renderCadView()
  }
}

function updateCoordinateDetails() {
  const active = activeStep()
  if (!active) {
    $('targetName').textContent = 'No protocol generated yet'
    $('targetNote').textContent = 'Generate a transfer to inspect its planned movements. Coordinates refer to the tip target requested by the API, not the pipette carriage motor position.'
    ;['coordX', 'coordY', 'coordZ'].forEach(id => $(id).textContent = '—')
    $('coordinateFrame').textContent = 'Coordinate frame: no current valid block events. Hardware placements remain displayed.'
    $('stepCounter').textContent = 'EVENT 0 / 0'
    $('stepLabel').textContent = 'No active event'
    return
  }
  $('targetName').textContent = `${String(activeStepIndex + 1).padStart(2, '0')} · ${active.label}`
  $('targetNote').textContent = active.note
  const point = active.point
  if (point) {
    const coords = point.originKnown ? point.global : point.relative
    $('coordX').textContent = coords.x.toFixed(2)
    $('coordY').textContent = coords.y.toFixed(2)
    $('coordZ').textContent = coords.z.toFixed(2)
    $('coordinateFrame').textContent = point.originKnown ? 'Frame: manual robot-deck origin transform added to nominal slot layout. Verify transform provenance.' : 'Frame: slot-1-relative nominal layout. Absolute robot-deck coordinates are not claimed.'
  } else {
    ;['coordX', 'coordY', 'coordZ'].forEach(id => $(id).textContent = 'API')
    $('coordinateFrame').textContent = active.kind === 'drop' ? 'Frame: fixed trash target resolved by the Opentrons API.' : 'Frame: pipette + tip-rack pickup geometry resolved by the Opentrons API.'
  }
  $('stepCounter').textContent = `EVENT ${activeStepIndex + 1} / ${currentSteps.length}`
  $('stepLabel').textContent = active.kind.toUpperCase()
}

function updateTimelineAndView() {
  $('stepSlider').max = Math.max(currentSteps.length - 1, 0)
  $('stepSlider').value = Math.min(activeStepIndex, Math.max(currentSteps.length - 1, 0))
  const chipList = $('stepChips')
  chipList.innerHTML = ''
  currentSteps.forEach((step, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `step-chip${index === activeStepIndex ? ' active' : ''}`
    button.innerHTML = `<strong>${String(index + 1).padStart(2, '0')}</strong>${escapeHtml(step.label)}`
    button.addEventListener('click', () => { activeStepIndex = index; updateTimelineAndView() })
    chipList.append(button)
  })
  updateCoordinateDetails()
  updateVisualMode()
}

function updateCodeMeta() {
  const code = $('codeEditor').value
  const lines = code ? code.split('\n').length : 0
  $('codeLineCount').textContent = `${lines} line${lines === 1 ? '' : 's'}`
}

function addCustomLabwareFromFile(file) {
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const json = JSON.parse(String(reader.result))
      const loadName = json.parameters?.loadName || json.loadName
      const dims = json.dimensions || {}
      const sourceWells = json.wells
      if (!loadName || !dims.xDimension || !dims.yDimension || !dims.zDimension || !sourceWells || typeof sourceWells !== 'object') throw new Error('Expected a v2 labware definition with parameters.loadName, dimensions and wells.')
      const wellMap = {}
      for (const [name, well] of Object.entries(sourceWells)) {
        if (!Number.isFinite(well.x) || !Number.isFinite(well.y) || !Number.isFinite(well.z) || !Number.isFinite(well.depth)) continue
        wellMap[name] = { x: well.x, y: well.y, z: well.z, depth: well.depth, diameter: well.diameter, xDimension: well.xDimension, yDimension: well.yDimension, totalLiquidVolume: well.totalLiquidVolume }
      }
      if (!Object.keys(wellMap).length) throw new Error('No well coordinate definitions were found.')
      const def = {
        loadName,
        displayName: json.metadata?.displayName || loadName,
        brand: json.brand?.brand || 'Custom',
        dimensions: { x: dims.xDimension, y: dims.yDimension, z: dims.zDimension },
        wellMap,
        ordering: json.ordering || null,
        cornerOffsetFromSlot: json.cornerOffsetFromSlot || { x: 0, y: 0, z: 0 },
        tipRack: Boolean(json.parameters?.isTiprack),
        tipLength: json.parameters?.tipLength,
        tipOverlap: json.parameters?.tipoverlap ?? json.parameters?.tipOverlap,
        custom: true,
      }
      customDefs = customDefs.filter(old => old.loadName !== loadName)
      customDefs.push(def)
      populateLabwareSelects()
      if (!def.tipRack) {
        $('sourceLabware').value = loadName
        $('destLabware').value = loadName
      }
      $('customDefStatus').textContent = `Loaded ${def.displayName} (${Object.keys(wellMap).length} wells) for local geometry only. Confirm this load name and definition are installed in the robot software before using a protocol.`
      $('customDefStatus').classList.add('disabled-note')
    } catch (error) {
      $('customDefStatus').textContent = `Could not use that file: ${error.message}`
      $('customDefStatus').classList.add('disabled-note')
    }
  }
  reader.readAsText(file)
}

function parseLabwareAndPipettes(code) {
  const labwares = new Map()
  const pipettes = new Map()
  const loadLabwarePattern = /(?:^|\n)\s*(\w+)\s*=\s*protocol\.load_labware\(\s*['"]([^'"]+)['"]\s*,\s*(?:slot\s*=\s*)?['"]?(\d{1,2})['"]?/g
  let match
  while ((match = loadLabwarePattern.exec(code)) !== null) labwares.set(match[1], { loadName: match[2], slot: Number(match[3]) })
  const loadInstrumentPattern = /(?:^|\n)\s*(\w+)\s*=\s*protocol\.load_instrument\(\s*['"]([^'"]+)['"]\s*,\s*mount\s*=\s*['"](left|right)['"]/g
  while ((match = loadInstrumentPattern.exec(code)) !== null) pipettes.set(match[1], { model: match[2], mount: match[3], channels: match[2].includes('multi') ? 8 : 1 })
  return { labwares, pipettes }
}

function eventFromParsedPosition({ kind, volume, variable, wellName, method, adjustment, labwares, pipettes, lineNumber, codeLine }) {
  const labware = labwares.get(variable)
  if (!labware) return { event: null, diagnostic: { level: 'warn', text: `Line ${lineNumber}: ${variable} is used as labware but no supported literal load_labware assignment was found.` } }
  const def = getDefinition(labware.loadName)
  if (!def) return { event: null, diagnostic: { level: 'warn', text: `Line ${lineNumber}: no bundled geometry for ${labware.loadName}. Upload its official labware definition to show well coordinates.` } }
  const point = targetPosition(def, labware.slot, wellName, method, adjustment ?? 0, readOriginTransform())
  if (!point) return { event: null, diagnostic: { level: 'warn', text: `Line ${lineNumber}: could not map well ${wellName} in ${labware.loadName}.` } }
  const pipette = Array.from(pipettes.values())[0]
  if (pipette?.channels === 8 && !/^A/.test(wellName)) return { event: null, diagnostic: { level: 'warn', text: `Line ${lineNumber}: an 8-channel target is usually specified using the primary A-row well (A1–A12); ${wellName} may not describe the intended column.` } }
  return {
    event: makeEvent({ kind, label: `${kind === 'aspirate' ? 'Aspirate' : 'Dispense'}${volume != null ? ` ${formatNumber(volume)} µL` : ''}`, note: `Parsed from line ${lineNumber}: ${codeLine.trim()}. Position uses the ${def.displayName} definition and the explicit .${method}() expression. Transit path and current robot calibration are not simulated.`, slot: labware.slot, labwareName: labware.loadName, well: wellName, pipetteModel: pipette?.model || null, channels: pipette?.channels || 1, point, volume, transferIndex: null }),
    diagnostic: { level: 'pass', text: `Line ${lineNumber}: mapped ${kind} at ${variable}["${wellName}"].${method}() to the selected labware definition.` }
  }
}

function analyseScript(code) {
  const diagnostics = []
  const lower = code.toLowerCase()
  const { labwares, pipettes } = parseLabwareAndPipettes(code)
  const steps = []
  const lines = code.split(/\r?\n/)
  if (!/['"]robotType['"]\s*:\s*['"]OT-2['"]/.test(code)) {
    if (/['"]robotType['"]\s*:\s*['"]Flex['"]/.test(code) || /robottype\s*=\s*['"]flex['"]/.test(lower)) diagnostics.push({ level: 'error', text: 'The file declares Flex. This browser prototype visualises OT-2 only; Flex deck coordinates and hardware are not implemented.' })
    else diagnostics.push({ level: 'warn', text: 'Could not confirm requirements = {"robotType": "OT-2", ...}. Add an explicit OT-2 requirement and confirm API compatibility in official software.' })
  } else diagnostics.push({ level: 'pass', text: 'Protocol header declares robotType OT-2.' })
  const apiMatch = code.match(/['"]apiLevel['"]\s*:\s*['"]([0-9.]+)['"]/) || code.match(/apiLevel\s*=\s*['"]([0-9.]+)['"]/) 
  if (apiMatch) diagnostics.push({ level: 'pass', text: `Declared API level ${apiMatch[1]}; confirm that the installed robot software supports it.` })
  else diagnostics.push({ level: 'warn', text: 'No literal API level could be detected in the protocol header.' })
  if (labwares.size) diagnostics.push({ level: 'pass', text: `Found ${labwares.size} literal labware load(s): ${Array.from(labwares.values()).map(item => `slot ${item.slot} ${item.loadName}`).join('; ')}.` })
  else diagnostics.push({ level: 'error', text: 'No supported literal protocol.load_labware("load_name", "slot") assignments were found.' })
  if (pipettes.size) diagnostics.push({ level: 'pass', text: `Found ${pipettes.size} literal instrument load(s): ${Array.from(pipettes.values()).map(item => `${item.model} on ${item.mount}`).join('; ')}.` })
  else diagnostics.push({ level: 'error', text: 'No supported literal protocol.load_instrument(..., mount="left/right") assignment was found.' })
  const usedSlots = new Map()
  for (const [variable, item] of labwares.entries()) {
    if (!SLOT_MAP[item.slot]) diagnostics.push({ level: 'warn', text: `${variable} uses slot ${item.slot}; the OT-2 deck map in this prototype recognises slots 1–11 only.` })
    if (usedSlots.has(item.slot)) diagnostics.push({ level: 'warn', text: `Slot conflict: ${variable} and ${usedSlots.get(item.slot)} both load into slot ${item.slot}. Stacking/module layouts are not modelled here.` })
    usedSlots.set(item.slot, variable)
    if (!getDefinition(item.loadName)) diagnostics.push({ level: 'warn', text: `No bundled geometry for ${item.loadName}; its wells cannot be plotted until you load its official JSON definition.` })
  }
  const recognizedLines = new Set()
  const directPosition = /^(\w+)\.(aspirate|dispense)\(\s*([\d]+(?:\.[\d]+)?)\s*,\s*(\w+)\s*\[\s*['"]([A-H](?:[1-9]|1[0-2]))['"]\s*\]\.(bottom|top|center)\(\s*(?:z\s*=\s*(-?[\d]+(?:\.[\d]+)?))?\s*\)\s*\)\s*$/
  const pickWithWell = /^(\w+)\.pick_up_tip\(\s*(\w+)\s*\[\s*['"]([A-H](?:[1-9]|1[0-2]))['"]\s*\]\s*\)\s*$/
  const dropTip = /^(\w+)\.drop_tip\(\s*\)\s*$/
  const transferLiteral = /^(\w+)\.transfer\(\s*([\d]+(?:\.[\d]+)?)\s*,\s*(\w+)\s*\[\s*['"]([A-H](?:[1-9]|1[0-2]))['"]\s*\]\s*,\s*(\w+)\s*\[\s*['"]([A-H](?:[1-9]|1[0-2]))['"]\s*\](?:\s*,.*)?\)\s*$/
  const primaryPipette = Array.from(pipettes.values())[0] || null
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1
    const line = rawLine.trim()
    const clean = line.split('#')[0].trim()
    if (!clean) return
    let match = clean.match(pickWithWell)
    if (match) {
      recognizedLines.add(lineNumber)
      const rack = labwares.get(match[2])
      if (rack) steps.push(makeEvent({ kind: 'pickup', label: 'Pick up tip', note: `Parsed from line ${lineNumber}. Pickup target is calculated by Opentrons using the tip rack definition, tip-length/overlap and calibration; a simple well XYZ point is not inferred.`, slot: rack.slot, labwareName: rack.loadName, well: match[3], pipetteModel: primaryPipette?.model, channels: primaryPipette?.channels }))
      else diagnostics.push({ level: 'warn', text: `Line ${lineNumber}: tip rack ${match[2]} was not found in the literal labware loads.` })
      return
    }
    match = clean.match(dropTip)
    if (match) {
      recognizedLines.add(lineNumber)
      steps.push(makeEvent({ kind: 'drop', label: 'Drop tip', note: `Parsed from line ${lineNumber}. Trash positioning is resolved by the Opentrons API and is not converted to a guessed XYZ coordinate.`, slot: null, labwareName: 'fixed trash', pipetteModel: primaryPipette?.model, channels: primaryPipette?.channels }))
      return
    }
    match = clean.match(directPosition)
    if (match) {
      recognizedLines.add(lineNumber)
      const result = eventFromParsedPosition({ kind: match[2], volume: Number(match[3]), variable: match[4], wellName: match[5], method: match[6], adjustment: match[7] ? Number(match[7]) : 0, labwares, pipettes, lineNumber, codeLine: clean })
      if (result.event) steps.push(result.event)
      if (result.diagnostic) diagnostics.push(result.diagnostic)
      return
    }
    // Restricted single-line complex commands from the visual OT-2 composer.
    // These show well INTENT, not the actual Opentrons-expanded aspirate/refill/tip trace.
    const complex = clean.match(/^(\w+)\.(distribute|consolidate)\(\s*(\d+(?:\.\d+)?)\s*,\s*(.+)\)\s*$/)
    if (complex) {
      recognizedLines.add(lineNumber)
      const [, pipVar, method, rawVolume, args] = complex
      const matches = Array.from(args.matchAll(/(\w+)\s*\[\s*['"]([A-P](?:[1-9]|[1-4]\d))['"]\s*\]/g))
      const volume = Number(rawVolume)
      const pip = pipettes.get(pipVar)
      if (matches.length < 2 || !pip) {
        diagnostics.push({ level:'warn', text:`Line ${lineNumber}: ${method}() arguments/pipette could not be mapped. No robot actions were inferred.` })
        return
      }
      const fixed = method === 'distribute' ? matches[0] : matches[matches.length - 1]
      const changing = method === 'distribute' ? matches.slice(1) : matches.slice(0,-1)
      changing.forEach(w => {
        const src = method === 'distribute' ? fixed : w
        const dst = method === 'distribute' ? w : fixed
        for (const [kind, hit] of [['aspirate',src],['dispense',dst]]) {
          const result=eventFromParsedPosition({kind,volume,variable:hit[1],wellName:hit[2],method:'bottom',adjustment:1,labwares,pipettes:new Map([[pipVar,pip]]),lineNumber,codeLine:clean})
          if (result.event) {result.event.note = `Illustrative target from ${method}() line ${lineNumber}; actual liquid-class-independent OT-2 complex commands can refill, batch tips and adjust moves. Run official simulation for precise sequence.`; steps.push(result.event)}
          if (result.diagnostic?.level==='warn')diagnostics.push(result.diagnostic)
        }
      })
      diagnostics.push({level:'warn',text:`Line ${lineNumber}: ${method}() target wells were visualized, but liquid refills, disposal volume, tip changes and command expansion are delegated to the official Opentrons API.`})
      return
    }
    match = clean.match(transferLiteral)
    if (match) {
      recognizedLines.add(lineNumber)
      const amount = Number(match[2])
      const pipette = primaryPipette
      const srcResult = eventFromParsedPosition({ kind: 'aspirate', volume: amount, variable: match[3], wellName: match[4], method: 'bottom', adjustment: 1, labwares, pipettes, lineNumber, codeLine: clean })
      const dstResult = eventFromParsedPosition({ kind: 'dispense', volume: amount, variable: match[5], wellName: match[6], method: 'bottom', adjustment: 1, labwares, pipettes, lineNumber, codeLine: clean })
      if (srcResult.event) steps.push(srcResult.event)
      if (dstResult.event) steps.push(dstResult.event)
      diagnostics.push({ level: 'warn', text: `Line ${lineNumber}: simple transfer shorthand was interpreted as a nominal aspirate + dispense at 1 mm above each well bottom. Blow-out, touch-tip, air-gap, new-tip and other transfer options are not expanded.` })
      return
    }
    if (/^\w+\.(aspirate|dispense|transfer|pick_up_tip|drop_tip)\(/.test(clean)) {
      diagnostics.push({ level: 'warn', text: `Line ${lineNumber}: pipette operation was not in the supported literal subset; its exact tip target was not simulated.` })
      return
    }
    if (/^(for|while|if|elif|else:|try:|except|with |def |class )/.test(clean) && !/^def run\b/.test(clean)) {
      diagnostics.push({ level: 'warn', text: `Line ${lineNumber}: control flow or a custom function is present. It is not executed or expanded, so the plotted event list may be incomplete.` })
      return
    }
    if (/\.move_to\(|\.mix\(|\.touch_tip\(|\.blow_out\(|\.air_gap\(|\.dispense\(|\.aspirate\(/.test(clean)) {
      diagnostics.push({ level: 'warn', text: `Line ${lineNumber}: an operation or position expression is outside the browser visualiser's supported parser.` })
      return
    }
  })
  if (recognizedLines.size) diagnostics.push({ level: 'pass', text: `Mapped ${steps.length} displayed event(s) from ${recognizedLines.size} recognised command line(s).` })
  for (const step of steps.filter(item => item.kind === 'aspirate' || item.kind === 'dispense')) {
    const pipetteInfo = PIPETTES[step.pipetteModel]
    if (pipetteInfo && step.volume != null && (step.volume < pipetteInfo.min || step.volume > pipetteInfo.max)) {
      diagnostics.push({ level: 'warn', text: `Transfer volume ${step.volume} µL on line-derived event is outside the teaching preset range ${pipetteInfo.min}–${pipetteInfo.max} µL for ${pipetteInfo.label}. Confirm the actual pipette specification.` })
    }
    if (step.point?.well?.totalLiquidVolume && step.volume != null && step.volume > step.point.well.totalLiquidVolume) {
      diagnostics.push({ level: 'warn', text: `${step.kind} volume ${step.volume} µL exceeds the defined ${step.point.well.totalLiquidVolume} µL capacity of ${step.labwareName} ${step.well}.` })
    }
  }
  const mountCounts = new Map()
  for (const pipette of pipettes.values()) mountCounts.set(pipette.mount, (mountCounts.get(pipette.mount) || 0) + 1)
  for (const [mount, count] of mountCounts.entries()) {
    if (count > 1) diagnostics.push({ level: 'warn', text: `More than one pipette is declared on the ${mount} mount. Mount replacement or instrument-switching assumptions are not modelled by this visualiser.` })
  }
  if (!steps.some(step => ['aspirate', 'dispense'].includes(step.kind))) diagnostics.push({ level: 'warn', text: 'No supported explicit liquid-movement commands were mapped. Use literal well references or generate a protocol from the builder to see a coordinate trace.' })
  if (/(\bfor\b|\bwhile\b|\bexec\s*\(|\beval\s*\()/i.test(code)) diagnostics.push({ level: 'warn', text: 'This file contains loops or dynamic execution constructs; the browser does not execute Python. The event trace is not a full expansion of the program.' })
  if (/protocol\.load_module\(|load_module\(/.test(code)) diagnostics.push({ level: 'warn', text: 'Module loading is not simulated. Module offsets, labware stacks, and module-specific geometry are outside this version.' })
  if (!steps.length) diagnostics.push({ level: 'warn', text: 'No position trace could be built. This does not prove the script is invalid; it means its commands fall outside the supported visual subset.' })
  if (diagnostics.length === 0) diagnostics.push({ level: 'pass', text: 'No issues were found in the supported subset.' })
  return { diagnostics, steps, labwares, pipettes }
}

function analyseCurrentCode() {
  const code = $('codeEditor').value
  const result = analyseScript(code)
  currentSteps = result.steps
  activeStepIndex = 0
  viewerSource = 'inspect'
  previewStale = false
  previewFailed = false
  builderEditorStale = false
  inspectEditorStale = false
  lastInspectedCode = code
  const robotMatch = code.match(/["']robotType["']\s*:\s*["'](OT-2|Flex)["']/)
  const apiMatch = code.match(/["']apiLevel["']\s*:\s*["']([0-9.]+)["']/)
  const pipes = Array.from(result.pipettes.values())
  const labs = Array.from(result.labwares.values())
  inspectedStats = {
    protocolName: (code.match(/["']protocolName["']\s*:\s*["']([^"']+)["']/) || [])[1] || 'Uploaded / edited Python protocol',
    robotType: robotMatch?.[1] || 'Robot unconfirmed', apiLevel: apiMatch?.[1] || null,
    eventCount: result.steps.length, labwareCount: labs.length, pipetteCount: pipes.length,
    pipetteSummary: pipes.length ? pipes.map(p => `${p.model} · ${p.mount}`).join('; ') : 'Not detected',
    labwareSummary: labs.length ? labs.slice(0, 2).map(l => `S${l.slot} ${l.loadName}`).join(' → ') : 'Not mapped',
    rawPipettes: pipes.map(p => ({ model: p.model, mount: p.mount, channels: p.channels })),
    rawLabwares: labs.map(l => ({ loadName: l.loadName, slot: Number(l.slot) })),
  }
  updateTimelineAndView()
  const hasErrors = result.diagnostics.some(item => item.level === 'error')
  const hasWarnings = result.diagnostics.some(item => item.level === 'warn')
  setDiagnostics(result.diagnostics, hasErrors || hasWarnings ? 'warn' : 'ready', hasErrors ? 'Static inspection found blocking concerns' : hasWarnings ? 'Partial analysis — review warnings' : 'Supported subset inspected', `${result.steps.length} visual event(s) mapped. This remains a static browser inspection, not official protocol execution.`)
  $('codeTitle').textContent = activeMode === 'inspect' ? 'Uploaded / edited Python protocol' : 'Inspected Python protocol'
  $('codeState').textContent = 'Static inspection only'
  updateCodeMeta()
  updateProtocolOverview()
}

function switchMode(mode) {
  activeMode = mode
  if ($('downloadCode')) $('downloadCode').disabled = mode === 'build' && !!externalPlan?.errors?.length
  $('modeBuild').classList.toggle('active', mode === 'build')
  $('modeInspect').classList.toggle('active', mode === 'inspect')
  $('modeBuild').setAttribute('aria-selected', String(mode === 'build'))
  $('modeInspect').setAttribute('aria-selected', String(mode === 'inspect'))
  $('builderMode').classList.toggle('hidden', mode !== 'build')
  $('inspectIntake').classList.toggle('hidden', mode !== 'inspect')
  $('codeTitle').textContent = mode === 'build' ? 'Generated OT-2 Python protocol' : 'Uploaded / edited Python protocol'
  $('codeState').textContent = mode === 'build' ? 'Generated template · editable' : 'Static inspection only'
  if (mode === 'inspect') {
    viewerSource = 'inspectPending'
    inspectEditorStale = false
    previewStale = true
    updateProtocolOverview()
  } else {
    // Returning to the builder re-generates the preview from the current visible form.
    buildProtocol()
  }
}
function downloadFile(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function fileSafeName(text) {
  return (text || 'lifefabs-ot2-protocol').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'lifefabs-ot2-protocol'
}

function resetBuilder() {
  $('builderForm').reset()
  composerStyle = 'sequence'
  sequenceActions = []
  $('sequenceList').innerHTML = ''
  setComposerStyle('sequence')
  customDefs = []
  populateLabwareSelects()
  populateSlotSelects()
  populateWellSelectors(false)
  $('customDefStatus').textContent = 'No custom labware loaded. Use one of the bundled, source-linked definitions.'
  $('customDefStatus').classList.remove('disabled-note')
  $('formError').classList.remove('show')
  $('formError').textContent = ''
  buildProtocol()
}

function attachEvents() {
  $('builderForm').addEventListener('submit', event => { event.preventDefault(); buildProtocol() })
  $('builderForm').addEventListener('input', () => { markPreviewStale(); scheduleBuild() })
  $('builderForm').addEventListener('change', () => { markPreviewStale(); scheduleBuild() })
  $('syncHardwareSettings').addEventListener('click', syncHardwarePipetteToBuilder)
  window.addEventListener('lifefabs:hardware-layout-changed', event => {
    hardwareLayout = event.detail || { placed_modules: [], mounted_pipettes: [] }
    if (!window.lifefabsV4Active) autoSyncMountedPipette()
    updateProtocolOverview()
    if (activeView === '2d' || activeView === '3d') updateVisualMode()
  })
  // The gallery can publish its initial layout before this async module finishes
  // loading labware definitions. Read its cached snapshot to avoid missing it.
  if (window.lifefabsHardwareLayout) {
    hardwareLayout = window.lifefabsHardwareLayout
    if (!window.lifefabsV4Active) autoSyncMountedPipette()
    updateProtocolOverview()
    if (activeView === '2d' || activeView === '3d') updateVisualMode()
  }
  attachSequenceEvents()
  $('modeBuild').addEventListener('click', () => switchMode('build'))
  $('modeInspect').addEventListener('click', () => switchMode('inspect'))
  $('pipetteModel').addEventListener('change', () => populateWellSelectors(true))
  $('targetMode').addEventListener('change', () => { $('wellClearance').disabled = $('targetMode').value !== 'bottom'; $('wellClearanceHelp').textContent = $('targetMode').value === 'bottom' ? 'Height above the well bottom; 1–10 mm in this builder.' : 'Only used when the target reference is well bottom.' })
  $('generateBtn').addEventListener('click', buildProtocol)
  $('resetBtn').addEventListener('click', event => { event.preventDefault(); resetBuilder() })
  $('labwareDefFile').addEventListener('change', event => { if (event.target.files?.[0]) addCustomLabwareFromFile(event.target.files[0]) })
  all('[data-view]').forEach(button => button.addEventListener('click', () => { activeView = button.dataset.view; updateVisualMode() }))
  $('stepSlider').addEventListener('input', event => { activeStepIndex = Number(event.target.value); updateTimelineAndView() })
  $('prevStep').addEventListener('click', () => { activeStepIndex = Math.max(0, activeStepIndex - 1); updateTimelineAndView() })
  $('nextStep').addEventListener('click', () => { activeStepIndex = Math.max(0, Math.min(currentSteps.length - 1, activeStepIndex + 1)); updateTimelineAndView() })
  $('codeEditor').addEventListener('input', () => {
    updateCodeMeta()
    const code = $('codeEditor').value
    if (viewerSource === 'inspect') {
      inspectEditorStale = code !== lastInspectedCode
      previewStale = inspectEditorStale
      updateProtocolOverview()
    } else if (viewerSource === 'builder') {
      builderEditorStale = code !== lastGeneratedCode
      previewStale = builderFormStale || builderEditorStale
      previewFailed = false
      updateProtocolOverview()
    }
  })
  $('analyzeCode').addEventListener('click', analyseCurrentCode)
  $('copyCode').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('codeEditor').value)
      $('copyCode').textContent = 'Copied ✓'
      window.setTimeout(() => { $('copyCode').textContent = 'Copy' }, 1500)
    } catch {
      $('codeEditor').focus(); $('codeEditor').select()
      $('copyCode').textContent = 'Select + copy'
    }
  })
  $('downloadCode').addEventListener('click', () => {
    const name = fileSafeName(generatedConfig?.protocolName || 'lifefabs-ot2-protocol')
    downloadFile(`${name}.py`, $('codeEditor').value, 'text/x-python;charset=utf-8')
  })
  $('pythonFile').addEventListener('change', event => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      $('codeEditor').value = String(reader.result || '')
      $('codeState').textContent = `Loaded ${file.name} · analyse to inspect`
      updateCodeMeta()
      analyseCurrentCode()
    }
    reader.readAsText(file)
  })
  $('loadExample').addEventListener('click', () => {
    switchMode('inspect')
    $('codeEditor').value = makeProtocolExample()
    $('codeState').textContent = 'Sample script · edit and analyse'
    updateCodeMeta()
    analyseCurrentCode()
  })
  $('showChecks').addEventListener('click', () => $('checksExplainer').classList.toggle('hidden'))
  $('codeEditor').addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); analyseCurrentCode() }
    if (event.key === 'Tab') {
      event.preventDefault()
      const start = event.target.selectionStart
      const end = event.target.selectionEnd
      event.target.setRangeText('    ', start, end, 'end')
      updateCodeMeta()
    }
  })
  window.addEventListener('resize', () => { if (activeView !== 'cad') updateVisualMode(); else cadViewer?.resize() })
}

function makeProtocolExample() {
  return `from opentrons import protocol_api\n\nmetadata = {\n    "protocolName": "LifeFabs inspection example",\n    "author": "LifeFabs educational template",\n    "description": "A minimal explicit transfer for static inspection.",\n}\n\nrequirements = {"robotType": "OT-2", "apiLevel": "2.15"}\n\ndef run(protocol: protocol_api.ProtocolContext):\n    source_plate = protocol.load_labware("nest_96_wellplate_200ul_flat", "1")\n    destination_plate = protocol.load_labware("opentrons_96_wellplate_200ul_pcr_full_skirt", "2")\n    tip_rack = protocol.load_labware("opentrons_96_tiprack_300ul", "3")\n    pipette = protocol.load_instrument("p300_single_gen2", mount="right", tip_racks=[tip_rack])\n\n    pipette.pick_up_tip(tip_rack["A1"])\n    pipette.aspirate(50, source_plate["A1"].bottom(z=1))\n    pipette.dispense(50, destination_plate["A1"].bottom(z=1))\n    pipette.drop_tip()\n`
}

async function init() {
  await loadDefinitions()
  populateLabwareSelects()
  populateSlotSelects()
  populateWellSelectors(false)
  $('wellClearance').disabled = $('targetMode').value !== 'bottom'
  $('wellClearanceHelp').textContent = 'Height above the well bottom; 1–10 mm in this builder.'
  $('codeEditor').value = makeProtocolExample()
  setComposerStyle('sequence')
  attachEvents()
  buildProtocol()
  $('codeState').textContent = 'Generated template · editable'
  window.lifefabsCore = {
    getDefinition, targetPosition, makeEvent, updateTimelineAndView, updateProtocolOverview, setDiagnostics,
    registerLabwareDefinition(d) { if (!d?.loadName || !d.wellGeometry) return; customDefs = customDefs.filter(x => x.loadName !== d.loadName); customDefs.push(d); },
    applyPlan(plan) {
      externalPlan = plan; generatedConfig = null; viewerSource = 'builder'
      previewStale = false; previewFailed = plan.errors.length > 0; builderEditorStale = false
      currentSteps = plan.steps; activeStepIndex = Math.max(0, Math.min(activeStepIndex, currentSteps.length - 1))
      $('downloadCode').disabled = plan.errors.length > 0
      if ($('codeApiLabel')) $('codeApiLabel').textContent = 'API v' + plan.apiLevel
      $('codeEditor').value = plan.errors.length ? '# Protocol not generated: resolve the hardware/block errors below.\n# ' + plan.errors.join('\n# ') + '\n' : plan.python
      lastGeneratedCode = $('codeEditor').value
      $('codeTitle').textContent = 'Python generated from placed hardware + visual blocks'
      $('codeState').textContent = plan.errors.length ? 'BLOCKED · correct configuration' : 'Live from hardware + blocks · editable copy'
      $('formError').classList.toggle('show', !!plan.errors.length)
      $('formError').textContent = plan.errors.join(' ')
      setDiagnostics(plan.errors.length ? plan.errors.map(text => ({level:'error',text})) : [
        { level:'pass', text:'Python loads exactly the pipettes, modules, labware and tip racks currently placed in Section 1.' },
        { level:'pass', text:plan.blocks.length + ' visual blocks compiled in order; no hidden form settings.' },
        { level:'warn', text:'Nominal visualization only: official API simulation, calibration and physical clearance checks still required.' }
      ], plan.errors.length ? 'warn' : 'ready', plan.errors.length ? 'Protocol blocked' : 'Live protocol generated', plan.errors.length ? 'Resolve highlighted issues; the deck still shows the current hardware.' : 'The map and generated Python use one hardware snapshot.')
      updateCodeMeta(); updateTimelineAndView(); updateProtocolOverview()
    },
    updateHardwareOnly(layout) { hardwareLayout = layout; if (!externalPlan) return; updateTimelineAndView(); updateProtocolOverview() },
    currentMode() { return activeMode }
  }
  window.dispatchEvent(new Event('lifefabs:core-ready'))
}

init().catch(error => {
  console.error(error)
  setDiagnostics([{ level: 'error', text: `Unable to initialise the workbench: ${error.message || String(error)}` }], 'warn', 'Initialisation error')
})
