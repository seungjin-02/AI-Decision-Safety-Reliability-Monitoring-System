import {validateList,PreviewNotFound} from './display-contract.mjs';

// Replace this adapter at API integration; no HTTP requests are made here.
export function createMockAdapter(fixtureResponse,scenario='',delayMs=180){
const sample=structuredClone(fixtureResponse);
if(sample?.alerts && ['empty-evidence','empty-signals','empty-actions','unknown-failure','unknown-rule','values'].includes(scenario)){
 const a=sample.alerts.find(a=>a.alert_id===18);
 if(scenario==='empty-evidence')a.signals[0].evidence={};
 if(scenario==='empty-signals')a.signals=[];
 if(scenario==='empty-actions')a.recommended_actions=[];
 if(scenario==='unknown-failure')a.signals[0].evidence.error_code='unmapped_failure';
 if(scenario==='unknown-rule')a.signals[0].rule_id='unmapped_rule';
 if(scenario==='values')Object.assign(a.signals[0].evidence,{zero:0,disabled:false,empty:'',missing:null});
}
const delay=()=>new Promise(resolve=>setTimeout(resolve,delayMs));
let listAttempts=0, detailAttempts=0;
return {
 async list(query){
  const attempt=++listAttempts;
  if(scenario==='list-loading')return new Promise(()=>{});
  await delay();
  if(scenario==='list-error'&&attempt===1)throw new Error('Preview request failure');
  const result=structuredClone(sample);
  if(scenario==='list-invalid'){delete result.alerts[0].risk_score;return result;}
  validateList(result);
  result.alerts=scenario==='list-empty'?[]:result.alerts.filter(a=>(!query.level||a.level===query.level)&&(!query.human||String(a.human_required)===query.human));
  result.count=result.alerts.length;
  return result;
 },
 async detail(id){
  const attempt=++detailAttempts;
  if(scenario==='detail-loading')return new Promise(()=>{});
  await delay();
  if(scenario==='detail-404')throw new PreviewNotFound();
  if(scenario==='detail-error'&&attempt===1)throw new Error('Preview request failure');
  const result=structuredClone(sample.alerts.find(a=>a.alert_id===id));
  if(!result)throw new PreviewNotFound();
  if(scenario==='detail-invalid')delete result.human_required;
  return result;
 }
};
}
