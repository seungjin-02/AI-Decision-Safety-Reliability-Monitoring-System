import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createController,queryFromDraft,defaultDraft,ResponseDataError,validateList,timestamp,compareKeys} from '../src/display-contract.mjs';
import {createMockAdapter} from '../src/mock-adapter.js';
import {createApiAdapter} from '../src/api-adapter.js';
import {createDashboard} from '../src/app.js';
import {documentSink} from './dom-sink.mjs';
const base=JSON.parse(fs.readFileSync(new URL('../fixtures/alerts.json',import.meta.url),'utf8')).alerts[0];
const alert=(id,time='2026-10-08T00:00:00.000001Z')=>({...structuredClone(base),alert_id:id,event_id:`page-${id}`,created_at:time});
const page=(ids,limit=2,more=false)=>({count:ids.length,limit,alerts:ids.map(id=>typeof id==='object'?id:alert(id)),next_cursor:more?{alert_id:ids.at(-1)?.alert_id||ids.at(-1)||1,created_at:ids.at(-1)?.created_at||alert(1).created_at}:null});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const json=value=>new Response(JSON.stringify(value));

test('KST explicit offset, half-open dates, one boundary and strict invalid drafts',()=>{
  assert.equal(queryFromDraft({...defaultDraft,created_from:'2026-10-08T09:00'}).created_from,'2026-10-08T09:00:00+09:00');
  assert.equal(queryFromDraft({...defaultDraft,created_to:'2026-10-08T09:00:01.123456'}).created_to,'2026-10-08T09:00:01.123456+09:00');
  for(const changes of [{created_from:'2026-02-30T10:00'},{created_from:'2026-13-08T10:00'},{created_to:'2026-10-08T25:00'},{created_from:'2026-10-08T09:00',created_to:'2026-10-08T09:00'},{created_from:'2026-10-09T09:00',created_to:'2026-10-08T09:00'},{sort_order:'reverse'}])assert.throws(()=>queryFromDraft({...defaultDraft,...changes}));
  assert.equal(timestamp('2026-10-08T09:00:00.123456+09:00'),timestamp('2026-10-08T00:00:00.123456Z'));
  assert.equal(compareKeys(alert(1,'2026-10-08T00:00:00.000002Z'),alert(99)),1,'retain submillisecond precision');
});

for(const sort_order of ['desc','asc']) test(`API controller ${sort_order}: 207 tied timestamps, 200 accumulated, null cursor and precise dates`,async()=>{
  const alerts=Array.from({length:207},(_,i)=>alert(i+1,i<105?'2026-10-08T00:00:00.000001Z':'2026-10-08T00:01:00Z'));
  const adapter=createApiAdapter(async url=>{
    const q=Object.fromEntries(new URL(url,'http://local').searchParams),direction=q.sort_order==='asc'?1:-1;
    const filtered=alerts.filter(a=>(!q.created_from||timestamp(a.created_at)>=timestamp(q.created_from))&&(!q.created_to||timestamp(a.created_at)<timestamp(q.created_to))&&(!q.cursor_created_at||compareKeys(a,{created_at:q.cursor_created_at,alert_id:Number(q.cursor_alert_id)})*direction>0)).sort((a,b)=>compareKeys(a,b)*direction);
    return json(page(filtered.slice(0,Number(q.limit)),Number(q.limit),filtered.length>Number(q.limit)));
  });
  const c=createController(adapter);await c.load({limit:100,sort_order});
  assert.equal(c.state.list.phase,'success');await c.loadMore();assert.equal(c.state.list.data.length,200);
  await c.loadMore();assert.equal(c.state.list.data.length,207);const data=c.state.list.data;
  await c.loadMore();assert.equal(c.state.list.data,data);assert.equal(c.state.list.cursor,null);
  assert.deepEqual(data.map(a=>a.alert_id),Array.from({length:207},(_,i)=>sort_order==='asc'?i+1:207-i));
  await c.load({limit:100,sort_order,created_from:'2026-10-08T09:00:00.000001+09:00',created_to:'2026-10-08T09:01:00+09:00'});
  await c.loadMore();assert.equal(c.state.list.data.length,105);
  await c.load({limit:100,sort_order,created_from:'',created_to:'2026-10-08T09:00:00.000001+09:00'});assert.equal(c.state.list.data.length,0);
  await c.load({limit:100,sort_order,created_from:'2026-10-08T09:01:00+09:00',created_to:''});await c.loadMore();assert.equal(c.state.list.data.length,102);
});

