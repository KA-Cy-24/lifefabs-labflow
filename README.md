# LifeFabs Fieldnotes (Labflow) — Laboratory Automation and Simulation Tools

LifeFabs Fieldnotes, or Lifefabs Labflow, is an open, browser-based collection of educational tools for laboratory automation, protocol design, and experimental simulation. It includes a hardware-linked Opentrons OT-2 protocol workbench and an interactive food-dye electrophoresis model. The platform is designed for teaching, exploratory planning, and collaborative review; it is not a substitute for validated instrument-control software or experimental calibration.

## Platform components

- `index.html` — homepage and course-module catalogue.
- `ot2.html` — OT-2 protocol builder, static code inspector, 2D deck view, isometric coordinate projection, step timeline, and rotatable view of the supplied STL reference model.
- `food-dyes.html` — six E-number colorants, interactive gel visualization, six mixture lanes, drift/diffusion model, and CSV export; not calibrated against measured dye mobility.
- `js/visual-composer-v4.js` + `styles-visual-flow.css` — **current** colored connected-block authoring model, placed labware state, live hardware-linked Python generation and timeline.
- `js/ot2.js` — deck renderer, coordinate visualization, Python static inspector, optional legacy helpers and v4 preview bridge.
- `js/instrument-gallery.js` + `styles-instrument-gallery.css` — mounted pipettes, deck modules, shared slot conflict handling, persistent hardware state and setup-code/JSON export including live labware placements.
- `data/opentrons-instruments.json` — structured catalogue of OT-2 Python API pipettes and modules, load names, API minimum versions, mount/deck placement metadata, and official docs links.
- `styles-composer.css` — legacy element styling and compact `(i)` help icons; new composer styles live in `styles-visual-flow.css`.
- `js/theme.js` + `styles-theme.css` — dark-first LifeFabs palette, bright-theme switch, logo swap, Consolas headings and Bahnschrift-first body typography.
- `js/official-sim-client.js` — optional client for the isolated Opentrons API simulation service.
- `simulation-service/` — optional FastAPI service + container sandbox that calls the official `opentrons.simulate.simulate()` entry point.
- `data/labware-presets.json` — compact geometry extracts from official Opentrons labware definition JSONs. Each entry links to its source definition.
- `examples/minimal_ot2_transfer.py` — small example protocol for code inspection.
- `assets/` — OT-2 quick-start documentation and a reference STL model.

## Theme and logos

The site defaults to a black/navy/white dark theme. The header toggle switches to a bright theme and remembers the preference in local storage. Headings use Consolas where available; body copy uses Bahnschrift with Segoe UI and Arial fallbacks if Bahnschrift is unavailable. The LifeFabs light mark appears on dark backgrounds and the navy mark on bright backgrounds.

## Optional Opentrons API simulation service

The front-end supports an optional local simulation service. GitHub Pages cannot execute Python protocols: use the service in `simulation-service/` to run protocol code with the published Opentrons Python API inside a container sandbox. The service uses `opentrons.simulate.simulate` and pins the runtime to API package 9.0.0 for OT-2 simulation compatibility. Newer simulator releases may change OT-2 compatibility; verify supported versions before changing the pinned runtime. The browser's existing static inspector remains a fast partial view; the official simulation provides full API execution semantics supported by the pinned simulator package, but it still does not certify physical collision safety or robot calibration.

Start steps and security limitations are documented in [`simulation-service/README.md`](simulation-service/README.md). The service binds to loopback by default and should not be exposed publicly as-is.

## Run locally

The OT-2 page loads a JSON file and the CAD viewer imports Three.js, so use HTTP rather than opening `index.html` directly from the filesystem.

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/>.

## Visual protocol composer and hardware synchronization

The primary protocol-authoring interface is a visual, block-based composer. A separate visual authoring model in `js/visual-composer-v4.js` generates the Build-mode Python and timeline directly from canonical hardware placements and colored action blocks. The older `builderForm` DOM is retained, hidden, only as a compatibility bridge for legacy code-inspection/viewer helpers; it is **not** a competing authoring source. Build mode uses the visual composer as its authoring source; compatibility code does not override its generated output.

