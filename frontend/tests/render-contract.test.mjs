// Runs the source renderer and real controller. A small DOM sink captures
// innerHTML and button handlers; this is HTML-output verification, not browser QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDashboard} from '../src/app.js';
import * as contract from '../src/display-contract.mjs';

const read = path => fs.readFileSync(new URL(path,import.meta.url),'utf8');
const alerts = JSON.parse(read('../fixtures/alerts.json')).alerts;
const copy = id => structuredClone(alerts.find(a=>a.alert_id===id));
const list = items => ({count:items.length,limit:5,alerts:items,next_cursor:null});
const defer = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
function harness(adapter) {
 const root={innerHTML:''},handlers=new Map();
 const document={activeElement:null,getElementById(id){
  if(id==='app')return root;
  if(id==='fixtures')return {textContent:JSON.stringify(list(alerts))};
  if(!root.innerHTML.includes(`id="${id}"`))return null;
  return {addEventListener:(_,fn)=>handlers.set(id,fn),focus(){}};
 },querySelectorAll(){return [];}};
 const controller=createDashboard(adapter,document);
 return {controller,html:()=>root.innerHTML,panel:()=>root.innerHTML.match(/<aside\b[^>]*>([\s\S]*?)<\/aside>/)?.[1]??'',click:id=>{assert.ok(handlers.has(id));return handlers.get(id)();}};
}
const actions = html => [...html.matchAll(/<code class="action-code">([^<]*)<\/code>/g)].map(m=>m[1]);
const scores = html => [...html.matchAll(/<div class="score-value">([^<]*)<\/div>/g)].map(m=>Number(m[1]));

test('shipped module equals reviewed source; all examples render server fields and actions unchanged',async()=>{
 assert.equal(read('../dist/display-contract.js').replaceAll('\r\n','\n'),read('../src/display-contract.mjs').replaceAll('\r\n','\n'));
 assert.equal(read('../dist/app.js').replaceAll('\r\n','\n'),read('../src/app.js').replaceAll("'./display-contract.mjs'","'./display-contract.js'").replaceAll('\r\n','\n'));
 const h=harness({detail:async id=>copy(id)});
 for(const expected of alerts){
  const snapshot=structuredClone(expected);await h.controller.select(expected.alert_id);const html=h.panel();
  assert.ok(html.includes(`class="sev ${expected.level}"`));
  assert.ok(html.includes(`<span>${expected.human_required?'검토 필요':'검토 요구 없음'}</span>`));
  assert.deepEqual(scores(html),[expected.risk_score,expected.uncertainty_score]);
  assert.deepEqual(actions(html),expected.recommended_actions);
  assert.deepEqual(expected,snapshot);
 }
 // Deliberately conflicting response: front end must not derive policy from INFO,
 // high scores, timeout code, or action names. This is a test, not a normal fixture.
 const a=copy(18);Object.assign(a,{level:'INFO',human_required:true,risk_score:99,uncertainty_score:7,recommended_actions:['no_immediate_action_required','human_review_required','unmapped_action']});
 const snapshot=structuredClone(a),probe=harness({detail:async()=>a});await probe.controller.select(18);
 assert.ok(probe.panel().includes('class="sev INFO"'));assert.ok(probe.panel().includes('<span>검토 필요</span>'));
 assert.deepEqual(scores(probe.panel()),[99,7]);assert.deepEqual(actions(probe.panel()),a.recommended_actions);assert.deepEqual(a,snapshot);
});

