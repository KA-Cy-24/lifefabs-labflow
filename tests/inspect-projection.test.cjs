/* Exercise the actual integration against a small DOM/core stand-in. This is not a browser test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const here = path.join(__dirname,'..');
const source = fs.readFileSync(path.join(here,'js/inspect-integration.inc'),'utf8');
class Node {
  constructor(){ this.children=[]; this.value=''; }
  append(...items){ this.children.push(...items); }
  replaceChildren(...items){ this.children=items; }
  addEventListener(event, fn){ this[event]=fn; }
}
const dom = new Map();
const $ = id => { if (!dom.has(id)) dom.set(id,new Node()); return dom.get(id); };
const base = {status:'mapped-subset',hardware:[{kind:'labware',id:'h1',name:'plate',label:'Plate',location:2,catalogue:true,line:2},{kind:'instrument',id:'h2',name:'pip',label:'pip',location:'right',line:3}],warnings:[],events:[{line:4,owner:'h2',method:'aspirate',volume:40,targets:[{lab:'h1',well:'A1',reference:'bottom',z:1}]}]};
let inspector = async () => ({model:base,definitions:new Map([['plate',{}]])});
const context = vm.createContext({$,
  document:{createElement:()=>new Node()},activeMode:'inspect',activeStepIndex:0,viewerSource:'inspectPending',
  currentSteps:[], previewStale:false, previewFailed:false, inspectEditorStale:false, inspectedStats:null, lastInspectedCode:'',
  SLOT_MAP:{2:{}}, PIPETTES:{}, customDefs:[], labwareDefs:[],
  targetPosition:()=>({relative:{x:1,y:2,z:3}}),getDefinition:()=>({}),makeEvent:x=>x,
  updateTimelineAndView(){},updateProtocolOverview(){},setDiagnostics(){},updateCodeMeta(){},
  inspectPython:(...args)=>inspector(...args),
});
vm.runInContext(source,context);
(async ()=>{
  $('codeEditor').value='def run(ctx): pass';
  await context.analyseCurrentCode();
  assert.equal(context.inspectedStats.rawLabwares[0].slot,2);
  assert.equal(context.currentSteps[0].slot,2);
  assert.equal(context.currentSteps[0].point.relative.z,3);
  assert.match($('lfImportedHardware').children[1].children[0].textContent,/Plate · 2/);
  assert.match($('lfImportedComposer').children[1].children[0].children[0].textContent,/aspirate · 40 µL · A1/);
  assert.equal($('codeEditor').value,'def run(ctx): pass');
  let finish;
  inspector = () => new Promise(resolve => { finish=resolve; });
  const stale=context.analyseCurrentCode();
  $('codeEditor').value='a newer script';
  finish({model:base,definitions:new Map()});
  await stale;
  assert.equal(context.currentSteps.length,0);
  assert.equal(context.inspectedStats,null);
  inspector = async () => ({model:{status:'source-only',robot:'Flex',hardware:[],events:[],warnings:[]},definitions:new Map()});
  await context.analyseCurrentCode();
  assert.equal(context.inspectedStats.robotType,'Flex');
  assert.equal(context.currentSteps.length,0);
  assert.match($('lfImportedComposer').children[0].textContent,/No mapped actions/);
  console.log('Projection, stale result, and Flex replacement checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