The OT-2 workbench is organized into three linked sections:

1. **Hardware Configurator** — place pipettes on either gantry mount, place any supported plate/tip-rack preset into free deck slots, and drag/place supported modules. An initial demonstration configuration includes a P300 on the right and three labware placements (source S6, destination S2, 300-µL tip rack S3). Previously saved layouts are preserved, and resetting the gallery clears the configuration.
2. **OT-2 Deck Map** — the 2D/isometric SVG uses **the exact current placed labware and gallery modules**, not historical builder field values. A newly placed/moved/removed item redraws the map immediately. The event trace follows the most recent valid visual blocks; when a design is invalid, hardware remains visible but Python generation is blocked. The CAD/STL view remains only an uncalibrated mechanical reference.
3. **Visual Protocol Composer** — a Scratch-inspired palette, color-coded connected blocks, insertion targets and a selected-block parameter inspector. Click blocks to select, drag blocks/inserts to arrange order, or use keyboard-accessible Up/Down buttons. Available block types: self-contained transfer, pick-up tip, aspirate, dispense, mix, air gap, blow out, touch tip, move to well, drop tip, wait and operator pause. The **complete transfer** block generates four explicit robot commands. Each new complete-transfer block suggests the next available tip and well by default. Blocks can be duplicated/removed, workflows saved to JSON and reopened.

### Hardware-source-of-truth contract

- `js/instrument-gallery.js` owns mounted pipette IDs/API load names, gantry mounts, placed modules and module slot footprints; the new labware placement panel owns placed plates and tip racks. The composer does **not** hold its own pipette models, independently selected labware load names or unlinked deck-slot configuration.
- Every successful Build-mode regeneration emits **exactly the instruments, modules, labware and tip racks currently placed in Section 1**, followed by the configured block commands. The hardware setup excerpt and JSON export also include placed labware. Both sources are derived from the same front-end hardware snapshot.
- Changing a mounted pipette, deck module, labware, tip rack, block type/order/parameter or API version triggers synchronous regeneration and redraw. Removing required hardware or introducing a conflict prevents a downloadable-looking valid protocol from silently retaining obsolete Python; a blocking message replaces the generated source until corrected.
- Multiple mounted supported GEN2 pipettes, multiple plates and compatible tip racks may be declared in the same protocol. Each block explicitly chooses a mounted pipette and one of the placed targets. A `transfer` block uses one pickup/aspirate/dispense/drop cycle; individual blocks offer manual tip lifecycle and richer liquid-handling sequences.
- The block-based composer supports a documented subset of module operations and labware-on-module arrangements (see below). It does not support arbitrary Python control flow or unrestricted third-party device actuation. Incompatible or missing labware, stale pipettes, duplicated used tips, excessive volumes and some invalid step orders are flagged, but this is **not a general-purpose validated protocol compiler**.
- In **Inspect Python** mode, uploaded/edited Python remains untouched when gallery hardware changes. The physical deck overlay still follows Section 1, while the static event trace reflects the separately inspected code and may disagree with the displayed hardware; this is not a hardware-validating Python parser.

### Reference positions and safety

In the selected-block inspector, **Bottom + Z** specifies millimetres above the official labware-definition floor; **Top + Z** is a rim-relative offset (negative values below the rim); **Center** specifies the geometric well center. Tip selection uses a real placed tip rack and literal well/column addresses. Eight-channel pipettes select the A-row position of a column. `touch_tip` uses its documented radius fraction and rim-relative vertical offset. The browser reports *nominal requested tip-target points* from bundled well geometry plus an approximate nominal deck grid, **not calibrated OT-2 coordinates, carriage travel, tip pickup Z, liquid-level tracking, trajectory safety, collision clearance or a simulation of physical execution**.

