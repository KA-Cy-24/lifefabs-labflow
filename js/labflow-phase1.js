(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const wait = message => { $('lfLibraryStatus').textContent=message; };
  const entries = [
    ['bca_protein_assay','Pierce BCA Protein Assay · attached fixture declares Flex 2.18'],
    ['sci-lucif-assay3','Luciferase Reporter Assay · Protocol 3: Treatment'],
    ['transient_transfection_of_A549cells_Protocol_2','Transient Transfection of A549 Cells · Protocol 2'],
  ];
  const G=window.LabFlowGeometry;
  const panel=$('lfStudio');
  panel.innerHTML=`<h2>Custom Devices</h2>
    <p>Define the installed assembly as single-slot, single-channel OT-2 labware. A valid file is not a clearance or calibration check.</p>
    <form id="lfForm">
    <fieldset><legend>1 · Assembly</legend><div class="lf-fields">
    <label>Display name<input name="name" required maxlength="100"></label><label>Load name<input name="loadName" pattern="[a-z0-9_]+" required placeholder="custom_sampling_fixture_v1"></label>
    <label>Manufacturer / builder<input name="brand" required></label><label>Definition revision<input name="version" type="number" min="1" step="1" value="1" required></label>
    <label>Category<select name="category"><option value="tubeRack">Tube rack</option><option value="reservoir">Reservoir</option><option value="wellPlate">Well plate</option></select></label>
    ${['X length','Y width','Z height'].map((x,i)=>`<label>${x} (mm)<input name="${'xyz'[i]}" type="number" min="0.01" step="any" required></label>`).join('')}
    </div><details><summary>Use an STL to measure the envelope</summary><p>Only the bounding box is imported. Confirm the installed base, axis directions and the mounting fixture before accepting it. Measure well locations independently.</p>
    <div class="lf-fields"><label>ASCII or binary STL<input id="lfSTL" type="file" accept=".stl"></label><label>Model units<select id="lfUnits"><option value="">Select units</option><option value="1">Millimeters</option><option value="10">Centimeters</option><option value="25.4">Inches</option><option value="1000">Meters</option></select></label><label>CAD axes mapped to deck X/Y/Z<select id="lfAxes">${['xyz','xzy','yxz','yzx','zxy','zyx'].map(x=>`<option>${x}</option>`).join('')}</select></label></div>
    <label><input type="checkbox" id="lfAxesConfirmed"> The selected axes match the mounted assembly and its base.</label><button type="button" id="lfMeasure">Use STL envelope</button></details></fieldset>
    <fieldset><legend>2 · Pipette targets</legend><p>Origin: left-front-bottom of the installed assembly. X goes right, Y goes back, Z goes up. Enter each opening’s center X/Y and the well-bottom Z. All dimensions are in mm; capacity is in µL.</p>
    <div id="lfRows"></div><button type="button" id="lfAdd">Add target</button> <button type="button" id="lfPreview">Check and preview</button>
    <div id="lfPlot"></div></fieldset>
    <fieldset><legend>3 · Export or add to catalogue</legend><p>Export for review in the Opentrons App or Protocol Designer. Adding to LabFlow makes the definition available in the Hardware Configurator; it does not place it on the deck.</p>
    <button type="submit">Download labware JSON</button> <button type="button" id="lfRegister">Add to Hardware Configurator</button></fieldset>
    <p id="lfStatus" role="status"></p></form>`;
  const form=$('lfForm');
  const status=(s,error=false)=>{ $('lfStatus').textContent=s; $('lfStatus').classList.toggle('lf-error',error); };
  const rows=$('lfRows');
  let nextId=0;
  function add() {
    if(rows.children.length>=384)return status('Maximum 384 targets.',true);
    const el=document.createElement('fieldset');
    el.innerHTML=`<legend>Target ${++nextId}</legend><div class="lf-fields"><label>Well name<input data-key="name" value="A${nextId}" required pattern="[A-Z]+[1-9][0-9]*"></label>
      <label>Opening shape<select data-key="shape"><option value="circular">Circular</option><option value="rectangular">Rectangular</option></select></label>
      ${[['x','X center'],['y','Y center'],['z','Z bottom'],['depth','Depth'],['diameter','Diameter'],['xDimension','Opening X'],['yDimension','Opening Y'],['totalLiquidVolume','Capacity (µL)']].map(([k,v])=>`<label ${k.endsWith('Dimension')?'hidden':''}>${v}<input data-key="${k}" type="number" min="0" step="any" ${k.endsWith('Dimension')?'disabled':'required'}></label>`).join('')}</div><button type="button" class="lf-remove">Remove target</button>`;
    const shape=el.querySelector('select');
    shape.onchange=()=>{for(const k of ['diameter','xDimension','yDimension']){const input=el.querySelector(`[data-key="${k}"]`);input.disabled=(k==='diameter')!==(shape.value==='circular');input.required=!input.disabled;input.parentNode.hidden=input.disabled;}};
    el.querySelector('button').onclick=()=>{el.remove(); invalidate();};
    rows.append(el);invalidate();
  }
  function invalidate(){ $('lfPlot').replaceChildren();status(''); }
  form.addEventListener('input',invalidate);
  $('lfAdd').onclick=add;add();
  function withDefinition(fn) {
    if(!form.reportValidity())return;
    try {
      const values=Object.fromEntries(new FormData(form));
      const targets=[...rows.children].map(el=>Object.fromEntries([...el.querySelectorAll('[data-key]:not(:disabled)')].map(e=>[e.dataset.key,e.type==='number'?e.valueAsNumber:e.value])));
      const definition=G.build({...values,version:Number(values.version),dimensions:{x:Number(values.x),y:Number(values.y),z:Number(values.z)},rows:targets});
      fn(definition);
    }catch(e){status(e.message,true);}
  }
  $('lfMeasure').onclick=async()=>{
    try{
      const f=$('lfSTL').files[0];
      if(!f||!$('lfAxesConfirmed').checked)throw Error('Select an STL and confirm its mounted axes.');
      if(f.size>20_000_000)throw Error('STL exceeds 20 MB; export a simpler mesh.');
      const b=G.stlBounds(await f.arrayBuffer(),Number($('lfUnits').value),$('lfAxes').value);
      for(const k of 'xyz')form.elements[k].value=b.dimensions[k];
      invalidate();status(`STL envelope: ${Object.values(b.dimensions).join(' × ')} mm. No targets inferred.`);
    }catch(e){status(e.message,true);}
  };
  function plot(raw){
    const d=G.normalize(raw), views=[];
    for(const [axis,vertical,label] of [['x','y','Top view · X/Y'],['x','z','Side view · X/Z']]){
      const scale=Math.min(340/d.dimensions[axis],180/d.dimensions[vertical]);
      const h=d.dimensions[vertical]*scale,w=d.dimensions[axis]*scale;
      const marks=d.wellNames.map(n=>{const q=d.wellMap[n],width=(q.diameter||q.xDimension)*scale,height=(q.diameter||q.yDimension)*scale,x=q.x*scale,y=h-q[vertical]*scale;
        return vertical==='z'?`<rect x="${x-width/2}" y="${y-q.depth*scale}" width="${width}" height="${q.depth*scale}"/><text x="${x}" y="${y-3}">${n}</text>`:q.shape==='rectangular'?`<rect x="${x-width/2}" y="${y-height/2}" width="${width}" height="${height}"/><text x="${x}" y="${y}">${n}</text>`:`<circle cx="${x}" cy="${y}" r="${width/2}"/><text x="${x}" y="${y}">${n}</text>`;}).join('');
      views.push(`<figure><figcaption>${label}</figcaption><svg role="img" aria-label="${label}" viewBox="-6 -12 ${w+12} ${h+24}"><rect class="lf-outline" width="${w}" height="${h}"/>${marks}</svg></figure>`);
    }
    $('lfPlot').innerHTML=views.join('');status('Geometry checks passed. Verify mounting, calibration and tip approach on the actual instrument.');
  }
  $('lfPreview').onclick=()=>withDefinition(plot);
  form.onsubmit=e=>{e.preventDefault();withDefinition(raw=>{const url=URL.createObjectURL(new Blob([JSON.stringify(raw,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=raw.parameters.loadName+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);plot(raw);});};
  $('lfRegister').onclick=()=>withDefinition(raw=>{if(!window.labflowRegisterLabware)throw Error('Workbench is still loading.');window.labflowRegisterLabware(raw);status('Added to the catalogue. Open Build and place it in the Hardware Configurator.');});

  $('lfLibrary').innerHTML=`<h2>Protocol Library</h2><p>Fetch public Opentrons repository source for static inspection, never execution. Repository templates may need values supplied by the original Library download.</p>
   <div id="lfCurated" class="lf-fields"></div><form id="lfFetchForm"><label>Opentrons protocol slug, Library URL, or GitHub Python file URL<input id="lfQuery" required></label>
   <label>Branch for slug lookup<select id="lfBranch"><option>master</option><option>develop</option></select></label> <button type="submit">Fetch source for inspection</button></form>
   <p id="lfLibraryStatus" role="status"></p><button id="lfOpenSource" type="button" hidden>Open source in Inspect Python</button>`;
  const repo='https://raw.githubusercontent.com/Opentrons/Protocols/';
  for(const [slug,title] of entries){
    const item=document.createElement('div'), link=document.createElement('a'), b=document.createElement('button');
    link.href='https://library.opentrons.com/p/'+slug;link.textContent=title;link.target='_blank';link.rel='noopener noreferrer';
    b.textContent='Select for lookup';b.type='button';b.onclick=()=>{$('lfQuery').value=slug;if(slug==='sci-lucif-assay3')$('lfBranch').value='develop';};
    item.append(link,document.createElement('br'),b);$('lfCurated').append(item);
  }
  function parseQuery(q,branch){
    const slug=/^[a-zA-Z0-9_-]+$/;
    if(slug.test(q))return {slug:q,ref:branch};
    const url=new URL(q);
    if(url.protocol!=='https:')throw Error('Use an HTTPS Opentrons URL.');
    const p=url.pathname.split('/').filter(Boolean);
    if(url.host==='library.opentrons.com'&&p.length===2&&p[0]==='p'&&slug.test(p[1]))return {slug:p[1],ref:branch};
    const gh=url.host==='github.com'&&p[2]==='blob', raw=url.host==='raw.githubusercontent.com';
    const idx=gh?3:2;
    if((gh||raw)&&p[0]==='Opentrons'&&p[1]==='Protocols'&&p[idx+1]==='protocols'&&/^(?:master|develop|[a-f0-9]{40})$/.test(p[idx])&&p.length===idx+4&&slug.test(p[idx+2])&&/^[\w.-]+\.py$/.test(p[idx+3]))return {slug:p[idx+2],ref:p[idx],filename:p[idx+3]};
    throw Error('Expected an Opentrons Library URL or a Python file under Opentrons/Protocols → protocols.');
  }
  async function request(url){return fetch(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});}
  async function findSource(q){
    const base=`${repo}${q.ref}/protocols/${q.slug}/`;
    const read=async file=>{const url=base+file,r=await request(url);if(r.status===404)return null;if(!r.ok)throw Error(`GitHub returned HTTP ${r.status}.`);const text=await r.text();if(text.length>1_000_000||!text.trim())throw Error('Source is empty or over 1 MB.');return {text,url};};
    if(q.filename)return (await read(q.filename))||(()=>{throw Error('This exact source file was not found.');})();
    const conventional=await read(q.slug+'.ot2.apiv2.py');if(conventional)return conventional;
    const listing=await request(`https://api.github.com/repos/Opentrons/Protocols/contents/protocols/${q.slug}?ref=${q.ref}`);
    if(!listing.ok)throw Error(`Repository directory lookup returned HTTP ${listing.status}. Try an exact GitHub Python file URL or import the Library download.`);
    const matches=(await listing.json()).filter(x=>x.type==='file'&&/^[\w.-]+\.py$/.test(x.name));
    if(matches.length!==1)throw Error('No unique Python source in that directory. Supply an exact file URL or upload the Library download.');
    const result=await read(matches[0].name);if(!result)throw Error('Source disappeared before it could be fetched.');return result;
  }
  let source=null;
  $('lfFetchForm').onsubmit=async e=>{
    e.preventDefault();const submit=e.submitter||$('lfFetchForm').querySelector('button[type="submit"]');submit.disabled=true;source=null;$('lfOpenSource').hidden=true;wait('Looking up repository source…');
    try{const q=parseQuery($('lfQuery').value.trim(),$('lfBranch').value);source=await findSource(q);wait(`Fetched ${source.url}. Static inspection only. A repository template may differ from the downloadable protocol.`);$('lfOpenSource').hidden=false;}
    catch(err){wait(`${err.message} You can still import the downloaded .py in Inspect Python.`);}finally{submit.disabled=false;}
  };
  $('lfOpenSource').onclick=()=>{
    if(!source)return;
    const editor=$('codeEditor');
    if(editor.value.trim()&&!window.confirm('Replace the current editor contents with this repository source?'))return;
    $('modeInspect').click();editor.value=source.text;editor.dispatchEvent(new Event('input',{bubbles:true}));$('analyzeCode').click();editor.focus();
  };
})();
