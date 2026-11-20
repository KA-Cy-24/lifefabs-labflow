(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const G = window.LabFlowGeometry;
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
    el.querySelector('button').className='button button-outline button-small lf-remove';
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

  // All discovery starts in the official Opentrons staging branch.
  const root='https://api.github.com/repos/Opentrons/Protocols';
  const raw='https://raw.githubusercontent.com/Opentrons/Protocols';
  const ref='develop', slugOK=/^[A-Za-z0-9_-]+$/, fileOK=/^(?!\.)[\w.-]+\.py$/;
  const tell=(message,error=false)=>{const p=$('lfLibraryStatus');p.textContent=message;p.classList.toggle('lf-error',error);};
  const featured=[...document.querySelectorAll('[data-lf-slug]')];
  const pinnedPaths={'sci-lucif-assay3':'sci-lucif-assay3.ot2.apiv2.py'};
  let source, pending, catalogue, catalogueBusy=false, expanded=false;
  async function request(url){
    const r=await fetch(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(12000)});
    if(r.status===403||r.status===429)throw Error('GitHub denied or rate-limited this request. Try opening the upstream file or uploading a local copy.');
    return r;
  }
  async function json(url){const r=await request(url);if(!r.ok)throw Error(`GitHub returned HTTP ${r.status}. Check the protocol slug or use the published Library download.`);return r.json();}
  function query(q){
    if(slugOK.test(q))return {slug:q,ref};
    let u;try{u=new URL(q);}catch{throw Error('Enter a protocol slug or an Opentrons URL.');}
    if(u.protocol!=='https:')throw Error('Use an HTTPS Opentrons link.');
    const p=u.pathname.split('/').filter(Boolean);
    if(u.host==='library.opentrons.com'&&p[0]==='p'&&p.length===2&&slugOK.test(p[1]))return {slug:p[1],ref};
    const tail=u.host==='github.com'&&p[2]==='blob'?p.slice(3):u.host==='raw.githubusercontent.com'?p.slice(2):[];
    if(p[0]==='Opentrons'&&p[1]==='Protocols'&&tail.length===4&&(tail[0]===ref||/^[a-f0-9]{40}$/.test(tail[0]))&&tail[1]==='protocols'&&slugOK.test(tail[2])&&fileOK.test(tail[3]))return {slug:tail[2],ref:tail[0],file:tail[3]};
    throw Error('Use a Library link or an Opentrons/Protocols Python file URL on develop or at an exact commit.');
  }
  async function read(q,file){
    const path=`${q.ref}/protocols/${q.slug}/${file}`;
    const r=await request(`${raw}/${path}`);
    if(r.status===404)return null;
    if(!r.ok)throw Error(`Source download returned HTTP ${r.status}.`);
    if(Number(r.headers.get('content-length'))>1_000_000)throw Error('Source is over 1 MB.');
    const text=await r.text();if(!text.trim()||text.length>1_000_000)throw Error('Source is empty or over 1 MB.');
    return {text,file,path};
  }
  // Fetch only direct JSON siblings from the same allowed repository and ref.
  // Raw Python remains unchanged; companion files are data, never executable.
  const jsonFilename = /^(?!\.)[\w.-]{1,150}\.json$/i;
  async function companions(q, listing) {
    try {
      const entries = listing || await json(`${root}/contents/protocols/${q.slug}?ref=${q.ref}`);
      if (!Array.isArray(entries)) throw Error('No directory listing.');
      const all = entries.filter(x=>x.type==='file' && jsonFilename.test(x.name));
      all.sort((a,b)=>Number(b.name==='fields.json')-Number(a.name==='fields.json'));
      const files = [], failures = all.slice(24).map(x=>x.name);
      // Small batches avoid large bursts of requests for accessory files.
      for (let i=0;i<Math.min(all.length,24);i+=4) {
        await Promise.all(all.slice(i,Math.min(i+4,24)).map(async entry=>{
          try {
            if (entry.size>1_000_000) throw Error('File exceeds 1 MB.');
            const path = `${q.ref}/protocols/${q.slug}/${encodeURIComponent(entry.name)}`;
            const response = await request(`${raw}/${path}`);
            if (!response.ok || Number(response.headers.get('content-length'))>1_000_000) throw Error('Unavailable or too large.');
            const text = await response.text();
            if (text.length>1_000_000) throw Error('File exceeds limit.');
            files.push({name:entry.name, text, data:JSON.parse(text)});
          } catch { failures.push(entry.name); }
        }));
      }
      return {files:files.sort((a,b)=>a.name.localeCompare(b.name)), failures};
    } catch (error) { return {files:[],failures:[],error:error.message}; }
  }
  async function showWithCompanions(q, result, listing) {
    tell('Checking for JSON files in the source directory…');
    result.companions = await companions(q, listing);
    show(result);
    showCompanions(result.companions);
  }
  function showCompanions({files, failures, error}) {
    $('lfCompanionStatus').textContent = error ? `Could not check companion JSON: ${error}` :
      `${files.length} companion JSON file(s) loaded.${failures.length?' Unavailable, invalid or over the fetch limit: '+failures.join(', ')+'.':''}`;
    const links = $('lfCompanionFiles'), inputs = $('lfCompanionInputs');
    links.replaceChildren(); inputs.replaceChildren();
    const fields = files.find(f=>f.name==='fields.json')?.data;
    if (Array.isArray(fields)) for (const field of fields.slice(0,32)) {
      if (!field || !/^[a-zA-Z_]\w{0,79}$/.test(field.name) || typeof field.name!=='string' || !Array.isArray(field.options)) continue;
      const options = field.options.slice(0,100).filter(x=>x && ['string','number','boolean'].includes(typeof x.value));
      if (!options.length) continue;
      const label = document.createElement('label'), select = document.createElement('select');
      label.textContent = typeof field.label==='string' ? field.label : field.name;
      select.dataset.lfParameter = field.name;
      select.append(new Option('Choose for inspection', ''));
      options.forEach(o=>select.append(new Option(String(o.label??o.value),JSON.stringify(o.value))));
      label.append(select); inputs.append(label);
    }
    for (const file of files) {
      const button = document.createElement('button');
      button.type='button'; button.className='button button-outline button-small';
      button.textContent=`Download ${file.name}`;
      button.onclick=()=>{
        const url=URL.createObjectURL(new Blob([file.text],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download=file.name;link.click();
        setTimeout(()=>URL.revokeObjectURL(url),3000);
      };
      links.append(button);
    }
  }

  function show(result){
    source=result;$('lfSource').hidden=false;$('lfSourceTitle').textContent=result.file;
    $('lfUpstream').href=`https://github.com/Opentrons/Protocols/blob/${result.path}`;
    const robot=result.text.match(/["']robotType["']\s*:\s*["'](Flex|OT-2)["']/)?.[1];
    const hint=robot??(/\.ot2\./.test(result.file)?'OT-2 (filename hint)':/\.flex\./.test(result.file)?'Flex (filename hint)':'Robot not identified');
    const api=result.text.match(/["']apiLevel["']\s*:\s*["'](\d+\.\d+)["']/)?.[1];
    const template=/\bget_values\s*\(/.test(result.text)&&!/^\s*def get_values\s*\(/m.test(result.text);
    $('lfCompatibility').textContent=`${hint}${api?' · API '+api:''}. ${template?'Parameter helper not defined here: use the published download if available. ':''}Static inspection only; compatibility and execution are not verified.`;
    tell('Source loaded. Open it in the inspector or download the unchanged Python.');
  }
  async function lookup(value,chosen,directory){
    if(pending===true)return;
    const buttons=[...featured,$('lfFetchForm').querySelector('button'),$('lfLoadFile'),...$('lfResults').querySelectorAll('button')];
    buttons.forEach(b=>b.disabled=true);pending=true;source=null;$('lfSource').hidden=true;$('lfFiles').hidden=true;tell('Looking up Opentrons source…');
    try{
      const q=query(value);
      const exact=q.file||chosen;
      if(exact){const r=await read(q,exact);if(!r)throw Error('That source file was not found.');await showWithCompanions(q,r,directory);return;}
      const preferred=Object.hasOwn(pinnedPaths,q.slug)?pinnedPaths[q.slug]:null;
      if(preferred){const r=await read(q,preferred);if(r){await showWithCompanions(q,r);return;}}
      const list=await json(`${root}/contents/protocols/${q.slug}?ref=${q.ref}`);
      if(!Array.isArray(list))throw Error('GitHub did not return a directory listing.');
      const names=list.filter(x=>x.type==='file'&&fileOK.test(x.name)).map(x=>x.name);
      if(!names.length)throw Error('No Python source found in this folder. Try the published Library download.');
      if(names.length===1){const r=await read(q,names[0]);if(!r)throw Error('The listed file was not found.');await showWithCompanions(q,r,list);return;}
      $('lfFile').replaceChildren(...names.map(n=>new Option(n,n)));$('lfFiles').hidden=false;
      $('lfLoadFile').onclick=()=>lookup(value,$('lfFile').value,list);tell('Multiple source files found. Choose the one for your robot and API.');
    }catch(e){tell(e.name==='TimeoutError'?'GitHub did not respond in time. Try again or inspect a local file.':e.message,true);}
    finally{pending=false;buttons.forEach(b=>b.disabled=false);}
  }
  function select(slug){$('lfQuery').value=slug;lookup(slug);}
  featured.forEach(b=>b.onclick=()=>select(b.dataset.lfSlug));
  $('lfFetchForm').onsubmit=e=>{e.preventDefault();lookup($('lfQuery').value.trim());};
  $('lfLocal').onclick=()=>$('modeInspect').click();
  $('codeEditor').addEventListener('input',()=>{delete $('codeEditor').lfLibraryValues;});
  $('lfOpenSource').onclick=()=>{
    if(!source)return;
    const editor=$('codeEditor');
    if(editor.value.trim()&&editor.value!==source.text&&!window.confirm('Replace the Python editor contents with this repository source?'))return;
    $('modeInspect').click();editor.value=source.text;editor.dispatchEvent(new Event('input',{bubbles:true}));
    const values = Object.fromEntries([...$('lfCompanionInputs').querySelectorAll('select[data-lf-parameter]')]
      .filter(x=>x.value!=='').map(x=>[x.dataset.lfParameter,JSON.parse(x.value)]));
    editor.lfLibraryValues={source:editor.value, values};
    $('analyzeCode').click();editor.focus();
  };
  $('lfDownload').onclick=()=>{
    if(!source)return;
    const href=URL.createObjectURL(new Blob([source.text],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=href;a.download=source.file;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),5000);
  };
  function renderCatalogue(){
    const terms=$('lfFilter').value.toLowerCase().split(/[\s_-]+/).filter(Boolean);
    const matches=catalogue.filter(slug=>terms.every(t=>slug.toLowerCase().includes(t)));
    const limit=expanded?200:36;
    $('lfCount').textContent=`${matches.length} matching folders${matches.length>limit?` · showing ${limit}; refine your search for more specific results`:''}.`;
    const buttons=matches.slice(0,limit).map(slug=>{const b=document.createElement('button');b.type='button';b.className='button button-outline button-small';b.textContent=slug;b.onclick=()=>select(slug);return b;});
    if(!expanded&&matches.length>limit){const b=document.createElement('button');b.className='button button-outline button-small';b.textContent='Show more';b.onclick=()=>{expanded=true;renderCatalogue();};buttons.push(b);}
    $('lfResults').replaceChildren(...buttons);
  }
  $('lfFilter').oninput=()=>{expanded=false;renderCatalogue();};
  $('lfBrowse').onclick=async()=>{
    if(catalogue){$('lfCatalogue').hidden=false;$('lfFilter').focus();return;}
    if(catalogueBusy)return;
    catalogueBusy=true;$('lfBrowse').disabled=true;$('lfBrowse').textContent='Loading repository catalogue…';
    try{
      // Non-recursive tree queries avoid the recursive tree size limit for the whole repo.
      const tree=await json(`${root}/git/trees/${ref}`);
      const folder=tree.tree?.find(x=>x.path==='protocols'&&x.type==='tree');
      if(!/^[a-f0-9]{40}$/.test(folder?.sha??''))throw Error('Could not locate the protocols tree.');
      const dirs=await json(`${root}/git/trees/${folder.sha}`);
      if(!Array.isArray(dirs.tree)||dirs.truncated)throw Error('GitHub did not return a complete catalogue. Search by slug or open the upstream repository.');
      catalogue=dirs.tree.filter(x=>x.type==='tree'&&slugOK.test(x.path)).map(x=>x.path).sort((a,b)=>a.localeCompare(b));
      $('lfCatalogue').hidden=false;renderCatalogue();$('lfFilter').focus();
    }catch(e){tell(`Catalogue unavailable: ${e.message}`,true);}
    finally{catalogueBusy=false;$('lfBrowse').disabled=false;$('lfBrowse').textContent=catalogue?'Search repository catalogue':'Load repository catalogue';}
  };
})();
