import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createController, validateList, ResponseDataError, AlertNotFound} from '../src/display-contract.mjs';
import {createApiAdapter} from '../src/api-adapter.js';
import {createMockAdapter} from '../src/mock-adapter.js';
import {createDashboard} from '../src/app.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/alerts.json', import.meta.url), 'utf8'));
const copy = id => structuredClone(fixture.alerts.find(a => a.alert_id === id));
const envelope = (alerts = [], limit = 5) => ({count: alerts.length, limit, alerts, next_cursor: null});
const json = value => new Response(JSON.stringify(value));
const defer = () => {let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise, resolve, reject};};

// A DOM sink exercises actual render/event handlers, separately from browser QA.
function view(adapter) {
  const root = {innerHTML: ''}, handlers = new Map();
  const document = {activeElement: null, getElementById(id) {
    if (id === 'app') return root;
    if (!root.innerHTML.includes(`id="${id}"`)) return null;
    return {addEventListener: (type, fn) => handlers.set(`${id}:${type}`, fn), focus() {}};
  }, querySelectorAll() {
    return [...root.innerHTML.matchAll(/data-select="(\d+)"/g)].map(m => ({dataset:{select:m[1]},
      addEventListener: (type, fn) => handlers.set(`select-${m[1]}:${type}`, fn)}));
  }};
  const controller = createDashboard(adapter, document, 'api');
  return {controller, html: () => root.innerHTML,
    event(id, type, value) {
      const fn = handlers.get(`${id}:${type}`); assert.ok(fn, `${id}:${type}`);
      return fn({target:{value}, preventDefault() {}});
    }};
}

test('default 5 and valid 1/37/100 pass through controller, adapter and renderer', async () => {
  const calls = [];
  const h = view(createApiAdapter(async url => {
    calls.push(url);
    const limit = Number(new URL(url, 'http://local').searchParams.get('limit'));
    return json(envelope([copy(17)], limit));
  }));
  await h.controller.load();
  for (const value of ['1','37','100']) {
    await h.event('limit-input', 'input', value);
    assert.equal(calls.length, ['1','37','100'].indexOf(value)+1, 'typing makes no request');
    assert.ok(h.html().includes('미적용'));
    await h.event('limit-form', 'submit');
    assert.equal(h.controller.state.query.limit, Number(value));
    assert.ok(h.html().includes('현재 표시 1건'));
  }
  assert.deepEqual(calls, ['/alerts?limit=5','/alerts?limit=1','/alerts?limit=37','/alerts?limit=100']);
});

test('invalid limit strings make no request and preserve list/detail/applied value', async () => {
  let calls=0;
  const h=view({list:async q=>{calls++;return envelope([copy(18)],q.limit);},detail:async()=>copy(18)});
  await h.controller.load(); await h.controller.select(18);
  const data=h.controller.state.list.data, detail=h.controller.state.detail.data;
  for (const value of ['', '0','-1','101','1.5','word','5x','1e2','9007199254740993']) {
    h.event('limit-input','input',value); await h.event('limit-form','submit');
    assert.equal(calls,1); assert.equal(h.controller.state.query.limit,5);
    assert.equal(h.controller.state.list.data,data); assert.equal(h.controller.state.detail.data,detail);
    assert.ok(h.html().includes('조회 개수는 1~100의 정수로 입력하세요.'));
    assert.ok(!h.html().includes('미적용')); assert.ok(!h.html().includes('Alert를 불러오지 못했습니다.'));
  }
});

