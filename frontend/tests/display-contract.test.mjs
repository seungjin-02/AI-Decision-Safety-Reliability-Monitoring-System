import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateAlert,validateList,ResponseDataError,AlertNotFound,signalReason,summaryFor,evidenceValues,createController} from '../src/display-contract.mjs';
const response=JSON.parse(fs.readFileSync(new URL('../fixtures/alerts.json',import.meta.url),'utf8'));
const original=response.alerts;
const infoExample=original.find(a=>a.alert_id===19);
const copy=id=>structuredClone(original.find(a=>a.alert_id===id));
const list=items=>({count:items.length,limit:5,alerts:items,next_cursor:null});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};

test('timeout mapping explains input failure and preserves all server decisions',()=>{
 const a=copy(18);validateAlert(a);
 assert.equal(summaryFor(a),'평가 대상의 응답 시간 초과가 보고되었습니다.');
 assert.equal(signalReason(a.signals[0]),'입력된 실패 코드가 응답 시간 초과를 나타냅니다.');
 assert.deepEqual([a.level,a.human_required,a.risk_score,a.uncertainty_score,a.recommended_actions],['CRITICAL',true,0,0,['human_review_required','immediate_investigation','escalate_incident']]);
 a.level='WARN';a.human_required=false;a.risk_score=100;a.recommended_actions=[];
 validateAlert(a);summaryFor(a);signalReason(a.signals[0]);
 assert.deepEqual([a.level,a.human_required,a.risk_score,a.recommended_actions],['WARN',false,100,[]]);
});
test('unknown failure codes/rules use the original summary and signal reason',()=>{
 for(const key of ['code','rule']){const a=copy(18);if(key==='code')a.signals[0].evidence.error_code='another_failure';else a.signals[0].rule_id='unknown_rule';assert.equal(summaryFor(a),a.reason_summary);assert.equal(signalReason(a.signals[0]),a.signals[0].reason);}
 const a=copy(18);a.signals.push({...structuredClone(a.signals[0]),evidence:{error_code:'another_failure'}});assert.equal(summaryFor(a),a.reason_summary);
});
test('latency is labelled as an input and WARN review requirement is unchanged',()=>{
 const a=copy(14);assert.equal(signalReason(a.signals.find(s=>s.rule_id==='latency_high')),'입력된 지연 시간이 평가 기준을 초과했습니다.');
 assert.equal(summaryFor(a),'낮은 신뢰도의 승인 판단과 입력 지연의 기준 초과가 확인되었습니다.');
 const warn=copy(17);assert.equal(warn.level,'WARN');assert.equal(warn.human_required,false);assert.doesNotMatch(summaryFor(warn),/안전|처리 완료|검토 필요/);
});
test('null, zero, false, empty string and empty evidence retain distinct values',()=>{
 assert.deepEqual(evidenceValues({model_version:null,zero:0,disabled:false,empty:''}),[
 {key:'model_version',raw:'null',missing:true},{key:'zero',raw:'0',missing:false},{key:'disabled',raw:'false',missing:false},{key:'empty',raw:'""',missing:false}]);
 assert.deepEqual(evidenceValues({}),[]);
 const a=copy(16);assert.equal(a.signals[1].evidence.model_version,null);assert.equal(signalReason(a.signals[1]),'입력된 모델 버전 정보가 없습니다.');
});
test('valid empty evidence, signals and recommended actions are accepted without replacement',()=>{
 const a=copy(18);a.signals[0].evidence={};validateAlert(a);assert.equal(signalReason(a.signals[0]),a.signals[0].reason);
 a.signals=[];a.recommended_actions=[];assert.equal(validateAlert(a),a);
 assert.equal(validateList(list([])).alerts.length,0);
});
test('all required fields reject missing/wrong values and never fill defaults',()=>{
 const wrong={alert_id:'18',event_id:null,trace_id:0,created_at:'not a date',level:'unknown',human_required:'false',risk_score:null,uncertainty_score:'0',recommended_actions:null,reason_summary:[],signals:null};
 for(const [field,value] of Object.entries(wrong)){
  const missing=copy(18);delete missing[field];assert.throws(()=>validateAlert(missing),ResponseDataError,field);assert.equal(Object.hasOwn(missing,field),false);
  const invalid=copy(18);invalid[field]=value;assert.throws(()=>validateAlert(invalid),ResponseDataError,field);assert.equal(invalid[field],value);
 }
 for(const field of ['rule_id','category','score','reason','evidence','is_critical_override']){const a=copy(18);delete a.signals[0][field];assert.throws(()=>validateAlert(a),ResponseDataError,field);}
 const a=copy(18);delete a.metadata;delete a.signals[0].metadata;validateAlert(a);
 for(const field of ['count','limit','alerts']){const r=list([]);delete r[field];assert.throws(()=>validateList(r),ResponseDataError);}
});
test('list failure, invalid data and successful empty result have separate states',async()=>{
 const c=createController({list:async()=>{throw new Error('network')},detail:async()=>copy(18)});await c.load();assert.equal(c.state.list.phase,'error');assert.equal(c.state.list.data,null);
 const bad=copy(18);delete bad.risk_score;const invalid=createController({list:async()=>list([bad]),detail:async()=>bad});await invalid.load();assert.equal(invalid.state.list.phase,'invalid');assert.equal(invalid.state.list.data,null);
 const empty=createController({list:async()=>list([]),detail:async()=>copy(18)});await empty.load();assert.equal(empty.state.list.phase,'success');assert.deepEqual(empty.state.list.data,[]);
});

