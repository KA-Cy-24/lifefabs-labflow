/* LifeFabs food-dye electrophoresis v1. All coefficients are educational, user-editable parameters.
   No claim of empirical dye mobilities; no hidden apparatus calibration. No external JS libraries. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const val=id=>Number($(id).value);
 const SETTINGS=['dyeVoltage','dyeSpacing','dyeLength','dyeAgarose','dyeDuration','dyeTemperature','dyeSieving'];
 const INITIAL={dyeVoltage:80,dyeSpacing:120,dyeLength:70,dyeAgarose:1,dyeDuration:30,dyeTemperature:22,dyeSieving:1};
 const KB=1.380649e-23, ELEMENTARY_CHARGE=1.602176634e-19;
 let dyes=[],lanes=[],timer=null,lastFrame=0;
 const canvas=$('dyeGelCanvas'),ctx=canvas?.getContext('2d');
 const esc=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const fmt=(v,n=1)=>Number(v).toFixed(n);
 const settings=()=>({voltage:val('dyeVoltage'),spacing:val('dyeSpacing'),length:val('dyeLength'),agarose:val('dyeAgarose'),duration:val('dyeDuration'),temperature:val('dyeTemperature'),sieving:val('dyeSieving')});
 // Positive distance indicates anionic-dye migration toward the anode. μ0 stored in 10^-8 m²/(V s).
 function physics(d,tMinutes,config=settings()){
   const mobility0=Number(d.mobility)*1e-8;
   const c=Number(config.agarose),k=Number(d.sieving),s=Number(config.sieving);
   const mu=mobility0*Math.exp(-k*c*s);
   const E=config.voltage/(config.spacing/1000);
   const t=tMinutes*60;
   const driftMM=mu*E*t*1000;
   const D=Math.abs(mu)*KB*(config.temperature+273.15)/(Math.max(1,Math.abs(d.charge))*ELEMENTARY_CHARGE);
   const sigmaMM=Math.sqrt(1+2*D*t*1e6);
   return {mu,E,driftMM,D,sigmaMM,outOfGel:driftMM>config.length};
 }
 function updateLabels(){
   const s=settings();
   [['voltageOut',s.voltage+' V'],['spacingOut',s.spacing+' mm'],['lengthOut',s.length+' mm'],['agaroseOut',fmt(s.agarose)+'%'],['durationOut',s.duration+' min'],['temperatureOut',s.temperature+' °C'],['sievingOut',fmt(s.sieving,2)+'×']].forEach(([id,v])=>$(id).textContent=v);
   $('dyeDerived').innerHTML=`<strong>Electric field: ${fmt(s.voltage/s.spacing*10,2)} V/cm</strong><span>Field from electrode spacing, not gel length</span><span>Model: Gaussian drift + diffusion; gel attenuation is heuristic</span>`;
   $('dyeTime').max=s.duration;
   if(val('dyeTime')>s.duration)$('dyeTime').value=s.duration;
 }
 function buildLanes(){
   $('dyeSamples').innerHTML=lanes.map((lane,i)=>`<article class="dye-sample-card"><h3>Lane ${i+1}<span class="dye-mode-chip">${lane.length} dye${lane.length===1?'':'s'}</span></h3>${dyes.map(d=>`<label><input type="checkbox" data-lane="${i}" data-dye="${esc(d.id)}" ${lane.includes(d.id)?'checked':''}><span class="dye-swatch" style="background:${d.color}"></span>${esc(d.eNumber)}</label>`).join('')}</article>`).join('');
 }
 function buildCatalogue(){
   $('dyeCatalog').innerHTML=dyes.map((d,i)=>`<article class="dye-dye-card"><h3><span class="dye-swatch" style="background:${d.color};width:16px;height:16px"></span>${esc(d.eNumber)} · ${esc(d.name)}</h3><p><strong>${esc(d.formula)}</strong> · ${fmt(d.molarMass,1)} g/mol · nominal z = ${d.charge}</p><p>${esc(d.note)}</p><label>Illustrative μ₀ (×10⁻⁸ m²/V/s)<input type="number" min="0.01" max="20" step="0.05" data-parameter="mobility" data-index="${i}" value="${d.mobility}"></label><label>Sieving factor k (per % agarose)<input type="number" min="0" max="4" step="0.05" data-parameter="sieving" data-index="${i}" value="${d.sieving}"></label><p><a href="${esc(d.source)}" target="_blank" rel="noreferrer">Open compound identity / structure ↗</a></p></article>`).join('');
 }
 function drawAtTime(t){
   if(!ctx)return;
   const W=canvas.width,H=canvas.height, s=settings();
   ctx.clearRect(0,0,W,H);ctx.fillStyle='#0b192b';ctx.fillRect(0,0,W,H);
   const gx=116,gw=W-210,gy=66,gh=H-112,laneH=gh/lanes.length,wellX=gx+22,travelW=gw-65;
   ctx.fillStyle='#20416c';ctx.fillRect(gx,gy,gw,gh);ctx.fillStyle='rgba(141,194,244,.08)';ctx.fillRect(gx+3,gy+3,gw-6,gh-6);
   for(let x=0;x<=s.length;x+=10){const px=wellX+x/s.length*travelW;ctx.strokeStyle='rgba(216,238,255,.14)';ctx.beginPath();ctx.moveTo(px,gy);ctx.lineTo(px,gy+gh);ctx.stroke();ctx.fillStyle='#a2bbd6';ctx.font='11px Consolas, monospace';ctx.textAlign='center';ctx.fillText(x+'',px,gy-11);}
   ctx.fillStyle='#a1b9cc';ctx.font='13px Consolas,monospace';ctx.fillText('Distance from well (mm)',gx+gw/2,32);
   for(let i=0;i<lanes.length;i++){
     const y=gy+(i+.5)*laneH;
     ctx.fillStyle=i%2?'rgba(30,61,101,.42)':'rgba(18,47,86,.42)';ctx.fillRect(gx,gy+i*laneH,gw,laneH);
     ctx.fillStyle='#bfd9f2';ctx.font='bold 16px Consolas, monospace';ctx.textAlign='right';ctx.fillText(`L${i+1}`,gx-18,y+5);
     ctx.fillStyle='#0b1c32';ctx.fillRect(wellX-5,y-14,11,28);
     for(const dyeId of lanes[i]){
       const d=dyes.find(x=>x.id===dyeId);if(!d)continue;
       const phys=physics(d,t,s);
       const peakX=wellX+phys.driftMM/s.length*travelW;
       const sigma=Math.max(1.5,phys.sigmaMM/s.length*travelW);
       const rgb=d.color.match(/[a-f\d]{2}/gi)?.map(hex=>parseInt(hex,16))||[255,255,255];
       const left=Math.max(wellX,peakX-4*sigma),right=Math.min(gx+gw-7,peakX+4*sigma);
       if(left>=right)continue;
       for(let x=left;x<=right;x+=1.6){const density=Math.exp(-.5*((x-peakX)/sigma)**2);ctx.fillStyle=`rgba(${rgb.join(',')},${Math.min(.88,density*.65)})`;ctx.fillRect(x,y-laneH*.32,2.2,laneH*.64);}
       ctx.fillStyle=d.color;ctx.globalAlpha=.82;ctx.fillRect(Math.max(wellX,Math.min(gx+gw-7,peakX))-1,y-10,2,20);ctx.globalAlpha=1;
     }
     ctx.strokeStyle='rgba(160,210,240,.15)';ctx.beginPath();ctx.moveTo(gx,gy+(i+1)*laneH);ctx.lineTo(gx+gw,gy+(i+1)*laneH);ctx.stroke();
   }
   ctx.fillStyle='#85d6fb';ctx.font='bold 25px Consolas,monospace';ctx.textAlign='center';ctx.fillText('−',gx-50,gy+gh/2);ctx.fillStyle='#f8aa8c';ctx.fillText('+',gx+gw+47,gy+gh/2);
   ctx.fillStyle='#bfd5ec';ctx.font='12px Consolas,monospace';ctx.fillText('cathode',gx-50,gy+gh/2+20);ctx.fillText('anode',gx+gw+47,gy+gh/2+20);
   $('dyeTimeText').textContent=`${fmt(t)} min`;
   $('dyeWarning').textContent=lanes.some(l=>l.some(id=>{const d=dyes.find(x=>x.id===id);return d&&physics(d,t,s).outOfGel}))?'Some peaks have reached or passed the usable gel edge; their bands are clipped. Reduce run time or voltage.':'';
   const rows=lanes.flatMap((lane,i)=>lane.map(id=>{const d=dyes.find(x=>x.id===id);return {lane:i+1,d,phys:physics(d,t,s)};}));
   $('dyePredictions').innerHTML=`<table><thead><tr><th>Lane</th><th>Dye</th><th>Peak from well</th><th>Band width σ</th><th>Effective μ</th></tr></thead><tbody>${rows.map(({lane,d,phys})=>`<tr><td>${lane}</td><td>${d.eNumber}</td><td>${fmt(phys.driftMM,2)} mm${phys.outOfGel?' ⚠':''}</td><td>${fmt(phys.sigmaMM,2)} mm</td><td>${phys.mu.toExponential(2)} m²/(V·s)</td></tr>`).join('')}</tbody></table>`;
 }
 function refresh(){updateLabels();drawAtTime(val('dyeTime'));}
 function stop(){if(timer!==null){cancelAnimationFrame(timer);timer=null;}$('dyePlay').textContent='▶ Play';}
 function tick(ts){if(timer===null)return;const delta=lastFrame?Math.min((ts-lastFrame)/1000,0.1):0;lastFrame=ts;
   const next=val('dyeTime')+delta*2; // 1 real second = 2 simulated minutes
   $('dyeTime').value=Math.min(val('dyeDuration'),next);refresh();
   if(next>=val('dyeDuration')){stop();return;}timer=requestAnimationFrame(tick);
 }
 function exportCSV(){const t=val('dyeTime'),s=settings();const lines=['lane,e_number,name,formula,mobility_m2_per_V_s,peak_mm,sigma_mm,voltage_V,electrode_spacing_mm,gel_length_mm,agarose_percent,time_min,calibration_status'];
   lanes.forEach((lane,i)=>lane.forEach(id=>{const d=dyes.find(x=>x.id===id),p=physics(d,t,s);lines.push([i+1,d.eNumber,JSON.stringify(d.name),d.formula,p.mu,p.driftMM,p.sigmaMM,s.voltage,s.spacing,s.length,s.agarose,t,'illustrative_not_calibrated'].join(','));}));
   const blob=new Blob([lines.join('\n')+'\n'],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='lifefabs-dye-predictions.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1200);
 }
 async function init(){
   try{const r=await fetch('data/food-dyes.json');if(!r.ok)throw Error(`HTTP ${r.status}`);const payload=await r.json();dyes=payload.dyes;if(!Array.isArray(dyes)||!dyes.length)throw Error('Catalogue empty');}
   catch(e){$('dyeWarning').textContent='Could not load dye catalogue: '+e.message+'; serve the page over HTTP.';return;}
   lanes=dyes.map(d=>[d.id]);buildLanes();buildCatalogue();
   SETTINGS.forEach(id=>$(id).addEventListener('input',()=>{stop();refresh();}));
   $('dyeTime').addEventListener('input',()=>{stop();refresh();});
   $('dyePlay').addEventListener('click',()=>{if(timer!==null){stop();return;}if(val('dyeTime')>=val('dyeDuration'))$('dyeTime').value=0;lastFrame=0;timer=requestAnimationFrame(tick);$('dyePlay').textContent='❚❚ Pause';});
   $('dyeRestart').addEventListener('click',()=>{stop();$('dyeTime').value=0;refresh();});
   $('dyeReset').addEventListener('click',()=>{stop();for(const [id,v] of Object.entries(INITIAL))$(id).value=v;$('dyeTime').value=0;refresh();});
   $('dyeExport').addEventListener('click',exportCSV);
   $('dyeDemoMix').addEventListener('click',()=>{lanes=[['e102','e133'],['e110','e129'],['e122','e133'],['e102','e110','e129'],['e124'],['e133']];buildLanes();refresh();});
   $('dyePureLanes').addEventListener('click',()=>{lanes=dyes.map(d=>[d.id]);buildLanes();refresh();});
   $('dyeSamples').addEventListener('change',e=>{const x=e.target;if(!x.matches('input[type=checkbox][data-lane]'))return;const lane=lanes[Number(x.dataset.lane)];if(!lane)return;if(x.checked&&!lane.includes(x.dataset.dye))lane.push(x.dataset.dye);if(!x.checked)lane.splice(lane.indexOf(x.dataset.dye),1);refresh();});
   $('dyeCatalog').addEventListener('change',e=>{const x=e.target,idx=Number(x.dataset.index);if(!x.dataset.parameter||!dyes[idx])return;const n=Number(x.value);if(!Number.isFinite(n)||n<0||(x.dataset.parameter==='mobility'&&n===0)||n>20){x.value=dyes[idx][x.dataset.parameter];return;}dyes[idx][x.dataset.parameter]=n;refresh();});
   refresh();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
 // Expose pure model for deterministic verification; no robot interactions.
 window.lifefabsDyePhysics={physics};
})();
