// CLI browser verification against the retained isolated DB from verify-query-controls.py.
// Playwright is a verification tool, not an application/runtime dependency.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const {values} = parseArgs({options: {evidence:{type:'string'}, output:{type:'string'}, playwright:{type:'string'}}});
assert.ok(values.evidence && values.output, 'Pass --evidence HTTP JSON and --output a new evidence directory');
const evidence = JSON.parse(fs.readFileSync(values.evidence, 'utf8'));
const base = new URL(evidence.base);
assert.ok(['127.0.0.1','localhost'].includes(base.hostname), 'Local demo only');
assert.equal(evidence.row_count,120);
const output = path.resolve(values.output);
fs.mkdirSync(output); // Refuse overwriting an earlier evidence run.
const {chromium} = await import(values.playwright ? pathToFileURL(path.resolve(values.playwright)).href : 'playwright');
const browser = await chromium.launch({channel:'chrome',headless:true});
const context = await browser.newContext({viewport:{width:1440,height:1000},recordHar:{path:path.join(output,'network.har'),urlFilter:/\/alerts(?:\?|\/)/}});
const page = await context.newPage();
const requests=[], consoleErrors=[], exceptions=[], checks=[], devtools=[];
page.on('request', r=>{if(new URL(r.url()).pathname.startsWith('/alerts'))requests.push(r.url().slice(evidence.base.length));});
page.on('console', m=>{if(m.type()==='error')consoleErrors.push({text:m.text(),url:m.location().url});});
page.on('pageerror', e=>exceptions.push(String(e)));
const cdp=await context.newCDPSession(page); await cdp.send('Network.enable');
cdp.on('Network.requestWillBeSent', e=>{if(new URL(e.request.url).pathname.startsWith('/alerts'))devtools.push({event:'request',id:e.requestId,url:e.request.url,method:e.request.method});});
cdp.on('Network.responseReceived', e=>{if(new URL(e.response.url).pathname.startsWith('/alerts'))devtools.push({event:'response',id:e.requestId,url:e.response.url,status:e.response.status});});
const listRequests=()=>requests.filter(url=>url.startsWith('/alerts?'));
const rows=()=>page.locator('[data-select]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.select)));
const check=name=>{checks.push(name);console.log(`PASS: ${name}`);};
async function settledList() {await page.waitForFunction(()=>document.querySelector('.master')?.getAttribute('aria-busy')==='false');}
async function settledDetail(id) {
  await page.waitForFunction(id=>document.querySelector('.inspector')?.getAttribute('aria-busy')==='false' &&
    [...document.querySelectorAll('.trace dt')].some(n=>n.textContent.includes('alert_id') && Number(n.nextElementSibling.textContent)===id),id);
}
async function listAction(action, params) {
  const before=listRequests().length;
  const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/alerts'),action()]);
  await settledList();
  assert.equal(listRequests().length,before+1,'one list request per action');
  const url=new URL(r.url());assert.deepEqual(Object.fromEntries(url.searchParams),params);
  const body=await r.json();assert.deepEqual(await rows(),body.alerts.map(a=>a.alert_id));
  assert.equal(await page.locator('.page-count').textContent(),`현재 표시 ${body.count}건`);
  const expected=evidence.checks.find(c=>c.path===url.pathname+url.search);
  if(expected)assert.deepEqual(body.alerts.map(a=>a.alert_id),expected.ids);
  return body;
}
async function applyLimit(value, enter=false, filters={}) {
  await page.locator('#limit-input').fill(String(value));
  return listAction(()=>enter?page.locator('#limit-input').press('Enter'):page.locator('#limit-form button').click(),{limit:String(value),...filters});
}
async function direct(id, enter=false) {
  await page.locator('#alert-id').fill(String(id));
  const before=requests.length;
  const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===`/alerts/${id}`),
    enter?page.locator('#alert-id').press('Enter'):page.locator('#id-form button').click()]);
  await page.waitForFunction(()=>document.querySelector('.inspector')?.getAttribute('aria-busy')==='false');
  assert.equal(requests.length,before+1,'one detail request per action');
  assert.equal(new URL(r.url()).search,'');
  assert.ok((await page.locator('.inspector-head').textContent()).includes(`ID 직접 조회 · Alert #${id}`));
  if(r.status()===200)await settledDetail(id);
  return r;
}
try {
  await page.goto(evidence.base+'/dashboard/'); await settledList();
  assert.deepEqual(listRequests(),['/alerts?limit=5']); assert.equal((await rows()).length,5);
  assert.equal(await page.locator('#limit-input').getAttribute('type'),'number');check('initial 5, built API mode, native numeric input');
  const before=requests.length;
  await page.locator('#limit-input').fill('37'); await page.locator('#alert-id').fill(String(evidence.outside_page_target.alert_id));
  assert.equal(requests.length,before);check('typing both inputs sends no request');
  await listAction(()=>page.locator('#limit-form button').click(),{limit:'37'});
  await applyLimit(1,true);await applyLimit(100,true);
  assert.equal((await rows()).length,100);check('button and Enter each issue one request; limit 1/37/100 actual rows');
  await applyLimit(20);await page.locator('#limit-input').fill('37');
  await listAction(()=>page.locator('#level').selectOption('WARN'),{limit:'20',level:'WARN'});
  await listAction(()=>page.locator('#human').selectOption('false'),{limit:'20',level:'WARN',human_required:'false'});
  assert.equal(await page.locator('#limit-input').inputValue(),'37');assert.equal(await page.locator('#alert-id').inputValue(),String(evidence.outside_page_target.alert_id));
  assert.equal(await page.locator('#limit-note').textContent(),'미적용 · 현재 요청 개수 20건');
  await listAction(()=>page.locator('#level').selectOption(''),{limit:'20',human_required:'false'});
  await listAction(()=>page.locator('#reset').click(),{limit:'20'});
  assert.equal(await page.locator('#limit-input').inputValue(),'37');check('AND/false, clear one filter, reset only filters, unapplied drafts preserved');
  await page.locator('#limit-input').focus();await page.keyboard.press('End');await page.keyboard.type('8');
  assert.equal(await page.locator('#limit-input').inputValue(),'378');assert.equal(await page.evaluate(()=>document.activeElement.id),'limit-input');
  let count=requests.length;
  for(const invalid of ['', '0','-1','101','1.5']) {
    await page.locator('#limit-input').fill(invalid);await page.locator('#limit-input').press('Enter');
    assert.equal(requests.length,count);assert.equal(await page.locator('#limit-note').textContent(),'조회 개수는 1~100의 정수로 입력하세요.');
    assert.equal((await rows()).length,20);
  }
  check('focus retained while typing; invalid limit does not query or clear current results');
  await applyLimit(37);let ids=await rows();
  const keep=ids[2];await page.locator(`[data-select="${keep}"]`).click();await settledDetail(keep);
  await applyLimit(100);await settledDetail(keep);assert.equal(await page.locator('[aria-current="true"]').getAttribute('data-select'),String(keep));
  ids=await rows();const drop=ids[11];await page.locator(`[data-select="${drop}"]`).click();await settledDetail(drop);
  await applyLimit(5);await page.locator('.no-selection').waitFor();assert.equal(await page.locator('.detail-intro').count(),0);
  check('list ID retained/refetched, selection outside smaller page cleared');
  await listAction(()=>page.locator('#level').selectOption('WARN'),{limit:'5',level:'WARN'});
  const target=evidence.outside_page_target.alert_id; assert.ok(!(await rows()).includes(target));
  await direct(target);assert.equal((await page.locator('.inspector .sev span').textContent()).trim(),'CRITICAL');
  const previousRows=await rows();assert.ok(!previousRows.includes(target));check('outside-page CRITICAL direct lookup from WARN list; no list insertion');
  await page.locator('#alert-id').fill('17');await page.locator('#limit-input').fill('37');
  await listAction(()=>page.locator('#human').selectOption('false'),{limit:'5',level:'WARN',human_required:'false'});await settledDetail(target);
  await applyLimit(37,false,{level:'WARN',human_required:'false'});await settledDetail(target);
  await listAction(()=>page.locator('#reset').click(),{limit:'37'});await settledDetail(target);
  assert.equal(await page.locator('#alert-id').inputValue(),'17');check('direct result survives list filters, limit apply, reset; ID draft retained');
  const clicked=(await rows())[0];await page.locator(`[data-select="${clicked}"]`).click();await settledDetail(clicked);
  assert.ok(!(await page.locator('.inspector-head').textContent()).includes('ID 직접 조회'));
  await direct(clicked,true);await page.locator(`[data-select="${clicked}"]`).click();await settledDetail(clicked);
  assert.ok(!(await page.locator('.inspector-head').textContent()).includes('ID 직접 조회'));await page.locator('#close').click();await page.locator('.no-selection').waitFor();
  await direct(target,true);await page.locator('#close').click();await page.locator('.no-selection').waitFor();
  check('same ID source switching; ID Enter single request; close both sources');
  const r=await direct(evidence.missing_id);assert.equal(r.status(),404);
  assert.ok((await page.locator('.inspector').textContent()).includes('해당 Alert를 찾을 수 없습니다.'));assert.equal(await page.locator('.detail-intro').count(),0);
  await listAction(()=>page.locator('#level').selectOption('INFO'),{limit:'37',level:'INFO'});
  await listAction(()=>page.locator('#human').selectOption('true'),{limit:'37',level:'INFO',human_required:'true'});
  assert.equal((await rows()).length,0);assert.ok((await page.locator('.master').textContent()).includes('현재 조회 조건에 맞는 Alert가 없습니다.'));
  assert.ok((await page.locator('.inspector').textContent()).includes('해당 Alert를 찾을 수 없습니다.'));
  await direct(target);check('real detail 404 survives empty list; direct lookup succeeds from empty list');
  count=requests.length;
  for(const invalid of ['', '0','-1','1.5','abc','9007199254740993']) {
    await page.locator('#alert-id').fill(invalid);await page.locator('#id-form button').click();assert.equal(requests.length,count);await settledDetail(target);
    assert.ok((await page.locator('#id-note').textContent()).includes('양의 정수'));
  }
  check('invalid ID leaves current detail/list intact');
  await listAction(()=>page.locator('#reset').click(),{limit:'37'});await applyLimit(5);await settledDetail(target);
  await page.locator('#alert-id').fill(String(target));
  const layout=await page.evaluate(()=>{
    const master=document.querySelector('.master').getBoundingClientRect(),inspector=document.querySelector('.inspector').getBoundingClientRect();
    return {master:{x:master.x,width:master.width},inspector:{x:inspector.x,width:inspector.width},overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.ok(layout.master.x<layout.inspector.x);assert.ok(!layout.overflow);assert.equal(exceptions.length,0);
  const unexpectedErrors=consoleErrors.filter(e=>!e.text.includes('404') || !(/\/alerts\/|\/favicon.ico/.test(e.url)));
  assert.deepEqual(unexpectedErrors,[]);
  assert.ok(devtools.some(e=>e.event==='request'&&e.url.includes('limit=100')));assert.ok(devtools.some(e=>e.event==='response'&&e.status===404));
  await page.screenshot({path:path.join(output,'dashboard.png'),fullPage:true});check('CDP Network paths/parameters/statuses, no JS errors, 40:60 layout and no horizontal overflow');
  fs.writeFileSync(path.join(output,'browser-evidence.json'),JSON.stringify({status:'PASS',browser:browser.version(),checks,requests,devtools,consoleErrors,exceptions,layout},null,2));
} catch(error) {
  await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});
  fs.writeFileSync(path.join(output,'browser-evidence.json'),JSON.stringify({status:'FAIL',checks,error:String(error),requests,consoleErrors,exceptions},null,2));
  throw error;
} finally {await context.close();await browser.close();}
