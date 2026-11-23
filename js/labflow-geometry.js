/* Pure geometry helpers; usable in the browser and Node tests. */
(function (root) {
  'use strict';
  const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const positive = n => finite(n) && n > 0;
  function normalize(raw) {
    assert(raw?.schemaVersion === 2 && Number.isInteger(raw.version) && raw.version > 0, 'Expected a schema-v2 definition with a positive revision.');
    const p = raw.parameters, d = {x:raw.dimensions?.xDimension,y:raw.dimensions?.yDimension,z:raw.dimensions?.zDimension}, o = raw.ordering;
    assert(/^[a-z0-9._]+$/.test(p?.loadName || '') && /^[a-z0-9._]+$/.test(raw.namespace || ''), 'Invalid namespace or load name.');
    assert(typeof p.isTiprack === 'boolean' && typeof p.isMagneticModuleCompatible === 'boolean' && ['96Standard','384Standard','trough','irregular','trash'].includes(p.format), 'Missing or unsupported parameters.');
    assert(typeof raw.metadata?.displayName === 'string' && Array.isArray(raw.groups) && typeof raw.brand?.brand === 'string', 'Missing labware metadata, brand or groups.');
    assert(['x','y','z'].every(k => positive(d?.[k])), 'All body dimensions must be positive millimeters.');
    assert(['x','y','z'].every(k => raw.cornerOffsetFromSlot?.[k] === 0) && p.isDeckSlotCompatible !== false && (!raw.allowedRoles || raw.allowedRoles.includes('labware')), 'This release supports single-slot, deck-mounted labware only.');
    assert(d.x <= 128 && d.y <= 86, 'Body exceeds this editor’s nominal single-slot envelope (128 × 86 mm).');
    assert(Array.isArray(o) && o.length && o.every(c => Array.isArray(c) && c.length), 'Ordering must contain nonempty arrays.');
    const names = o.flat();
    assert(names.length <= 384 && names.length === new Set(names).size && names.length === Object.keys(raw.wells || {}).length, 'Ordering must list every well exactly once (up to 384).');
    for (const n of names) {
      const w = raw.wells[n];
      assert(typeof n === 'string' && /^[A-Z]+[1-9]\d*$/.test(n) && w, 'Invalid or missing well: ' + n);
      assert(['x','y','z'].every(k => finite(w[k])) && positive(w.depth) && positive(w.totalLiquidVolume), `${n}: enter finite coordinates, positive depth and capacity.`);
      const circular = w.shape === 'circular';
      const xw = circular ? w.diameter : w.xDimension, yw = circular ? w.diameter : w.yDimension;
      assert((circular || w.shape === 'rectangular') && positive(xw) && positive(yw), `${n}: invalid opening shape or dimensions.`);
      const e = 0.001;
      assert(w.x-xw/2 >= -e && w.x+xw/2 <= d.x+e && w.y-yw/2 >= -e && w.y+yw/2 <= d.y+e && w.z >= -e && w.z+w.depth <= d.z+e, `${n}: opening or bottom falls outside the installed envelope.`);
    }
    return {loadName:p.loadName, displayName:raw.metadata.displayName, brand:raw.brand.brand, custom:true, tipRack:p.isTiprack, dimensions:d,
      cornerOffsetFromSlot:raw.cornerOffsetFromSlot, wellMap:raw.wells, wellNames:names, officialDefinition:raw,
      wellGeometry:{rows:o[0].length,columns:o.length,depth:raw.wells[names[0]].depth}};
  }
  function build({name,loadName,version,brand,category,dimensions,rows}) {
    const wells = Object.create(null);
    for (const {name,...well} of rows) {
      assert(!Object.hasOwn(wells,name), 'Duplicate well: ' + name);
      wells[name] = well;
    }
    const sorted = new Map();
    for (const {name} of rows) {
      const col = name.match(/\d+$/)?.[0];
      if (!sorted.has(col)) sorted.set(col,[]);
      sorted.get(col).push(name);
    }
    const raw = {schemaVersion:2,version,namespace:'custom_beta',metadata:{displayName:name,displayCategory:category,displayVolumeUnits:'µL'},brand:{brand},parameters:{format:'irregular',isTiprack:false,isMagneticModuleCompatible:false,loadName},cornerOffsetFromSlot:{x:0,y:0,z:0},dimensions:{xDimension:dimensions.x,yDimension:dimensions.y,zDimension:dimensions.z},wells,ordering:[...sorted.values()],groups:[{wells:rows.map(w=>w.name),metadata:{}}]};
    assert(name.trim() && brand.trim(), 'Enter a display name and manufacturer or builder.');
    normalize(raw);
    return raw;
  }
  function stlBounds(buffer, scale, permutation) {
    assert(positive(scale) && /^[xyz]{3}$/.test(permutation) && new Set(permutation).size === 3, 'Select STL units and a valid axis mapping.');
    const dv = new DataView(buffer), lo=[Infinity,Infinity,Infinity], hi=[-Infinity,-Infinity,-Infinity];
    let count=0;
    function vertex(values) {
      assert(values.every(finite), 'STL contains a nonfinite vertex.');
      const mapped=[...permutation].map(k=>values['xyz'.indexOf(k)]*scale);
      assert(mapped.every(finite), 'Scaled STL is out of range.');
      mapped.forEach((v,i)=>{lo[i]=Math.min(lo[i],v);hi[i]=Math.max(hi[i],v);}); count++;
    }
    if (buffer.byteLength >= 84 && buffer.byteLength === 84 + 50*dv.getUint32(80,true)) {
      for (let i=84;i<buffer.byteLength;i+=50) for(let j=12;j<48;j+=12) vertex([0,4,8].map(k=>dv.getFloat32(i+j+k,true)));
    } else {
      const text=new TextDecoder().decode(buffer);
      assert(/^\s*solid\b/i.test(text) && /\bendsolid\b/i.test(text),'Not a supported ASCII or binary STL.');
      for (const m of text.matchAll(/^\s*vertex[ \t]+(\S+)[ \t]+(\S+)[ \t]+(\S+)[ \t]*\r?$/gmi)) vertex(m.slice(1).map(Number));
    }
    assert(count >= 3 && count % 3 === 0 && hi.every((v,i)=>v>lo[i]), 'STL needs a nonzero envelope in all three axes.');
    return {min:lo,max:hi,dimensions:Object.fromEntries(['x','y','z'].map((k,i)=>[k,Math.round((hi[i]-lo[i])*10000)/10000]))};
  }
  const api={normalize,build,stlBounds};
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.LabFlowGeometry=api;
})(globalThis);