The generated Python must still undergo official Opentrons App/API simulation for the intended robot/API version, followed by real-hardware checks and safe dry-run. The companion pinned Docker simulator was **not** end-to-end verified in this iteration.

### Validation and regression tests

- `python tests/validate_site.py` — checks static links, catalogues, HTML IDs, assets and referenced scripts; does **not** execute the editor.
- `python tests/test_visual_flow_v4.py` — Chromium/Playwright DOM interaction regression exercising section order, visible blocks, initial hardware-to-deck/code consistency, changing a source plate slot, adding a second transfer with fresh tip/well, editing volume, adding a module, and removing the mounted pipette to verify generation is blocked. Includes Python AST parsing and browser error capture.
- `node --check js/ot2.js js/instrument-gallery.js js/visual-composer-v4.js` (check separately per file) and `python -m compileall tests`.

Test harness injects bundled scripts and JSON into a browser document; it verifies interactions but not deployment over HTTP/CDN, full accessibility audit, official Docker simulation or calibrated instrument behavior.

## OT-2 instrument gallery

The catalogue in `data/opentrons-instruments.json` is a locally stored JSON snapshot based on official Opentrons documentation. It includes OT-2 GEN2 pipettes, legacy GEN1 pipettes, Temperature Module GEN1/GEN2, Magnetic Module GEN1/GEN2, Thermocycler GEN1/GEN2, and Heater-Shaker GEN1. Catalogue entries include exact Python API load names, the relevant `load_instrument()` or `load_module()` method, generation/lifecycle information, and deck placement data where documented.

The UI follows the physical distinction in Opentrons documentation: pipettes are attached to the left or right gantry mount; deck modules are placed in deck slots. Module items can be dragged from the plenum, moved to another compatible slot, or dropped into the recycle bin to remove them from the saved layout. The OT-2 fixed trash region is not a placeable deck slot. Layout state is stored in local storage. Use the `Download JSON` control to export the current layout, or `Download .py` to export the generated hardware setup excerpt.

The catalogue and drag/drop placement are a planning aid, not a final physical compatibility matrix. The gallery uses selected published OT-2 restrictions for the Heater-Shaker, Temperature Module GEN2 and Thermocycler footprint; the Magnetic Module exposes standard OT-2 slots in the visual model because the checked Python API setup page lists load names but does not publish a restrictive slot table. For every module, validate exact hardware generation, cable orientation, allowed labware, slot adjacency and the complete protocol using the official Opentrons analyser/simulator before physical execution. In particular, the Heater-Shaker has adjacent-slot, tall-labware and 8-channel movement restrictions, which the visual gallery only partially models.