test('filters/clear/reset/retry use applied 20, preserve drafts 37 and ID; valid failed apply remains 37', async () => {
  const calls=[]; let fail=false;
  const h=view(createApiAdapter(async url=>{
    calls.push(url); if(fail){fail=false;throw Error('offline');}
    return json(envelope([], Number(new URL(url,'http://local').searchParams.get('limit'))));
  }));
  await h.controller.load(); h.event('limit-input','input','20'); await h.event('limit-form','submit');
  h.event('limit-input','input','37'); h.event('alert-id','input','18');
  await h.event('level','change','WARN'); await h.event('human','change','false');
  await h.event('level','change',''); // Clearing one keeps the other.
  await h.event('reset','click');
  assert.deepEqual(calls.slice(-4), ['/alerts?limit=20&level=WARN', '/alerts?limit=20&level=WARN&human_required=false', '/alerts?limit=20&human_required=false', '/alerts?limit=20']);
  assert.equal(h.controller.state.limitInput.draft,'37'); assert.equal(h.controller.state.idInput.draft,'18');
  assert.ok(h.html().includes('미적용 · 현재 요청 개수 20건'));
  fail=true; await h.event('human','change','true'); await h.event('retry-list','click');
  assert.deepEqual(calls.slice(-2), ['/alerts?limit=20&human_required=true','/alerts?limit=20&human_required=true']);
  fail=true; await h.event('limit-form','submit'); assert.equal(h.controller.state.query.limit,37);
  await h.event('retry-list','click');
  assert.deepEqual(calls.slice(-2), ['/alerts?limit=37&human_required=true','/alerts?limit=37&human_required=true']);
  assert.ok(h.html().includes('value="37"')); assert.ok(h.html().includes('value="18"'));
});

test('full envelopes validate count/limit/cursor and preserve server order and next cursor', async () => {
  const response={...envelope([copy(17),copy(19)]),next_cursor:{alert_id:19,created_at:copy(19).created_at}};
  const c=createController({list:async()=>response}); await c.load();
  assert.deepEqual(c.state.list.data.map(a=>a.alert_id),[17,19]); assert.equal(c.state.list.response,response);
  for (const mutate of [r=>r.count++,r=>r.count='2',r=>r.limit=37,r=>delete r.next_cursor,r=>r.next_cursor={},r=>r.alerts=Array(6).fill(copy(17))]) {
    const bad=structuredClone(response); mutate(bad);
    const h=view({list:async()=>bad}); await h.controller.load();
    assert.equal(h.controller.state.list.phase,'invalid'); assert.ok(h.html().includes('응답 데이터를 확인할 수 없습니다.'));
    assert.ok(!h.html().includes('현재 표시')); assert.ok(!h.html().includes('현재 조회 조건에 맞는 Alert가 없습니다.'));
  }
});

test('list selection clears while querying, refetches same ID independent of position, drops absent ID', async () => {
  const calls=[]; let page=[copy(18),copy(17)]; const pending=defer(); let wait=false;
  const c=createController({list:q=>wait?pending.promise:Promise.resolve(envelope(page,q.limit)),detail:async id=>{calls.push(id);return copy(id);}});
  await c.load(); await c.select(18); page.reverse(); await c.load();
  assert.deepEqual(calls,[18,18]); assert.equal(c.state.selected,18);
  wait=true; const load=c.load({limit:1}); assert.equal(c.state.list.data,null); assert.equal(c.state.detail.data,null); assert.equal(c.state.detail.phase,'loading');
  pending.resolve(envelope([copy(17)],1)); await load;
  assert.equal(c.state.selected,null); assert.equal(c.state.detail.phase,'idle');
});

test('failed/invalid/empty list never restores list-origin detail', async () => {
  for (const outcome of ['error','invalid','empty']) {
    let reload=false; const c=createController({list:async()=>{if(!reload)return envelope([copy(18)]);if(outcome==='error')throw Error();return outcome==='empty'?envelope():{};},detail:async()=>copy(18)});
    await c.load(); await c.select(18); reload=true; await c.load();
    assert.equal(c.state.selected,null); assert.equal(c.state.detail.phase,'idle'); assert.equal(c.state.detail.data,null);
    assert.equal(c.state.list.phase,outcome==='empty'?'success':outcome);
  }
});

test('ID input is exact positive safe integer; invalid inputs preserve results without HTTP', async () => {
  const calls=[]; const h=view(createApiAdapter(async url=>{calls.push(url);return json(url.startsWith('/alerts?')?envelope([copy(17)]):copy(18));}));
  await h.controller.load(); await h.controller.select(18);
  const prior=h.controller.state.detail.data;
  for(const value of ['', '0','-1','1.1','abc','18x','1e1','9007199254740992','9007199254740993']) {
    h.event('alert-id','input',value); assert.equal(calls.length,2); await h.event('id-form','submit');
    assert.equal(calls.length,2); assert.equal(h.controller.state.detail.data,prior); assert.equal(h.controller.state.list.data[0].alert_id,17);
    assert.ok(h.html().includes('Alert ID는 정확하게 표현할 수 있는 양의 정수로 입력하세요.'));
  }
  h.event('alert-id','input','18'); await h.event('id-form','submit');
  assert.equal(calls.at(-1),'/alerts/18'); assert.equal(h.controller.state.detailSource,'direct');
  assert.ok(h.html().includes('ID 직접 조회 · Alert #18')); assert.ok(!h.html().includes('aria-current="true"'));
  const safe=createController({detail:async id=>({...copy(18),alert_id:id})}); safe.setIdDraft(String(Number.MAX_SAFE_INTEGER));await safe.lookupId(); assert.equal(safe.state.detail.phase,'success');
});