test('wrong signal types reject without silently replacing evidence or scores',()=>{
 const wrong={rule_id:null,category:0,score:'0',reason:false,evidence:[],is_critical_override:'false'};
 for(const [field,value] of Object.entries(wrong)){
  const a=copy(18);a.signals[0][field]=value;
  assert.throws(()=>validateAlert(a),ResponseDataError,field);
  assert.equal(a.signals[0][field],value);
 }
});
test('loading clears old detail; retry recovers a failed request without showing stale data',async()=>{
 const pending=deferred();let calls=0;
 const c=createController({list:async()=>list(original),detail:async id=>{calls++;if(calls===1)return copy(18);if(calls===2)return pending.promise;return copy(id)}});
 await c.select(18);const loading=c.select(17);assert.equal(c.state.detail.phase,'loading');assert.equal(c.state.detail.data,null);
 pending.reject(new Error('network'));await loading;assert.equal(c.state.detail.phase,'error');assert.equal(c.state.detail.data,null);
 await c.retryDetail();assert.equal(c.state.detail.data.alert_id,17);
});
test('detail 404, invalid fields and mismatched alert identity are not normal results',async()=>{
 const notFound=createController({detail:async()=>{throw new AlertNotFound()}});await notFound.select(18);assert.equal(notFound.state.detail.phase,'notfound');
 const bad=copy(18);delete bad.human_required;const invalid=createController({detail:async()=>bad});await invalid.select(18);assert.equal(invalid.state.detail.phase,'invalid');assert.equal(invalid.state.detail.data,null);
 const mismatch=createController({detail:async()=>copy(17)});await mismatch.select(18);assert.equal(mismatch.state.detail.phase,'invalid');
});
test('late detail and list replies cannot overwrite the latest selected request',async()=>{
 const first=deferred(),second=deferred();const c=createController({detail:id=>id===18?first.promise:second.promise});
 const a=c.select(18),b=c.select(17);second.resolve(copy(17));await b;first.resolve(copy(18));await a;assert.equal(c.state.detail.data.alert_id,17);
 const l1=deferred(),l2=deferred();let calls=0;const queries=createController({list:()=>++calls===1?l1.promise:l2.promise});
 const q1=queries.load({level:'CRITICAL',human:''}),q2=queries.load({level:'WARN',human:''});l2.resolve(list([copy(17)]));await q2;l1.resolve(list([copy(18)]));await q1;assert.equal(queries.state.list.data[0].alert_id,17);
});
test('filters clear excluded selections, preserve included selections, and invalidate in-flight detail',async()=>{
 const pending=deferred();let wait=false;
 const c=createController({list:async q=>list(original.filter(a=>!q.level||a.level===q.level)),detail:id=>wait?pending.promise:Promise.resolve(copy(id))});
 await c.load({level:'',human:''},18);await c.load({level:'CRITICAL',human:''});assert.equal(c.state.detail.data.alert_id,18);
 wait=true;const old=c.select(18);await c.load({level:'WARN',human:''});assert.equal(c.state.selected,null);assert.equal(c.state.detail.phase,'idle');pending.resolve(copy(18));await old;assert.equal(c.state.detail.data,null);
});

test('INFO with no signals translates only the defined server summary and preserves response values',()=>{
 const a=copy(15),snapshot=structuredClone(a);validateAlert(a);
 assert.equal(a.level,'INFO');assert.deepEqual(a.signals,[]);
 assert.equal(summaryFor(a),'현재 평가 기준에서 위험 신호 수준이 낮게 분류되었습니다.');
 assert.deepEqual(a.recommended_actions,['no_immediate_action_required']);
 assert.deepEqual(a,snapshot);
 a.reason_summary='another server reason';assert.equal(summaryFor(a),a.reason_summary);
});
test('INFO with missing model version displays uncertainty, null and both actions without reclassification',async()=>{
 const a=structuredClone(infoExample),snapshot=structuredClone(a);validateAlert(a);
 assert.equal(summaryFor(a),'입력된 모델 버전 정보가 없습니다.');
 assert.equal(signalReason(a.signals[0]),'입력된 모델 버전 정보가 없습니다.');
 assert.deepEqual(evidenceValues(a.signals[0].evidence),[{key:'model_version',raw:'null',missing:true}]);
 const c=createController({detail:async()=>a});await c.select(19);
 assert.deepEqual(c.state.detail.data,snapshot);
 assert.deepEqual([a.level,a.human_required,a.risk_score,a.uncertainty_score],['INFO',false,0,1]);
 assert.deepEqual(a.recommended_actions,['review_missing_or_incomplete_information','no_immediate_action_required']);
 assert.equal(a.reason_summary,'risk remains low, while uncertainty is present; action-level caution is recommended');
 a.human_required=true;validateAlert(a);summaryFor(a);assert.equal(a.human_required,true);
});
test('INFO is not a generic no-signal reason; undefined INFO mappings preserve original reasons',()=>{
 const a=structuredClone(infoExample);a.signals[0].rule_id='unmapped_rule';
 assert.equal(summaryFor(a),a.reason_summary);assert.equal(signalReason(a.signals[0]),a.signals[0].reason);
 assert.doesNotMatch(summaryFor(a),/발동된 평가 신호가 없습니다|안전|완료/);
 const b=structuredClone(infoExample);b.signals[0].evidence.model_version='v2';
 assert.equal(summaryFor(b),b.reason_summary);assert.equal(signalReason(b.signals[0]),b.signals[0].reason);
});
