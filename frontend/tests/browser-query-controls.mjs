// Playwright CLI QA against the explicitly retained, isolated Day9 TCP evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{evidence:{type:'string'},output:{type:'string'},playwright:{type:'string'},baseline:{type:'string'}}});
assert.ok(values.evidence&&values.output);
const evidence=JSON.parse(fs.readFileSync(values.evidence,'utf8'));
assert.ok(['127.0.0.1','localhost'].includes(new URL(evidence.base).hostname));assert.equal(evidence.row_count,240);
const output=path.resolve(values.output);fs.mkdirSync(output);
const {chromium}=await import(values.playwright?pathToFileURL(path.resolve(values.playwright)).href:'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},recordHar:{path:path.join(output,'network.har'),urlFilter:/\/alerts(?:\?|\/)/}});
const page=await context.newPage();const requests=[],consoleErrors=[],exceptions=[],checks=[],devtools=[];
page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/alerts'))requests.push(r.url());});
page.on('console',m=>{if(m.type()==='error')consoleErrors.push({text:m.text(),url:m.location().url});});page.on('pageerror',e=>exceptions.push(String(e)));
const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');
cdp.on('Network.requestWillBeSent',e=>{if(new URL(e.request.url).pathname.startsWith('/alerts'))devtools.push({event:'request',url:e.request.url,method:e.request.method});});
cdp.on('Network.responseReceived',e=>{if(new URL(e.response.url).pathname.startsWith('/alerts'))devtools.push({event:'response',url:e.response.url,status:e.response.status});});
const check=name=>{checks.push(name);console.log('PASS: '+name);};
const listRequests=()=>requests.filter(url=>new URL(url).pathname==='/alerts');
const rows=()=>page.locator('[data-select]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.select)));
const settled=()=>page.waitForFunction(()=>document.querySelector('#master')?.getAttribute('aria-busy')==='false');
const settledDetail=id=>page.waitForFunction(id=>document.querySelector('#inspector')?.getAttribute('aria-busy')==='false'&&[...document.querySelectorAll('.trace dt')].some(n=>n.textContent.includes('alert_id')&&Number(n.nextElementSibling.textContent)===id),id);
async function listAction(action,expected,append=false){
 const before=listRequests().length,previous=append?await rows():[];
 const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/alerts'),action()]);
 await settled();await page.waitForFunction(()=>!document.querySelector('#more')?.disabled);
 assert.equal(listRequests().length,before+1);
 if(expected)assert.deepEqual(Object.fromEntries(new URL(response.url()).searchParams),expected);
 const body=await response.json();await page.waitForFunction(n=>document.querySelectorAll('[data-select]').length===n,previous.length+body.count);
 assert.deepEqual(await rows(),[...previous,...body.alerts.map(a=>a.alert_id)]);
 assert.equal(await page.locator('.page-count').textContent(),`현재 불러온 ${previous.length+body.count}건`);return body;
}
const submit=()=>page.locator('#query-form button[type=submit]').click();
async function direct(id){
 await page.locator('#alert-id').fill(String(id));
 const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===`/alerts/${id}`),page.locator('#id-form button').click()]);
 assert.equal(new URL(response.url()).search,'');if(response.ok())await settledDetail(id);return response;
}
let baseline=null;
try {
 if(values.baseline){
  assert.ok(['127.0.0.1','localhost'].includes(new URL(values.baseline).hostname));
  const old=await context.newPage();await old.goto(values.baseline+'?mode=mock');await old.locator('.detail-intro').waitFor();
  await old.evaluate(()=>window.originalInput=document.querySelector('#limit-input'));
  await old.locator('#limit-input').fill('123');await old.locator('#limit-input').focus();await old.keyboard.press('Home');await old.keyboard.press('ArrowRight');await old.keyboard.type('98');
  baseline=await old.evaluate(()=>({sameNode:window.originalInput===document.querySelector('#limit-input'),originalConnected:window.originalInput.isConnected,type:document.querySelector('#limit-input').type,caret:document.querySelector('#limit-input').selectionStart,value:document.querySelector('#limit-input').value}));
  assert.equal(baseline.sameNode,false);assert.equal(baseline.originalConnected,false);assert.equal(baseline.caret,null);await old.close();check('Day8 baseline: input node replaced, number input has no selection API; observed middle edit recorded');
 }
 await page.goto(evidence.base+'/dashboard/');await settled();assert.equal((await rows()).length,5);
 assert.deepEqual(Object.fromEntries(new URL(listRequests()[0]).searchParams),{limit:'5',sort_order:'desc'});
 assert.ok((await page.locator('.identity').textContent()).includes('AI 의사결정 모니터'));
 await page.evaluate(()=>{window.limitNode=document.querySelector('#limit-input');window.idNode=document.querySelector('#alert-id');});
 await page.locator('#limit-input').fill('');await page.locator('#limit-input').pressSequentially('37');assert.equal(await page.locator('#limit-input').inputValue(),'37');
 for(const [id,value] of [['level','WARN'],['human','false'],['sort-order','asc']])await page.locator('#'+id).selectOption(value);
 await page.locator('#created-from').fill('2026-10-08T09:01');await page.locator('#created-to').fill('2026-10-08T09:03');
 await page.locator('#alert-id').fill(String(evidence.outside_page_target.alert_id));assert.equal(listRequests().length,1);assert.ok((await page.locator('#query-dirty').textContent()).includes('미적용'));
 let body=await listAction(submit,{limit:'37',level:'WARN',human_required:'false',sort_order:'asc',created_from:'2026-10-08T09:01:00+09:00',created_to:'2026-10-08T09:03:00+09:00'});
 assert.ok(body.alerts.every(a=>a.level==='WARN'&&!a.human_required));check('all draft edits are request-free; one button request with AND, false, KST dates and ascending order');
 await page.locator('#reset').click();assert.equal(listRequests().length,2);assert.equal(await page.locator('#limit-input').inputValue(),'37');assert.equal(await page.locator('#sort-order').inputValue(),'asc');
 await listAction(()=>page.locator('#limit-input').press('Enter'),{limit:'37',sort_order:'asc'});check('reset only draft filters; native Enter issues exactly one new first page');
 for(const limit of ['1','100']){await page.locator('#limit-input').fill(limit);await listAction(submit,{limit,sort_order:'asc'});}
 const firstIds=await rows();const chosen=firstIds[3];await page.locator(`[data-select="${chosen}"]`).click();await settledDetail(chosen);
 await page.locator('#level').selectOption('CRITICAL');await page.locator('#limit-input').fill('37');
 await page.locator('#more').scrollIntoViewIfNeeded();const scroll=await page.evaluate(()=>scrollY);assert.ok(scroll>0,'verify a real nonzero viewport scroll');
 const first=await (await context.request.get(evidence.base+'/alerts?limit=100&sort_order=asc')).json();
 const params={limit:'100',sort_order:'asc',cursor_created_at:first.next_cursor.created_at,cursor_alert_id:String(first.next_cursor.alert_id)};
 body=await listAction(()=>page.locator('#more').click(),params,true);assert.equal((await rows()).length,200);await settledDetail(chosen);
 assert.equal(await page.evaluate(()=>scrollY),scroll);assert.equal(await page.locator('#limit-input').inputValue(),'37');assert.equal(await page.locator('#level').inputValue(),'CRITICAL');
 check('limit 1/37/100; 100+100=200 in server order; more ignores draft and retains selected detail, input and scroll');
 body=await listAction(()=>page.locator('#more').click(),{limit:'100',sort_order:'asc',cursor_created_at:body.next_cursor.created_at,cursor_alert_id:String(body.next_cursor.alert_id)},true);
 assert.equal((await rows()).length,240);assert.equal(await page.locator('#more').count(),0);assert.ok((await page.locator('#pagination').textContent()).includes('더 불러올 Alert가 없습니다.'));
 assert.deepEqual(await rows(),evidence.details.map(a=>a.alert_id));check('ascending walk across identical timestamps: all 240, no duplicate/missing, explicit final cursor state');
 const beforeInvalid=listRequests().length,retained=await rows();
 for(const value of ['', '0','101','1.5','text']){await page.locator('#limit-input').fill(value);await submit();assert.equal(listRequests().length,beforeInvalid);assert.deepEqual(await rows(),retained);await settledDetail(chosen);}
 await page.locator('#limit-input').fill('37');await page.locator('#created-from').fill('2026-10-08T09:03');await page.locator('#created-to').fill('2026-10-08T09:02');await submit();assert.equal(listRequests().length,beforeInvalid);check('invalid limit/range preserve applied results, cursor and detail without HTTP');
 await page.locator('#reset').click();await page.locator('#sort-order').selectOption('desc');await page.locator('#limit-input').fill('100');
 body=await listAction(submit,{limit:'100',sort_order:'desc'});await page.locator('.no-selection').waitFor();assert.equal((await rows()).length,100);check('new applied conditions reset accumulated list/cursor and drop absent first-page candidate');
 const target=evidence.outside_page_target.alert_id;await direct(target);const directHtml=await page.locator('#detail-content').innerHTML();
 const saved=await rows(),failedParams={limit:'100',sort_order:'desc',cursor_created_at:body.next_cursor.created_at,cursor_alert_id:String(body.next_cursor.alert_id)};
 let failUrl;await page.route('**/alerts?*',async route=>{if(new URL(route.request().url()).searchParams.has('cursor_alert_id')){failUrl=route.request().url();await route.fulfill({status:503,contentType:'application/json',body:'{}'});}else await route.continue();});
 await page.locator('#more').click();await page.locator('#pagination [role=alert]').waitFor();assert.deepEqual(await rows(),saved);assert.equal(await page.locator('#detail-content').innerHTML(),directHtml);
 await page.unroute('**/alerts?*');body=await listAction(()=>page.locator('#more').click(),failedParams,true);assert.equal(listRequests().at(-1),failUrl);assert.equal(await page.locator('#detail-content').innerHTML(),directHtml);
 await listAction(()=>page.locator('#more').click(),{limit:'100',sort_order:'desc',cursor_created_at:body.next_cursor.created_at,cursor_alert_id:String(body.next_cursor.alert_id)},true);
 assert.deepEqual(await rows(),evidence.details.map(a=>a.alert_id).reverse());check('additional HTTP failure preserves list/direct result; manual retry sends same applied cursor; descending walk no gaps');
 await page.locator('#limit-input').fill('123');await page.locator('#limit-input').evaluate(n=>{n.focus();n.setSelectionRange(1,1);});await page.keyboard.type('98');assert.equal(await page.locator('#limit-input').inputValue(),'19823');
 await page.keyboard.press('Backspace');assert.equal(await page.locator('#limit-input').inputValue(),'1923');await page.locator('#limit-input').evaluate(n=>n.setSelectionRange(1,1));await page.keyboard.press('Delete');assert.equal(await page.locator('#limit-input').inputValue(),'123');
 await page.locator('#alert-id').fill('123');await page.locator('#alert-id').evaluate(n=>{n.focus();n.setSelectionRange(1,1);});await page.keyboard.type('98');assert.equal(await page.locator('#alert-id').inputValue(),'19823');await page.keyboard.press('Backspace');assert.equal(await page.locator('#alert-id').inputValue(),'1923');check('continuous 37 and middle multi-digit insertion/deletion work for persistent limit and ID nodes');
 let release,entered;const gate=new Promise(r=>release=r),seen=new Promise(r=>entered=r);
 const delayedId=evidence.details[0].alert_id;
 await page.route(`**/alerts/${delayedId}`,async route=>{entered();await gate;await route.continue();});
 await page.locator(`[data-select="${delayedId}"]`).click();await seen;
 await page.locator('#limit-input').fill('123');await page.locator('#limit-input').evaluate(n=>{n.focus();n.setSelectionRange(1,1);});release();await settledDetail(delayedId);
 assert.deepEqual(await page.evaluate(()=>({same:window.limitNode===document.querySelector('#limit-input'),sameId:window.idNode===document.querySelector('#alert-id'),active:document.activeElement.id,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd,value:document.activeElement.value})),{same:true,sameId:true,active:'limit-input',start:1,end:1,value:'123'});
 await page.keyboard.type('9');assert.equal(await page.locator('#limit-input').inputValue(),'1923');await page.unroute(`**/alerts/${delayedId}`);check('async detail response retains original inputs, focus, caret and unapplied draft');
 await page.locator('#limit-input').fill('5');await page.locator('#level').selectOption('INFO');await page.locator('#human').selectOption('true');
 await direct(evidence.missing_id);await listAction(submit,{limit:'5',level:'INFO',human_required:'true',sort_order:'desc'});
 assert.ok((await page.locator('#list-content').textContent()).includes('현재 조회 조건에 맞는 Alert가 없습니다.'));assert.ok((await page.locator('#detail-content').textContent()).includes('해당 Alert를 찾을 수 없습니다.'));check('direct 404 survives an independently successful empty list');
 await page.locator('#reset').click();await listAction(submit,{limit:'5',sort_order:'desc'});await direct(target);
 const layout=await page.evaluate(()=>{const a=document.querySelector('#master').getBoundingClientRect(),b=document.querySelector('#inspector').getBoundingClientRect();return {masterWidth:a.width,inspectorWidth:b.width,leftToRight:a.x<b.x,overflow:document.documentElement.scrollWidth>innerWidth,controls:[...document.querySelectorAll('#query-form input,#query-form select')].map(n=>({id:n.id,width:n.getBoundingClientRect().width,client:n.clientWidth,scroll:n.scrollWidth}))};});
 assert.ok(layout.leftToRight&&!layout.overflow);assert.ok(layout.controls.every(c=>c.width>=180));assert.equal(exceptions.length,0);
 const unexpected=consoleErrors.filter(e=>!(/Failed to load resource/.test(e.text)&&(/\/alerts(?:\?|\/)|\/favicon.ico/.test(e.url))));assert.deepEqual(unexpected,[]);
 assert.ok(devtools.some(e=>e.url.includes('cursor_alert_id')));assert.ok(devtools.some(e=>e.url.includes('created_from')));check('CDP Network records filters/dates/sort/cursor; no JS exceptions or unexpected console errors; query form fits desktop');
 await page.screenshot({path:path.join(output,'dashboard.png'),fullPage:true});
 fs.writeFileSync(path.join(output,'browser-evidence.json'),JSON.stringify({status:'PASS',browser:browser.version(),baseline,checks,requests,devtools,consoleErrors,exceptions,layout},null,2));
} catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});fs.writeFileSync(path.join(output,'browser-evidence.json'),JSON.stringify({status:'FAIL',checks,error:String(error),baseline,requests,consoleErrors,exceptions},null,2));throw error;}
finally{await context.close();await browser.close();}