test('direct detail HTTP success/404/failure/bad JSON/identity/type errors are distinct and independent of list', async () => {
  const cases=[['success',()=>json(copy(18))], ['notfound',()=>new Response('{}',{status:404})], ['error',()=>new Response('{}',{status:500})], ['error',()=>{throw Error();}], ['invalid',()=>new Response('{')], ['invalid',()=>json(copy(17))], ['invalid',()=>json({...copy(18),risk_score:'0'})]];
  for(const [phase,result] of cases) {
    const h=view(createApiAdapter(async url=>url.startsWith('/alerts?')?new Response('{}',{status:500}):result()));
    await h.controller.load(); h.event('alert-id','input','18'); await h.event('id-form','submit');
    assert.equal(h.controller.state.detail.phase,phase); assert.equal(h.controller.state.list.phase,'error');
    assert.equal(h.controller.state.detailSource,'direct'); assert.ok(h.html().includes('ID 직접 조회 · Alert #18'));
    assert.equal(h.html().includes('id="retry-detail"'),phase==='error');
  }
});

test('same-ID switching keeps last source; retry uses last ID/source rather than edited draft', async () => {
  const calls=[]; let fail=false;
  const h=view({list:async q=>envelope([copy(18)],q.limit),detail:async id=>{calls.push(id);if(fail){fail=false;throw Error();}return copy(id);}});
  await h.controller.load(); await h.event('select-18','click');
  h.event('alert-id','input','18'); await h.event('id-form','submit'); assert.equal(h.controller.state.detailSource,'direct');
  await h.event('select-18','click'); assert.equal(h.controller.state.detailSource,'list');
  fail=true; await h.event('id-form','submit'); h.event('alert-id','input','17'); await h.event('retry-detail','click');
  assert.deepEqual(calls,[18,18,18,18,18]); assert.equal(h.controller.state.detailSource,'direct');assert.equal(h.controller.state.idInput.draft,'17');
  await h.event('close','click'); assert.equal(h.controller.state.selected,null); assert.equal(h.controller.state.detailSource,null); assert.equal(h.controller.state.detail.phase,'idle');
});

test('direct success/error/404/invalid/pending survive every list requery and empty/error/invalid outcomes', async () => {
  for(const detailPhase of ['success','error','notfound','invalid','loading']) {
    for(const listPhase of ['success','error','invalid']) {
      const pending=defer(); const c=createController({list:async q=>{if(listPhase==='error')throw Error();return listPhase==='invalid'?{}:envelope([],q.limit);},detail:()=>{if(detailPhase==='loading')return pending.promise;if(detailPhase==='error')throw Error();if(detailPhase==='notfound')throw new AlertNotFound();return detailPhase==='invalid'?{}:copy(18);}});
      c.setIdDraft('18');const detail=c.lookupId(); if(detailPhase!=='loading')await detail;
      const before=c.state.detail;
      for(const query of [{level:'WARN',human:'false'}, {limit:37},{level:'',human:''}]) {
        await c.load(query); assert.equal(c.state.detail,before); assert.equal(c.state.selected,18); assert.equal(c.state.detailSource,'direct');
      }
      await c.retryList();assert.equal(c.state.detail,before);
      if(detailPhase==='loading'){pending.resolve(copy(18));await detail;assert.equal(c.state.detail.phase,'success');}
    }
  }
});

test('latest limit=100 wins over old limit=37 success and failure', async () => {
  for(const fail of [false,true]) {
    const a=defer(),b=defer();const c=createController({list:q=>q.limit===37?a.promise:b.promise});
    c.setLimitDraft('37');const old=c.applyLimit(); c.setLimitDraft('100');const current=c.applyLimit();
    b.resolve(envelope([copy(17)],100));await current;
    if(fail)a.reject(Error('old failure'));else a.resolve(envelope([copy(18)],37));await old;
    assert.equal(c.state.query.limit,100); assert.equal(c.state.list.phase,'success');assert.equal(c.state.list.data[0].alert_id,17);
  }
});