Catalogue sources include [Python API — Loading Pipettes](https://docs.opentrons.com/python-api/pipettes/loading/), [Python API — Module Setup](https://docs.opentrons.com/python-api/modules/setup/), [OT-2 Modules](https://docs.opentrons.com/ot-2/modules/), [OT-2 Pipettes](https://docs.opentrons.com/ot-2/pipettes/), [Deck Slots](https://docs.opentrons.com/python-api/deck-slots/), [Heater-Shaker installation](https://docs.opentrons.com/heater-shaker/preinstall/), [Temperature Module installation](https://docs.opentrons.com/temperature-module/pre-installation/), and [Thermocycler installation](https://docs.opentrons.com/thermocycler/pre-installation/).

## Coordinate model and accuracy limits

The visualiser uses well-centre/bottom coordinates, dimensions, and well depths from the selected Opentrons labware definition. For those bundled definitions, well-relative geometry is drawn from the stored definition values. The top-down and isometric deck views use a **nominal slot-grid frame**, with slot 1 as the local origin; the slot pitches are a visualisation model, not a calibrated OT-2 transform.

The optional X/Y/Z origin fields add a user-supplied **translation only** to this nominal frame. They do not infer a transform from the STL and do not model rotation, the pipette mount/nozzle offset, tip-length calibration, deck calibration, labware offsets, gantry dynamics, collision checking, or transit paths. Tip pickup and fixed-trash coordinates are deliberately left to the Opentrons API rather than guessed. The STL is shown as a mechanical reference and is not registered to the deck coordinate frame.

For these reasons, the visualiser distinguishes local well coordinates from actual calibrated robot-space coordinates. Do not use browser coordinates as instructions for manually jogging a robot or for proving collision safety.

## Recommended validation before a physical run

1. Download the generated `.py` file.
2. Open it in the official Opentrons App and run protocol analysis/simulation for the intended OT-2 software/API version.
3. Confirm the physical pipette, tip rack, plate models, deck layout, and current deck/pipette/tip-length calibration.
4. Run a safe dry-run with the actual labware and volumes before using valuable samples or reagents.

Official resources:

- [Python API: labware and deck positions](https://docs.opentrons.com/python-api/robot-position/)
- [OT-2 robot calibration](https://docs.opentrons.com/ot-2/calibration/robot-calibration/)
- [OT-2 labware definitions](https://docs.opentrons.com/ot-2/labware/definitions/)
- [Official protocol simulation reference](https://docs.opentrons.com/python-api/reference/execute-simulate/)
- [Opentrons repository](https://github.com/Opentrons/opentrons)

The Opentrons source archive was consulted as reference material. The `protocol-visualization` package in that archive describes itself as a scaffold; the standalone visualization UI is not implemented there, so this site is a separate, limited teaching prototype rather than an integration of that package.


## OT-2 deck illustration

The homepage W02 illustration follows the slot arrangement shown in the OT-2 Quick Start Guide, page 5: slots 10/11 at the back, rows 7–9, 4–6, and 1–3 toward the front, plus the front handle marker. It is a plan-view schematic, not a scale-mechanical drawing.

## Implementation history and compatibility

Earlier guided-transfer and command-row implementations are retained for compatibility but are not the active Build-mode interface. The visual composer is implemented in `js/visual-composer-v4.js` plus `styles-visual-flow.css`.


## Extended labware and Python-to-visual mapping

- **Section 1 defines pipettes, tip racks, plates and non-tip labware**; all deck items assigned an official labware definition can be chosen as block liquid targets (tip racks remain pickup-only). Each placed item's identity and slot drive Python `load_labware()` and the live 2D deck map.
- **Official JSON labware import:** The Hardware Configurator accepts a user-provided Opentrons standard labware-definition JSON with `parameters`, `wells`, `ordering`, and `dimensions`. The importer deliberately accepts only *regular rectangular well grids* and derives pitch, origin and well dimensions directly from that definition. Unsupported or nonuniform designs are rejected, not approximated. Imported definitions persist in browser local storage; copy the original JSON when transferring between browsers. They are not distributed as bundled official definitions, and exact physical accuracy still depends on calibration and compatibility.
- **New visual blocks:** Distribute (one source → selected destination wells) and Consolidate (selected source wells → one destination) create OT-2 legacy `InstrumentContext.distribute()` and `.consolidate()` calls with `new_tip="once"`. The chosen well list supports cherry-picking noncontiguous positions. The API, not this simplified visualization, determines tip pickup/drop, refill, disposal volume, and exact movement sequence. Source/destination must be placed non-tip labware; matching tip racks are required.
- **Basic explicit transfer** retains explicit pickup → aspirate → dispense → drop and now offers an optional touch-tip operation after aspiration and dispensing. Advanced transfer parameters, cross-contamination policies, active volume tracking, liquid classes and module operations are **not** universally supported.
- **Python → visualizer already existed:** In *Inspect Python*, upload/paste code and click **Analyse code**. It statically detects literal labware/pipette loads, simple `.aspirate()`, `.dispense()`, `.transfer()`, tip operations, and now the v5 single-line literal `distribute()` and `consolidate()` forms. For complex commands, it shows intended well endpoints with warnings rather than falsely claiming to know the official simulator's expanded sequence. Arbitrary Python control flow, dynamic well selections and full liquid-class effects are not interpreted.
- **Crucial compatibility:** Per official Opentrons docs, verified liquid-class `*_with_liquid_class()` behavior is **Flex-specific** and errors on OT-2 pipettes/tips. No Flex liquid-class methods are generated for this OT-2 workbench. See https://docs.opentrons.com/python-api/liquid-classes/using/ , https://docs.opentrons.com/python-api/complex-commands/ , https://docs.opentrons.com/python-api/complex-commands/sources-destinations/ and https://docs.opentrons.com/python-api/labware/ .
- **Not implemented:** arbitrary adapters/holders as standalone deck objects, labware mounted on modules, module control sequences, nonuniform custom labware shapes, arbitrary Python-to-block round-tripping, collision checking and hardware-run validation. Modules remain visible and emitted as load statements, but not assumed to be operationally configurable through the visual blocks. Loading hardware does not itself imply physical compatibility.

Regression checks: `python tests/test_visual_flow_v4.py`, `python tests/test_v5_expansion.py`, `python tests/validate_site.py`; JavaScript with `node --check`. Docker-based official simulation and real-robot validation remain untested.


## Module operations, custom devices, and food-dye simulation

### Opentrons standard module blocks

The **Module / custom device** block in Section 3 refers to the exact *placed module instance* from Section 1, rather than a hard-coded Python variable. It updates when hardware changes. The supported standard families and actions are:

| Device | Generated actions | Notes |
|---|---|---|
| Heater-Shaker | close/open latch, set heater target, heat-and-wait, set-and-wait shake speed, stop shaker, stop heater | Shaking is 200–3000 rpm. Close latch before shaking. The heater cannot cool below ambient; adjacent deck/pipette restrictions require official checks. |
| Temperature Module | set temperature, start concurrent temperature (API ≥2.27), deactivate | Standard `TemperatureModuleContext` methods; host robot/hardware generation and API constraints apply. |
| Thermocycler | open/close lid, lid/block temperature, execute temperature/time profile, deactivate lid/block | Profiles use `temperature:holdSeconds` stages; validate the loaded plate, lid state, max sample volume, and module footprint. |
| Magnetic Module (OT-2) | engage with explicitly chosen height above labware base, disengage | The chosen height is not a computed bead-extraction recommendation. |
| External/custom deck device | operator handoff via `protocol.pause()` | Never emits an invented `load_module()` or untrusted external-device driver. |

The **Hardware Configurator** supports up to eight named operator action presets per custom device. Every preset appears as an independent option in the composer block inspector and produces a human-confirmed `protocol.pause()`, never an untrusted driver call. Custom device definitions can be exported to JSON and imported in another browser with schema validation and size limits; imports do not run executable Python or JavaScript.

The **Hardware Configurator** now lets users register simple custom deck peripherals with a display name, function description, allowed anchor slots and named manual actions. Registration persists in the browser and the device becomes a plannable deck occupant. `manual:*` is an **internal UI identifier**, not a valid Opentrons module load name. Custom modules have no direct Opentrons Python Protocol API support unless the device manufacturer or integrator provides a separately validated driver and integration interface. In this release their actuation is an explicit operator-controlled handoff, including human confirmation; there is **no automated external connection, microcontroller bus, firmware flashing, hardware discovery, or safety interlock**. Custom multi-slot geometry, full accessory dimensions and dynamic trajectories are not verified. Manual equipment needs physical clearance/power/electrical validation.

Standard supported modules can be selected as **parent mounts** for a plate/tip rack. In that case the composer generates `module.load_labware()` rather than `protocol.load_labware()` and the deck map labels the intentional stack instead of a deck-slot conflict. This does **not** prove the chosen combination is compatible. Module adapters are not yet modeled independently, and `.load_adapter()` is not generated. A labware stack must still be checked against the module's compatibility documentation. Labware-on-module well Z coordinates in the viewer are nominal; the added height of a physical module or adapter is not calibrated or applied.

Module methods are validated against the chosen module family and API level; invalid/missing hardware blocks generation. Existing `Inspect Python` remains a conservative static parser and does not fully reverse-compile module methods or dynamically constructed Python. **The OT-2 compatibility target remains pinned to the site's tested API subset; generated code has not been physically tested.** Official references:

- https://docs.opentrons.com/python-api/modules/setup/
- https://docs.opentrons.com/python-api/modules/heater-shaker/
- https://docs.opentrons.com/python-api/modules/temperature-module/
- https://docs.opentrons.com/python-api/modules/thermocycler/
- https://docs.opentrons.com/python-api/modules/magnetic-module/

### Food-dye electrophoresis: model assumptions and provenance

The `food-dyes.html` page provides a self-contained interactive application (no external JS/CDN). The bundled `data/food-dyes.json` contains defined colorant sodium salts: **E102** tartrazine, **E110** sunset yellow FCF, **E122** carmoisine/azorubine, **E124** Ponceau 4R, **E129** Allura Red AC, **E133** Brilliant Blue FCF. Names, chemical formulas, molar masses, and source links are sourced to PubChem compound records and E-number specifications; they **do not describe brand-specific recipes**, and mixtures selected in the app are hypothetical combinations.

- Experiment controls: applied voltage `V`, electrode gap `L`, gel usable distance (independent of electrode gap), agarose percentage, temperature, time, and a user-defined sieving factor multiplier.
- Each lane can include zero, one, or many compound dyes. Choose pure dye lanes or the demonstration mixtures. Time slider, play/pause/restart, live quantitative peak-distance table, clipped-gel warning, and CSV export are included.
- The **illustrative** drift model uses field `E=V/L` in V/m; effective electrophoretic mobility `μgel = μ0 exp(−k c s)` in m²/(V·s); signed charge is assumed anionic, so displacement toward the anode is `|μgel| E t`. `c` is agarose % w/v as a numeric percent, `k` the editable per-percent attenuation, and `s` the editable multiplier. All `μ0` and `k` values are **scenario assumptions**, not measured mobilities nor calculated from formula/mass. They must be experimentally calibrated to support quantitative claims.
- Band density is displayed as a Gaussian centered at drift distance, with `σ²=σ0²+2Dt`; initial `σ0=1.0 mm`, and illustrative Einstein relation `D≈|μgel|kB T/(|z| e)` (units of m²/s). This free-ion approximation neglects many ion–gel interactions; visual alpha/composite colors are illustrative. No buffer/pH/ionic strength, joule heating, electro-osmotic flow, field non-uniformity, changing conductivity, concentration-dependent effects, matrix sorption, chemical equilibria, or apparatus-specific calibration is modeled.
- No inference of direction/speed solely from molecular mass; the page clearly labels **not calibrated**. This is educational software, not an electrical hardware design or laboratory safety certification.

Compound references: https://pubchem.ncbi.nlm.nih.gov/compound/Tartrazine , https://pubchem.ncbi.nlm.nih.gov/compound/17730 , https://pubchem.ncbi.nlm.nih.gov/compound/19118 , https://pubchem.ncbi.nlm.nih.gov/compound/17466 , https://pubchem.ncbi.nlm.nih.gov/compound/33258 , https://pubchem.ncbi.nlm.nih.gov/compound/19700 . EU additive specifications: https://eur-lex.europa.eu/eli/reg/2012/231/oj .

### Validation and deployment limitations

- `python tests/validate_site.py`
- `python tests/test_visual_flow_v4.py`
- `python tests/test_v5_expansion.py`
- `python tests/test_v6_modules_dyes.py` — browser integration for standard and custom module blocks, module labware stacks, generator syntax, dye simulation and model input-response.
- `node --check js/*.js` (execute per file)

Browser tests use Chromium and injected source/JSON. These are **not equivalent** to an official Opentrons App/API analysis run, a Docker simulator trial, a peer-reviewed electrophoresis model calibration or a physical OT-2/hardware validation. Verify all physical device clearances, electrical interfaces, real labware geometry and actual reagent suitability before operating equipment.