test('real render branches distinguish empty/error/404/invalid and wire retry buttons',async()=>{
 const expected={empty:'현재 조회 조건에 맞는 Alert가 없습니다.',notfound:'해당 Alert를 찾을 수 없습니다.',error:'Alert를 불러오지 못했습니다.',invalid:'응답 데이터를 확인할 수 없습니다.'};
 const empty=harness({list:async()=>list([])});await empty.controller.load();assert.ok(empty.html().includes(expected.empty));assert.ok(!empty.html().includes(expected.error));
 let calls=0;const failed=harness({list:async()=>{if(++calls===1)throw Error('network');return list([]);}});
 await failed.controller.load();assert.ok(failed.html().includes(expected.error));assert.ok(failed.html().includes('id="retry-list"'));assert.ok(!failed.html().includes(expected.empty));
 await failed.click('retry-list');assert.ok(failed.html().includes(expected.empty));
 for(const phase of ['error','notfound','invalid']){
  let attempt=0;const h=harness({detail:async id=>{if(++attempt===1){if(phase==='notfound')throw new contract.AlertNotFound();if(phase==='error')throw Error('network');const bad=copy(id);delete bad.human_required;return bad;}return copy(id);}});
  await h.controller.select(18);assert.ok(h.panel().includes(expected[phase]));assert.ok(!h.panel().includes('class="detail-intro"'));
  assert.equal(h.panel().includes('id="retry-detail"'),phase==='error');
  if(phase==='error'){await h.click('retry-detail');assert.ok(h.panel().includes('evt_review_018'));}
 }
});

test('switching from a successful detail immediately renders loading then failure/404/invalid without stale detail',async()=>{
 for(const phase of ['error','notfound','invalid']){
  const pending=defer();const h=harness({detail:id=>id===18?Promise.resolve(copy(18)):pending.promise});
  await h.controller.select(18);assert.ok(h.panel().includes('evt_review_018'));
  const request=h.controller.select(17);
  assert.ok(h.panel().includes('Alert를 불러오는 중입니다.'));assert.ok(!h.panel().includes('evt_review_018'));assert.deepEqual(scores(h.panel()),[]);
  if(phase==='invalid'){const bad=copy(17);bad.risk_score='3';pending.resolve(bad);}
  else pending.reject(phase==='notfound'?new contract.AlertNotFound():Error('network'));
  await request;assert.ok(h.panel().includes(contract.statusText[phase]));assert.ok(!h.panel().includes('evt_review_018'));assert.deepEqual(actions(h.panel()),[]);
 }
});

test('missing or wrong required values render invalid data, never normal default values',async()=>{
 for(const field of ['risk_score','uncertainty_score','human_required','signals','recommended_actions']){
  for(const mode of ['missing','wrong']){
   const a=copy(18);if(mode==='missing')delete a[field];else a[field]=field==='human_required'?'false':field.endsWith('_score')?'0':{};
   const h=harness({detail:async()=>a});await h.controller.select(18);
   assert.ok(h.panel().includes('응답 데이터를 확인할 수 없습니다.'));assert.deepEqual(scores(h.panel()),[]);assert.deepEqual(actions(h.panel()),[]);
   assert.ok(!h.panel().includes('class="decision-strip"'));assert.equal(Object.hasOwn(a,field),mode!=='missing');
  }
 }
 for(const value of [undefined,null,{},'[]']){
  const response=list([]);if(value===undefined)delete response.alerts;else response.alerts=value;
  const h=harness({list:async()=>response});await h.controller.load();assert.ok(h.html().includes('응답 데이터를 확인할 수 없습니다.'));assert.ok(!h.html().includes('현재 조회 조건에 맞는 Alert가 없습니다.'));
 }
});

test('actual evidence/empty collection output preserves null, zero, false and empty string distinctly',async()=>{
 const a=copy(18);a.signals[0].evidence={missing:null,zero:0,disabled:false,empty:''};
 const h=harness({detail:async()=>a});await h.controller.select(18);
 const html=h.panel();assert.equal((html.match(/입력값 없음/g)||[]).length,1);
 for(const [key,value] of [['missing','null'],['zero','0'],['disabled','false'],['empty','&quot;&quot;']]){
  assert.ok(html.includes(`<code class="key">${key}</code>`));assert.ok(html.includes(`<code>${value}</code>`));
 }
 const expected={evidence:'표시할 판단 근거가 없습니다.',signals:'발동된 평가 신호가 없습니다.',actions:'제공된 권장 조치가 없습니다.'};
 for(const kind of Object.keys(expected)){
  const a=copy(18);if(kind==='evidence')a.signals[0].evidence={};if(kind==='signals')a.signals=[];if(kind==='actions')a.recommended_actions=[];
  const view=harness({detail:async()=>a});await view.controller.select(18);
  for(const [key,text] of Object.entries(expected))assert.equal(view.panel().includes(text),key===kind);
 }
});