test('more uses applied AND/date/sort/limit and exact server cursor; drafts/reset/invalid submissions preserve state',async()=>{
  const calls=[];const sink=documentSink();
  const c=createDashboard(createApiAdapter(async url=>{calls.push(url);return json(url.startsWith('/alerts/')?alert(10):calls.length===1?page([10,9],2,true):page([8],2));}),sink.document,'api');
  c.setQueryDraft('limit','2');c.setQueryDraft('level','WARN');c.setQueryDraft('human','false');c.setQueryDraft('created_from','2026-10-07T09:00');
  await sink.event('query-form','submit');await c.select(10);
  c.setIdDraft('123');c.setQueryDraft('limit','37');c.resetFilters();
  const snapshot={data:c.state.list.data,cursor:c.state.list.cursor,detail:c.state.detail,query:c.state.query};
  c.setQueryDraft('limit','');await c.applyQuery();assert.equal(calls.length,2,'one list, one detail');
  for(const key of ['data','cursor'])assert.equal(c.state.list[key],snapshot[key]);assert.equal(c.state.detail,snapshot.detail);assert.equal(c.state.query,snapshot.query);
  await sink.event('more','click');
  const query=new URL(calls.at(-1),'http://local').searchParams;
  assert.deepEqual(Object.fromEntries(query),{limit:'2',level:'WARN',human_required:'false',sort_order:'desc',created_from:'2026-10-07T09:00:00+09:00',cursor_created_at:alert(1).created_at,cursor_alert_id:'9'});
  assert.equal(c.state.detail,snapshot.detail);assert.equal(c.state.idInput.draft,'123');assert.equal(c.state.draft.limit,'');
  assert.ok(sink.root.innerHTML.includes('현재 불러온 3건'));assert.ok(sink.root.innerHTML.includes('더 불러올 Alert가 없습니다.'));
});

test('more pending guards double click, retains data/detail and retries the same cursor on failure',async()=>{
  const pending=deferred(),calls=[];let attempt=0;const sink=documentSink();
  const c=createDashboard({list:async q=>{calls.push(q);if(++attempt===1)return page([5,4],2,true);if(attempt===2)return pending.promise;return page([3,2],2,true);},detail:async id=>alert(id)},sink.document);
  await c.load({limit:2});await c.select(5);const before=c.state.list.data,detail=c.state.detail,cursor=c.state.list.cursor;
  const more=sink.event('more','click');await c.loadMore();assert.equal(calls.length,2);assert.equal(c.state.list.data,before);assert.equal(c.state.detail,detail);
  assert.ok(sink.root.innerHTML.includes('id="more" disabled'));pending.reject(Error());await more;
  assert.equal(c.state.list.cursor,cursor);assert.ok(sink.root.innerHTML.includes('추가 Alert를 불러오지 못했습니다.'));
  c.setQueryDraft('sort_order','asc');await sink.event('more','click');assert.deepEqual(calls[1],calls[2]);assert.equal(c.state.list.data.length,4);assert.equal(c.state.detail,detail);
});

test('malformed JSON is additional response error; HTTP failure is request error',async()=>{
  for(const [response,phase] of [[new Response('{'),'invalid'],[new Response('{}',{status:500}),'error']]) {
    let calls=0;const sink=documentSink();const c=createDashboard(createApiAdapter(async()=>++calls===1?json(page([5,4],2,true)):response),sink.document);
    await c.load({limit:2});const data=c.state.list.data,cursor=c.state.list.cursor;await c.loadMore();
    assert.equal(c.state.list.more.phase,phase);assert.equal(c.state.list.data,data);assert.equal(c.state.list.cursor,cursor);
    assert.ok(sink.root.innerHTML.includes(phase==='invalid'?'추가 응답 데이터를 확인할 수 없습니다.':'추가 Alert를 불러오지 못했습니다.'));
  }
});

test('bad additional pages are atomic: duplicates, ordering, boundary, cursor mismatch/progression and empty contradiction',async()=>{
  const mutations=[r=>r.alerts[1]=alert(3),r=>r.alerts[1]=alert(5),r=>r.alerts.reverse(),r=>r.alerts[0]=alert(4),r=>r.next_cursor.alert_id=3,r=>r.next_cursor.alert_id=4,r=>{r.alerts=[];r.count=0;},r=>{r.alerts.pop();r.count=1;},r=>delete r.alerts[1].human_required,r=>r.alerts[1].uncertainty_score='0',r=>r.limit=100];
  for(const mutate of mutations){let first=true;const bad=page([3,2],2,true);mutate(bad);const c=createController({list:async()=>{if(first){first=false;return page([5,4],2,true);}return bad;},detail:async id=>alert(id)});
    await c.load({limit:2});await c.select(5);const data=c.state.list.data,cursor=c.state.list.cursor,detail=c.state.detail;await c.loadMore();
    assert.equal(c.state.list.more.phase,'invalid');assert.equal(c.state.list.data,data);assert.equal(c.state.list.cursor,cursor);assert.equal(c.state.detail,detail);
  }
});

test('first-page validation rejects unordered/duplicate IDs and inconsistent cursor without sorting or deduplication',()=>{
  for(const bad of [page([2,3]),page([3,3]),page([],2,true),{...page([3]),next_cursor:{alert_id:3,created_at:alert(1).created_at}}])assert.throws(()=>validateList(bad,2,{sort_order:'desc'}),ResponseDataError);
  const response=page([alert(3,'2026-10-08T09:00:00.000001+09:00'),alert(2)],2,true);
  response.next_cursor.created_at='2026-10-08T09:00:00.000001+09:00';validateList(response,2,{sort_order:'desc'});
});

