// Produce real renderer output for the Python HTML interpretation regression.
import fs from 'node:fs';
import {createDashboard} from '../src/app.js';
const response=JSON.parse(fs.readFileSync(new URL('../fixtures/alerts.json',import.meta.url),'utf8'));
const payload=`\"'><img data-injected=\"yes\" onerror=\"window.__injected=1\"><script>window.__injected=1</script>&한글`;
const alert=structuredClone(response.alerts.find(a=>a.alert_id===18));
Object.assign(alert,{event_id:payload,trace_id:payload,reason_summary:payload,recommended_actions:[payload]});
Object.assign(alert.signals[0],{rule_id:payload,category:payload,reason:payload,evidence:{[payload]:payload}});
const original=structuredClone(alert);
const root={innerHTML:''};
const document={activeElement:null,getElementById(id){return id==='app'?root:{addEventListener(){}};},querySelectorAll(){return [];}};
const controller=createDashboard({list:async()=>({...response,limit:5,alerts:[alert],count:1}),detail:async()=>alert},document);
await controller.load(controller.state.query,18);
controller.setLimitDraft(payload);
controller.setIdDraft(payload);
if(JSON.stringify(alert)!==JSON.stringify(original))throw Error('Renderer changed response data');
console.log(JSON.stringify({payload,html:root.innerHTML,alert}));