test('late detail success and failure cannot cross list/direct selections in either direction', async () => {
  for(const firstSource of ['list','direct']) for(const fail of [false,true]) {
    const old=defer(); const c=createController({detail:id=>id===18?old.promise:Promise.resolve(copy(17))});
    const a=c.select(18,firstSource); await c.select(17,firstSource==='list'?'direct':'list');
    if(fail)old.reject(Error());else old.resolve(copy(18));await a;
    assert.equal(c.state.detail.data.alert_id,17);assert.equal(c.state.detailSource,firstSource==='list'?'direct':'list');
  }
});

test('late list candidate restoration cannot overwrite a newer direct lookup, new selection or close', async () => {
  for(const intent of ['direct','list','close']) for(const outcome of ['success','error','invalid']) {
    const pending=defer();let wait=false;const details=[];
    const c=createController({list:()=>wait?pending.promise:Promise.resolve(envelope([copy(18)])),detail:async id=>{details.push(id);return copy(id);}});
    await c.load();await c.select(18);wait=true;const old=c.load();
    if(intent==='close')c.close();else await c.select(17,intent);
    if(outcome==='error')pending.reject(Error());else pending.resolve(outcome==='invalid'?{}:envelope([copy(18)]));await old;
    assert.deepEqual(details,intent==='close'?[18]:[18,17]);
    assert.equal(c.state.selected,intent==='close'?null:17);
    assert.equal(c.state.detail.phase,intent==='close'?'idle':'success');
  }
});

test('close blocks pending direct/list detail success and failure from reappearing', async () => {
  for(const source of ['list','direct']) for(const fail of [false,true]) {
    const pending=defer();const c=createController({detail:()=>pending.promise});const a=c.select(18,source);c.close();
    if(fail)pending.reject(Error());else pending.resolve(copy(18));await a;
    assert.equal(c.state.detail.phase,'idle');assert.equal(c.state.selected,null);
  }
});

test('overlapping list reloads preserve a list candidate only while user intent is unchanged', async () => {
  const a=defer(),b=defer();let n=0;const calls=[];
  const c=createController({list:q=>++n===1?Promise.resolve(envelope([copy(18)],q.limit)):n===2?a.promise:b.promise,detail:async id=>{calls.push(id);return copy(id);}});
  await c.load();await c.select(18);const first=c.load({limit:37}),second=c.load({limit:100});
  b.resolve(envelope([copy(18)],100));await second;a.resolve(envelope([],37));await first;
  assert.deepEqual(calls,[18,18]);assert.equal(c.state.selected,18);
});

test('mock limits/filter AND/preview work across all six fixtures; excluded malformed fixture is not hidden', async () => {
  const adapter=createMockAdapter(fixture,'',0);
  for(const limit of [1,5,37,100]) for(const level of ['', 'INFO','WARN','CRITICAL']) for(const human of ['', 'true','false']) {
    const response=await adapter.list({limit,level,human}); validateList(response,limit);
    const expected=fixture.alerts.filter(a=>(!level||a.level===level)&&(!human||String(a.human_required)===human)).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.alert_id-a.alert_id).slice(0,limit);
    assert.deepEqual(response.alerts,expected);assert.equal(response.count,expected.length);
  }
  for(const preview of ['empty-evidence','empty-signals','empty-actions','values','unknown-failure','unknown-rule']) {
    const c=createController(createMockAdapter(fixture,preview,0));await c.load({},18);assert.equal(c.state.detail.phase,'success');
  }
  const bad=structuredClone(fixture);delete bad.alerts[0].risk_score;
  const c=createController(createMockAdapter(bad,'',0));await c.load({level:'CRITICAL',human:'false',limit:1}); assert.equal(c.state.list.phase,'invalid');
  for(const preview of ['list-invalid','list-error','list-empty']) {const c=createController(createMockAdapter(fixture,preview,0));await c.load();assert.equal(c.state.list.phase,preview==='list-empty'?'success':preview==='list-error'?'error':'invalid');}
});