test('new first page invalidates previous more success/failure and old first page without disturbing direct detail',async()=>{
  for(const fail of [false,true]){
    const pending=deferred();let n=0;const c=createController({list:async q=>{n++;if(n===1)return page([5,4],2,true);if(n===2)return pending.promise;return page([1],q.limit);},detail:async id=>alert(id)});
    await c.load({limit:2});await c.select(7,'direct');const detail=c.state.detail;
    const old=c.loadMore();await c.load({limit:1,sort_order:'asc'});
    if(fail)pending.reject(Error());else pending.resolve(page([3,2],2));await old;
    assert.deepEqual(c.state.list.data.map(a=>a.alert_id),[1]);assert.equal(c.state.list.more.phase,'idle');assert.equal(c.state.detail,detail);
  }
});

test('candidate absent on first page is never restored by more; direct/close/new select defeats first-page restoration',async()=>{
  let n=0;const details=[];const c=createController({list:async()=>++n===1?page([5,4],2,true):n===2?page([3,2],2,true):page([1],2),detail:async id=>{details.push(id);return alert(id);}});
  await c.load({limit:2});await c.select(1);await c.load();await c.loadMore();assert.equal(c.state.selected,null);assert.deepEqual(details,[1]);
  for(const intent of ['direct','close','list']){
    const pending=deferred();let wait=false;const requests=[];const controller=createController({list:async()=>wait?pending.promise:page([5,4],2,true),detail:async id=>{requests.push(id);return alert(id);}});
    await controller.load({limit:2});await controller.select(5);wait=true;const load=controller.load();
    if(intent==='close')controller.close();else await controller.select(9,intent);
    pending.resolve(page([5,4],2,true));await load;assert.deepEqual(requests,intent==='close'?[5]:[5,9]);assert.equal(controller.state.selected,intent==='close'?null:9);
  }
});

test('direct pending/notfound/error/invalid and success remain independent across more results',async()=>{
  for(const phase of ['loading','notfound','error','invalid','success'])for(const moreResult of ['success','error','invalid']){
    const pending=deferred();let first=true;const c=createController({list:async()=>{if(first){first=false;return page([5,4],2,true);}if(moreResult==='error')throw Error();return moreResult==='invalid'?{}:page([3],2);},detail:()=>pending.promise});
    await c.load({limit:2});const request=c.select(9,'direct');
    if(phase==='notfound'){const {AlertNotFound}=await import('../src/display-contract.mjs');pending.reject(new AlertNotFound());}
    else if(phase==='error')pending.reject(Error());else if(phase==='invalid')pending.resolve({});else if(phase==='success')pending.resolve(alert(9));
    if(phase!=='loading')await request;const detail=c.state.detail;await c.loadMore();assert.equal(c.state.detail,detail);assert.equal(c.state.detailSource,'direct');
    if(phase==='loading'){pending.resolve(alert(9));await request;}
  }
});

test('mock preserves the same half-open dates, direction and cursor pair',async()=>{
 const alerts=Array.from({length:6},(_,i)=>alert(i+1,i<3?'2026-10-08T00:00:00Z':'2026-10-08T00:01:00Z'));
 const c=createController(createMockAdapter({count:6,limit:20,alerts,next_cursor:null},'',0));
 for(const sort_order of ['desc','asc']) {
  await c.load({limit:2,sort_order,created_from:'2026-10-08T09:00:00+09:00',created_to:'2026-10-08T09:01:00+09:00'});await c.loadMore();
  assert.deepEqual(c.state.list.data.map(a=>a.alert_id),sort_order==='asc'?[1,2,3]:[3,2,1]);assert.equal(c.state.list.cursor,null);
 }
});

test('same applied submit is a fresh page, invalid date does not erase accumulated state, late replies retain form nodes',async()=>{
 let first=true;const pending=deferred();const calls=[];const sink=documentSink();
 const c=createDashboard({list:async q=>{calls.push(q);if(first){first=false;return page([5,4],2,true);}return pending.promise;},detail:async id=>alert(id)},sink.document);
 c.setQueryDraft('limit','2');await sink.event('query-form','submit');await c.select(5,'direct');
 const input=sink.document.getElementById('limit-input'),idInput=sink.document.getElementById('alert-id'),data=c.state.list.data,cursor=c.state.list.cursor,detail=c.state.detail;
 c.setQueryDraft('created_from','2026-02-30T09:00');await sink.event('query-form','submit');assert.equal(calls.length,1);assert.equal(c.state.list.data,data);assert.equal(c.state.list.cursor,cursor);assert.equal(c.state.detail,detail);
 c.resetFilters();const request=sink.event('query-form','submit');assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(c.state.list.data,null);assert.equal(c.state.list.cursor,null);assert.equal(c.state.detail,detail);
 c.setQueryDraft('limit','37');c.setIdDraft('123');pending.resolve(page([5,4],2,true));await request;
 assert.equal(sink.document.getElementById('limit-input'),input);assert.equal(sink.document.getElementById('alert-id'),idInput);assert.equal(c.state.draft.limit,'37');assert.equal(c.state.query.limit,2);
});
