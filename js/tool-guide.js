/* Small, accessible contextual help for parameters and tools across LifeFabs pages. */
(() => {
  'use strict';

  const FIELD_HELP = {
    robotType: 'Select the robot model the generated protocol targets. This prototype generates OT-2 protocols only; Flex is intentionally disabled until its deck and instrument model are implemented.',
    apiLevel: 'This is the Opentrons Python API version written into the protocol header. It must be supported by the Opentrons software installed on the target robot. A higher API number does not make a protocol more accurate by itself.',
    pipetteModel: 'Choose the installed pipette model. The volume range, tip-rack definition, channel count and well iteration depend on this selection. Match it to the physical instrument.',
    mount: 'Choose the gantry mount holding this pipette. A supported pipette mounted in the gallery automatically updates the builder in Build mode. The manual sync button remains available.',
    targetMode: 'Choose the requested well reference for aspirate/dispense: bottom plus clearance, geometric centre, or well top. This is the API target reference, not a complete path or collision-free motion plan.',
    wellClearance: 'Vertical offset in millimetres above the well bottom when “Well bottom + clearance” is selected. This template restricts the value to 1–10 mm; verify it for the actual labware and liquid method.',
    sourceLabware: 'Choose the labware definition that holds the source liquid. The definition supplies the well geometry used by this visualiser and the load name written to Python.',
    sourceSlot: 'Choose the OT-2 deck slot containing the source labware. It must not be occupied by a module or reserved by a multi-slot module in the hardware gallery.',
    sourceStart: 'The first source well used by the generated transfer sequence. Single-channel transfers move through individual wells; an 8-channel pipette begins at row A and treats each transfer as a column.',
    destLabware: 'Choose the destination labware definition. The visualiser uses its well coordinates and dimensions; the generated protocol loads its API load name.',
    destSlot: 'Choose the deck slot containing the destination labware. The selected source, destination and tip-rack slots must be distinct in this starter template.',
    destStart: 'The first destination well. The generated sequence advances through the supported well order from this starting address.',
    tipSlot: 'The deck slot for the tip rack selected by the pipette preset. Confirm the physical rack type and available tips before running a protocol.',
    volume: 'Liquid volume for each transfer in microlitres. The builder checks the selected pipette preset and declared well capacities, but does not validate liquid properties or experimental suitability.',
    transferCount: 'Number of transfers for single-channel pipettes or number of columns for 8-channel pipettes. It affects the generated event sequence and consumes a new tip for each transfer/column in this template.',
    protocolName: 'Human-readable protocol name written into the generated Python metadata. It helps identify downloaded files and the active plan in the preview.',
    originX: 'Optional translation for the slot-1 front-left-bottom origin in a documented robot coordinate frame. Leave unset unless the transform is sourced and verified. Arbitrary numbers can create misleading absolute coordinates.',
    originY: 'Optional robot-frame Y translation for the slot-1 origin. If no verified transform is supplied, the viewer shows slot-1-relative nominal coordinates instead of claiming absolute robot coordinates.',
    originZ: 'Optional robot-frame Z translation for the slot-1 origin. Calibration, pipette offsets, tip length and labware offsets are not inferred from this field.',
    labwareDefFile: 'Load an Opentrons v2 labware definition JSON to inspect its well geometry in this browser. The same definition must also be available to the robot software; loading it here does not install it on the OT-2.',
    instrumentSearch: 'Search the local JSON instrument catalogue by name, API load name, family or generation. The catalogue is a curated teaching subset, not a guarantee that every item is supported by every robot/software version.',
    pythonFile: 'Upload a Python protocol for static browser inspection or the separate official simulation service. Browser inspection does not execute Python and cannot fully resolve loops, variables, helper functions or dynamic positions.',
    simServiceUrl: 'Base URL for the optional local service that runs the compatible Opentrons API simulator. A GitHub Pages-only site cannot execute Python on the server; use a trusted local service and do not expose it publicly without authentication and request limits.'
  };

  const TOOL_HELP = {
    modeBuild: 'Choose the guided batch recipe or editable command sequence. In Build mode, valid changes regenerate Python and the viewer automatically.',
    modeInspect: 'Paste or upload an existing Python protocol, then run static analysis or the optional official API simulator. The browser visualiser maps only a supported subset unless the official service is used.',
    generateBtn: 'Validate the form, generate Python and rebuild the event timeline. This is the action that synchronises the upper coordinate viewer with the current form values.',
    syncHardwareSettings: 'Manually synchronize a supported pipette and mount from the gallery. Supported mounted pipettes already auto-sync in Build mode. Neither method reads physical robot state.',
    resetBtn: 'Restore the builder defaults and regenerate the preview. The saved hardware gallery layout is not reset by this button.',
    visualTitle: 'This viewer displays the most recently generated builder plan or the most recently analysed script. The status card below this heading tells you whether builder edits have made that preview stale.',
    visual2d: 'Top-down schematic of the 11 OT-2 slots. The selected event endpoint is highlighted. Deck modules from the gallery are overlaid as planning markers, not to-scale 3D hardware.',
    visual3d: 'Isometric projection of nominal slot and well geometry. It is useful for explaining relative position, but is not a calibrated gantry model or collision simulator.',
    visualCad: 'Rotatable supplied STL reference model. The STL is not registered to the coordinate frame of the schematic and does not show the live protocol endpoint.',
    eventSlider: 'Move through the generated/analysed event list. The highlighted event updates the position marker, event description and coordinate fields.',
    previousEvent: 'Move to the previous event in the active protocol trace. It changes the visualised step only; it does not command a physical robot.',
    nextEvent: 'Move to the next event in the active protocol trace. It changes the visualised step only; it does not command a physical robot.',
    protocolName: 'The active protocol summary names the plan displayed by the viewer. “Preview current” means it matches the last successful build/analyse action—not that hardware calibration has been verified.',
    galleryTitle: 'The gallery is a proposed, not physically connected, hardware layout. Supported mounted pipettes automatically synchronize in Build mode. Modules appear immediately in the deck, add idle module-load declarations and flag conflicts. Labware-on-module and module operation commands still require user-written Python.',
    instrumentFilters: 'Filter the curated catalogue. Pipettes belong on the left/right gantry mounts; modules occupy deck slots and may reserve multiple slots.',
    quickPlace: 'Place this catalogue item in the first compatible available mount or slot. It applies the gallery placement constraints but does not certify the complete hardware setup.',
    resetGallery: 'Clear the proposed module and pipette layout in the gallery. This does not reset the protocol builder; review the active plan afterward.',
    copySetup: 'Copy a setup-code skeleton describing the currently placed pipettes and modules. It is not a complete transfer protocol and must be completed and validated.',
    downloadSetup: 'Download the current hardware-load skeleton as Python. The file describes the chosen layout only; it does not contain a complete, validated liquid-handling procedure.',
    downloadLayout: 'Download the gallery state as JSON so the proposed layout can be reviewed or retained with the lab plan.',
    recycleBin: 'Drag a placed pipette or module here to remove it from the proposed gallery layout. This only changes the visual plan; it does not remove hardware from a physical robot.',
    analyzeCode: 'Statically inspect explicit commands the browser recognises and map available events. This is not Python execution or proof that the protocol is valid.',
    loadExample: 'Load the supplied minimal example into the editor so you can inspect its well references, mounts and target expressions.',
    copyCode: 'Copy the current Python editor contents, including any edits you have made.',
    downloadCode: 'Download the current Python editor contents. Analyse it and run the compatible official API simulation before considering physical execution.',
    showChecks: 'Explain which checks are static browser checks and which require the official Opentrons analyser, simulator or real-hardware validation.',
    probeSimService: 'Test whether the configured optional simulation service responds. A reachable service is not by itself proof that a particular protocol is valid.',
    runOfficialSim: 'Submit the editor contents to the configured compatible Opentrons API simulator. Review all reported commands and errors; simulation still cannot verify calibration or wet-lab suitability.',
    clearOfficialSim: 'Clear the previous official-simulation output from the page.',
    searchCatalogue: 'Filter the instrument/module catalogue by model name, API load name or category.',
    robotSummary: 'Robot model and API level associated with the active generated template or inspected script. In inspect mode, the parser reports only literal header values it can recognise.',
    pipetteSummary: 'Selected or parsed pipette model and mount. In builder mode this comes from the last generated plan; in inspect mode it comes from literal load_instrument declarations.',
    transferSummary: 'Volume multiplied by transfer count in the builder, or number of mapped visual events in inspect mode. Neither count implies that the robot has executed them.',
    labwareSummary: 'Source and destination labware/slots for the builder, or the first literal labware declarations found in inspected code. Module footprints are overlaid for conflict review.',
    targetSummary: 'Requested API target reference for builder aspirate/dispense commands. The displayed position is a nominal well target, not a calibrated pipette carriage position.',
    legend: 'Legend for source, destination, tip rack, fixed trash and active endpoint. Gallery module footprints may be overlaid in the deck view; red outlines indicate a detected slot overlap.',
    leftMount: 'The left gantry mount holds a supported pipette. It is not a deck slot. Only one pipette may occupy each mount in this model.',
    rightMount: 'The right gantry mount holds a supported pipette. It is not a deck slot. Only one pipette may occupy each mount in this model.',
    deckGrid: 'Top-down OT-2 deck placement planner. Drag modules into compatible slots or select a catalogue item and click a slot. Reserved multi-slot footprints are shown, but the gallery does not simulate all cable, height or collision constraints.',
    moduleHeading: 'Modules mount on the deck and can reserve one or multiple slots. A module footprint that overlaps a transfer labware slot makes this starter protocol incompatible.',
    pipetteHeading: 'Pipettes attach to gantry mounts. The selected pipette in the transfer builder must match the physical/gallery pipette before its code is considered for use.',
    officialSim: 'This optional service runs the Opentrons Python API simulator in a separate environment. It is more authoritative than static browser parsing, but does not establish that physical calibration or protocol assumptions are correct.',
    themeToggle: 'Switch between the default dark navy/black theme and the bright theme. This changes appearance only; it does not change protocol settings or simulation results.'
  };

  const SELECTOR_HELP = [
    ['[data-theme-toggle]', TOOL_HELP.themeToggle],
    ['#modeBuild', TOOL_HELP.modeBuild], ['#modeInspect', TOOL_HELP.modeInspect],
    ['#generateBtn', TOOL_HELP.generateBtn], ['#resetBtn', TOOL_HELP.resetBtn], ['#syncHardwareSettings', TOOL_HELP.syncHardwareSettings],
    ['[data-view="2d"]', TOOL_HELP.visual2d], ['[data-view="3d"]', TOOL_HELP.visual3d], ['[data-view="cad"]', TOOL_HELP.visualCad],
    ['#prevStep', TOOL_HELP.previousEvent], ['#nextStep', TOOL_HELP.nextEvent],
    ['#resetInstrumentLayout', TOOL_HELP.resetGallery], ['#copyInstrumentSetup', TOOL_HELP.copySetup],
    ['#downloadInstrumentSetup', TOOL_HELP.downloadSetup], ['#downloadInstrumentLayout', TOOL_HELP.downloadLayout],
    ['#analyzeCode', TOOL_HELP.analyzeCode], ['#loadExample', TOOL_HELP.loadExample], ['#copyCode', TOOL_HELP.copyCode],
    ['#downloadCode', TOOL_HELP.downloadCode], ['#showChecks', TOOL_HELP.showChecks], ['#probeSimService', TOOL_HELP.probeSimService],
    ['#runOfficialSim', TOOL_HELP.runOfficialSim], ['#clearOfficialSim', TOOL_HELP.clearOfficialSim]
  ];

  function makeIcon(helpText, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `info-i ${extraClass}`.trim();
    button.textContent = 'i';
    button.dataset.help = helpText;
    button.title = helpText;
    button.setAttribute('aria-label', `Help: ${helpText}`);
    button.setAttribute('aria-expanded', 'false');
    return button;
  }

  function insertAfter(node, newNode) {
    if (node?.parentNode) node.parentNode.insertBefore(newNode, node.nextSibling);
  }

  function addToFieldLabel(label, helpText) {
    if (label.dataset.helpAdded === 'true') return;
    const parent = label.parentElement;
    if (!parent) return;
    const row = document.createElement('div');
    row.className = 'field-label-row';
    parent.insertBefore(row, label);
    row.append(label, makeIcon(helpText));
    label.dataset.helpAdded = 'true';
  }

  function addToHeading(node, helpText, beforeSelector = null) {
    if (!node || node.dataset.helpAdded === 'true') return;
    const icon = makeIcon(helpText);
    if (beforeSelector) {
      const before = node.querySelector(beforeSelector);
      if (before) node.insertBefore(icon, before);
      else node.append(icon);
    } else {
      node.append(icon);
    }
    node.dataset.helpAdded = 'true';
  }

  function wrapHeading(heading, helpText, extraClass = '') {
    if (!heading || heading.dataset.helpAdded === 'true' || !heading.parentElement) return;
    const wrapper = document.createElement('div');
    wrapper.className = `heading-help-row ${extraClass}`.trim();
    heading.parentElement.insertBefore(wrapper, heading);
    wrapper.append(heading, makeIcon(helpText));
    heading.dataset.helpAdded = 'true';
  }

  function wrapButton(button, helpText) {
    if (!button || button.dataset.helpAdded === 'true' || !button.parentElement) return;
    const wrapper = document.createElement('span');
    wrapper.className = 'tool-help-wrap';
    button.parentNode.insertBefore(wrapper, button);
    wrapper.append(button, makeIcon(helpText));
    button.dataset.helpAdded = 'true';
  }

  function init() {
    document.querySelectorAll('label[for]').forEach(label => {
      const id = label.htmlFor;
      if (FIELD_HELP[id]) addToFieldLabel(label, FIELD_HELP[id]);
    });

    document.querySelectorAll('.form-section-title').forEach(heading => {
      const text = heading.childNodes[0]?.textContent?.trim() || heading.textContent.trim();
      const help = text.startsWith('Robot + pipette') ? 'Robot and pipette settings define the protocol target, instrument model, mount and location reference.'
        : text.startsWith('Labware + deck') ? 'Select the source/destination labware definitions and slot positions. The protocol viewer marks these slots; the hardware gallery can report module conflicts.'
          : text.startsWith('Transfer design') ? 'These values define liquid volume, transfer count and the name used in the generated protocol.'
            : text.startsWith('Coordinate frame') ? 'The default drawing uses a nominal slot-1-relative frame. Enter absolute origin offsets only when you have a documented transform; the page does not calibrate the robot.' : null;
      if (help) addToHeading(heading, help, 'span');
    });

    const headingHelp = [
      ['#visualTitle', TOOL_HELP.visualTitle], ['#activeProtocolName', TOOL_HELP.protocolName], ['#instrumentGalleryTitle', TOOL_HELP.galleryTitle],
      ['#codeTitle', 'The editor title and status identify whether this code was generated by the builder, loaded from a file, or edited by you.'],
      ['#analysisTitle', 'This panel reports checks completed on the current editor contents. Warnings indicate limits of the supported static inspection.'],
      ['#officialSimTitle', TOOL_HELP.officialSim]
    ];
    headingHelp.forEach(([selector, help]) => {
      const heading = document.querySelector(selector);
      if (heading && heading.dataset.helpAdded !== 'true') wrapHeading(heading, help);
    });

    document.querySelectorAll('.deck-section-heading h3').forEach((heading, index) => {
      addToHeading(heading, index === 0 ? TOOL_HELP.pipetteHeading : TOOL_HELP.moduleHeading);
    });
    document.querySelectorAll('.target-card .label').forEach(node => addToHeading(node, 'The event name and note describe the requested API target for the selected timeline step. It is not the robot motor position or an executed movement log.'));
    document.querySelectorAll('.coordinate-card .label').forEach(node => addToHeading(node, 'Coordinates are well-relative plus the displayed nominal slot transform. Without verified calibration and instrument offsets, they are not guaranteed absolute robot-space positions.'));
    document.querySelectorAll('.instrument-palette-head h3').forEach(node => addToHeading(node, 'Browse the supported teaching catalogue. Drag a pipette to a gantry mount or a module to a compatible deck slot.'));
    document.querySelectorAll('.instrument-filter-row').forEach(node => {
      if (!node.querySelector('.info-i')) node.append(makeIcon(TOOL_HELP.instrumentFilters));
    });
    const summaryHelp = [
      ['#summaryRobot', TOOL_HELP.robotSummary], ['#summaryPipette', TOOL_HELP.pipetteSummary],
      ['#summaryTransfers', TOOL_HELP.transferSummary], ['#summaryLabware', TOOL_HELP.labwareSummary],
      ['#summaryTarget', TOOL_HELP.targetSummary]
    ];
    summaryHelp.forEach(([selector, help]) => {
      const value = document.querySelector(selector);
      const label = value?.previousElementSibling;
      if (label && !label.querySelector('.info-i')) label.append(makeIcon(help));
    });
    const legend = document.querySelector('.legend-row');
    if (legend && !legend.querySelector('.info-i')) legend.append(makeIcon(TOOL_HELP.legend));
    const searchLabel = document.querySelector('label[for="instrumentSearch"]');
    if (searchLabel && searchLabel.dataset.helpAdded !== 'true') addToFieldLabel(searchLabel, TOOL_HELP.searchCatalogue);
    document.querySelectorAll('.mount-dropzone[data-drop-mount="left"]').forEach(node => {
      const heading = node.querySelector('.mount-label'); if (heading && !heading.querySelector('.info-i')) heading.append(makeIcon(TOOL_HELP.leftMount));
    });
    document.querySelectorAll('.mount-dropzone[data-drop-mount="right"]').forEach(node => {
      const heading = node.querySelector('.mount-label'); if (heading && !heading.querySelector('.info-i')) heading.append(makeIcon(TOOL_HELP.rightMount));
    });
    const deckHeading = document.querySelector('.instrument-deck-section .deck-section-heading h3');
    if (deckHeading && deckHeading.dataset.helpAdded !== 'true') addToHeading(deckHeading, TOOL_HELP.deckGrid);
    const recycle = document.querySelector('#instrumentRecycleBin strong');
    if (recycle && !recycle.querySelector('.info-i')) recycle.append(makeIcon(TOOL_HELP.recycleBin));

    SELECTOR_HELP.forEach(([selector, help]) => document.querySelectorAll(selector).forEach(button => wrapButton(button, help)));
    const sliderHead = document.querySelector('.range-head');
    if (sliderHead && !sliderHead.querySelector('.info-i')) sliderHead.append(makeIcon(TOOL_HELP.eventSlider));
    const statusBadge = document.querySelector('#protocolSyncBadge');
    if (statusBadge && !statusBadge.dataset.helpAdded) {
      const wrapper = document.createElement('span');
      wrapper.className = 'protocol-status-help';
      statusBadge.parentElement.insertBefore(wrapper, statusBadge);
      wrapper.append(statusBadge, makeIcon('Status meanings: PREVIEW CURRENT = the viewer follows the last successful builder generation; PREVIEW STALE = form values or editor contents differ; STATIC INSPECTION = viewer follows the last browser-parsed script; ANALYSE TO SYNC = inspect mode was selected but analysis has not run; HARDWARE REVIEW = a detected mismatch needs attention. None of these labels confirms physical calibration or execution.'));
      statusBadge.dataset.helpAdded = 'true';
    }
    const hardwareTitle = document.querySelector('#hardwareLinkTitle');
    if (hardwareTitle && !hardwareTitle.dataset.helpAdded) {
      wrapHeading(hardwareTitle, 'This review compares the current builder plan or parsed script declarations against the separate gallery layout. Module slot overlaps and pipette mount/model mismatches are reported when the current static view can detect them. It is not a live hardware connection.', 'hardware-title-help-row');
    }
    const galleryHead = document.querySelector('.instrument-gallery-head');
    if (galleryHead && !galleryHead.querySelector('.info-i')) galleryHead.append(makeIcon('A supported gallery pipette automatically synchronizes with the Build composer. Module footprints appear immediately in the viewer, but module API commands are not generated automatically.'));
  }

  let tooltip = null;
  let activeHelpButton = null;
  let pinnedHelpButton = null;

  function ensureTooltip() {
    if (tooltip) return tooltip;
    tooltip = document.createElement('div');
    tooltip.id = 'lifeFabsHelpTooltip';
    tooltip.className = 'help-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    document.body.append(tooltip);
    return tooltip;
  }

  function hideTooltip(button = null) {
    if (button && activeHelpButton !== button) return;
    if (activeHelpButton) {
      activeHelpButton.removeAttribute('aria-describedby');
      if (activeHelpButton !== pinnedHelpButton) activeHelpButton.setAttribute('aria-expanded', 'false');
    }
    activeHelpButton = null;
    if (tooltip) tooltip.hidden = true;
  }

  function showTooltip(button, pin = false) {
    if (!button) return;
    if (pinnedHelpButton && pinnedHelpButton !== button && !pin) return;
    if (pin) pinnedHelpButton = button;
    const tip = ensureTooltip();
    activeHelpButton = button;
    tip.textContent = button.dataset.help || button.title || 'No help available.';
    tip.hidden = false;
    button.setAttribute('aria-describedby', tip.id);
    if (pin) button.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      if (!activeHelpButton || tip.hidden) return;
      const rect = activeHelpButton.getBoundingClientRect();
      const margin = 12;
      const width = Math.min(340, window.innerWidth - margin * 2);
      tip.style.width = `${width}px`;
      const tipRect = tip.getBoundingClientRect();
      let left = rect.left;
      if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
      left = Math.max(margin, left);
      let top = rect.bottom + 8;
      if (top + tipRect.height > window.innerHeight - margin) top = rect.top - tipRect.height - 8;
      top = Math.max(margin, Math.min(top, window.innerHeight - tipRect.height - margin));
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    });
  }

  document.addEventListener('pointerover', event => {
    const button = event.target.closest?.('.info-i');
    if (button && !pinnedHelpButton) showTooltip(button, false);
  });
  document.addEventListener('pointerout', event => {
    const button = event.target.closest?.('.info-i');
    if (button && !pinnedHelpButton && !button.contains(event.relatedTarget)) hideTooltip(button);
  });
  document.addEventListener('focusin', event => {
    const button = event.target.closest?.('.info-i');
    if (button && !pinnedHelpButton) showTooltip(button, false);
  });
  document.addEventListener('focusout', event => {
    const button = event.target.closest?.('.info-i');
    if (button && !pinnedHelpButton && !button.contains(event.relatedTarget)) hideTooltip(button);
  });
  document.addEventListener('click', event => {
    const clicked = event.target.closest?.('.info-i');
    if (!clicked) {
      if (pinnedHelpButton) {
        pinnedHelpButton.setAttribute('aria-expanded', 'false');
        const old = pinnedHelpButton;
        pinnedHelpButton = null;
        hideTooltip(old);
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (pinnedHelpButton === clicked) {
      clicked.setAttribute('aria-expanded', 'false');
      pinnedHelpButton = null;
      hideTooltip(clicked);
    } else {
      if (pinnedHelpButton) pinnedHelpButton.setAttribute('aria-expanded', 'false');
      pinnedHelpButton = null;
      hideTooltip();
      showTooltip(clicked, true);
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && pinnedHelpButton) {
      const old = pinnedHelpButton;
      pinnedHelpButton = null;
      old.setAttribute('aria-expanded', 'false');
      hideTooltip(old);
    }
  });
  window.addEventListener('resize', () => { if (activeHelpButton && tooltip && !tooltip.hidden) showTooltip(activeHelpButton, Boolean(pinnedHelpButton)); });

  document.addEventListener('DOMContentLoaded', init);
})();
