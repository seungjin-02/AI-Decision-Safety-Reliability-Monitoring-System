import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createApiAdapter} from '../src/api-adapter.js';
import {createMockAdapter} from '../src/mock-adapter.js';
import {createController, AlertNotFound, ResponseDataError} from '../src/display-contract.mjs';
import {createDashboard} from '../src/app.js';
import {startDashboard} from '../src/entry.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/alerts.json', import.meta.url), 'utf8'));
const copy = id => structuredClone(fixture.alerts.find(alert => alert.alert_id === id));
const envelope = alerts => ({count: alerts.length, limit: 5, alerts, next_cursor: null});
const json = value => new Response(JSON.stringify(value), {status: 200});

function documentSink(fixtureText = JSON.stringify(fixture)) {
  const root = {innerHTML: ''};
  const handlers = new Map();
  let fixtureReads = 0;
  const document = {
    activeElement: null,
    getElementById(id) {
      if (id === 'app') return root;
      if (id === 'fixtures') {
        fixtureReads++;
        if (fixtureText === null) throw Error('No mock data in API mode');
        return {textContent: fixtureText};
      }
      if (!root.innerHTML.includes(`id="${id}"`)) return null;
      return {addEventListener: (_, handler) => handlers.set(id, handler), focus() {}};
    },
    querySelectorAll() {
      return [...root.innerHTML.matchAll(/data-select="(\d+)"/g)].map(match => ({
        dataset: {select: match[1]},
        addEventListener: (_, handler) => handlers.set(`select-${match[1]}`, handler)
      }));
    }
  };
  return {document, root, handlers, fixtureReads: () => fixtureReads};
}

test('API adapter sends root URLs, limit=5, AND filters and explicit false; returns full envelope', async () => {
  const calls = [];
  const response = {...envelope([copy(17)]), next_cursor: {created_at: copy(17).created_at, alert_id: 17}};
  const adapter = createApiAdapter(async url => {calls.push(url); return json(response);});
  const result = await adapter.list({limit: 5, level: '', human: ''});
  assert.deepEqual(result, response);
  await adapter.list({limit: 5, level: 'WARN', human: 'false'});
  await adapter.list({limit: 5, level: 'CRITICAL', human: 'true'});
  await adapter.detail(231);
  assert.deepEqual(calls, ['/alerts?limit=5', '/alerts?limit=5&level=WARN&human_required=false',
    '/alerts?limit=5&level=CRITICAL&human_required=true', '/alerts/231']);
});

test('HTTP errors precede JSON parsing: detail 404 only is AlertNotFound', async () => {
  let bodyReads = 0;
  for (const status of [404, 500]) {
    const adapter = createApiAdapter(async () => ({status, ok: false, json() {bodyReads++; throw Error('body');}}));
    await assert.rejects(adapter.list({limit: 5, level: '', human: ''}), error =>
      !(error instanceof AlertNotFound) && !(error instanceof ResponseDataError));
    await assert.rejects(adapter.detail(18), error => status === 404
      ? error instanceof AlertNotFound : !(error instanceof ResponseDataError));
  }
  assert.equal(bodyReads, 0);
});

test('network failure and successful malformed JSON have distinct exceptions', async () => {
  await assert.rejects(createApiAdapter(async () => {throw Error('connection');}).detail(1),
    error => !(error instanceof ResponseDataError));
  await assert.rejects(createApiAdapter(async () => new Response('{', {status: 200})).detail(1), ResponseDataError);
});

test('adapter/controller/render show empty, list 404/500, network, bad JSON and missing fields distinctly', async () => {
  const bad = copy(18); delete bad.risk_score;
  const cases = [
    [() => json(envelope([])), 'success', '현재 조회 조건에 맞는 Alert가 없습니다.'],
    [() => new Response('{}', {status: 404}), 'error', 'Alert를 불러오지 못했습니다.'],
    [() => new Response('{}', {status: 500}), 'error', 'Alert를 불러오지 못했습니다.'],
    [() => {throw Error('network');}, 'error', 'Alert를 불러오지 못했습니다.'],
    [() => new Response('{'), 'invalid', '응답 데이터를 확인할 수 없습니다.'],
    [() => json(envelope([bad])), 'invalid', '응답 데이터를 확인할 수 없습니다.']
  ];
  for (const [fetch, phase, text] of cases) {
    const view = documentSink(null);
    const {controller, ready} = startDashboard(view.document, {search: ''}, async () => fetch());
    await ready;
    assert.equal(controller.state.list.phase, phase);
    assert.ok(view.root.innerHTML.includes(text));
    assert.equal(view.root.innerHTML.includes('id="retry-list"'), phase === 'error');
    assert.equal(view.fixtureReads(), 0);
  }
});

test('API mode ignores preview and never reads fixtures, auto-selects 18 or falls back after failure', async () => {
  const view = documentSink(null);
  const calls = [];
  const run = startDashboard(view.document, {search: '?preview=list-empty'}, async url => {
    calls.push(url); return json(envelope([copy(18)]));
  });
  await run.ready;
  assert.deepEqual(calls, ['/alerts?limit=5']);
  assert.equal(run.controller.state.detail.phase, 'idle');
  assert.ok(view.root.innerHTML.includes('로컬 API 연결'));
  assert.ok(view.root.innerHTML.includes('evt_review_018'));
  assert.equal(view.fixtureReads(), 0);
  const failed = documentSink();
  const failure = startDashboard(failed.document, {search: ''}, async () => {throw Error('network');});
  await failure.ready;
  assert.ok(failed.root.innerHTML.includes('Alert를 불러오지 못했습니다.'));
  assert.ok(!failed.root.innerHTML.includes('evt_review_018'));
  assert.equal(failed.fixtureReads(), 0);
});

test('explicit mock mode applies preview and starts with mock selection only', async () => {
  const view = documentSink();
  const run = startDashboard(view.document, {search: '?mode=mock&preview=detail-404'}, async () => {
    assert.fail('Mock must not call HTTP');
  });
  await run.ready;
  assert.equal(run.controller.state.selected, 18);
  assert.equal(run.controller.state.detail.phase, 'notfound');
  assert.ok(view.root.innerHTML.includes('예시 데이터'));
  assert.ok(view.root.innerHTML.includes('해당 Alert를 찾을 수 없습니다.'));
  assert.equal(view.fixtureReads(), 1);
});

test('controller preserves server order and identity; only mock adapter sorts', async () => {
  const unordered = [copy(18), copy(19), copy(17)];
  const controller = createController(createApiAdapter(async () => json(envelope(unordered))));
  await controller.load();
  assert.deepEqual(controller.state.list.data.map(alert => alert.alert_id), [18, 19, 17]);
  const mock = await createMockAdapter(envelope(unordered), '', 0).list({limit: 5, level: '', human: ''});
  const sorted = [...unordered].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.alert_id - a.alert_id);
  assert.deepEqual(mock.alerts, sorted);
  const wrong = createController(createApiAdapter(async () => json(copy(17))));
  await wrong.select(18);
  assert.equal(wrong.state.detail.phase, 'invalid');
});

test('render handlers send filters, actual clicked id, reset and manual retry through the adapter', async () => {
  const view = documentSink(null);
  const calls = [];
  let fail = false;
  const adapter = createApiAdapter(async url => {
    calls.push(url);
    if (fail) {fail = false; throw Error('network');}
    if (url === '/alerts/17') return json(copy(17));
    if (url.includes('CRITICAL')) return json(envelope([]));
    return json(envelope([copy(17)]));
  });
  const controller = createDashboard(adapter, view.document, 'api');
  await controller.load();
  await view.handlers.get('select-17')();
  assert.equal(controller.state.detail.data.alert_id, 17);
  await view.handlers.get('human')({target: {value: 'false'}});
  assert.ok(calls.includes('/alerts?limit=5&human_required=false'));
  await view.handlers.get('level')({target: {value: 'CRITICAL'}});
  assert.equal(controller.state.detail.phase, 'idle');
  assert.ok(view.root.innerHTML.includes('현재 조회 조건에 맞는 Alert가 없습니다.'));
  await view.handlers.get('reset')();
  assert.deepEqual(controller.state.query, {level: '', human: '', limit: 5});
  fail = true;
  await view.handlers.get('human')({target: {value: 'false'}});
  await view.handlers.get('retry-list')();
  assert.deepEqual(calls.slice(-2), ['/alerts?limit=5&human_required=false', '/alerts?limit=5&human_required=false']);
});

test('API detail transition clears previous data while loading, then renders 404/500/invalid', async () => {
  for (const [response, phase] of [[new Response('{}', {status: 404}), 'notfound'],
    [new Response('{}', {status: 500}), 'error'], [json({...copy(17), human_required: 'false'}), 'invalid']]) {
    let resolve;
    const pending = new Promise(done => {resolve = done;});
    const view = documentSink(null);
    const controller = createDashboard(createApiAdapter(url => url === '/alerts/18'
      ? Promise.resolve(json(copy(18))) : pending), view.document, 'api');
    await controller.select(18);
    const request = controller.select(17);
    assert.equal(controller.state.detail.data, null);
    assert.ok(view.root.innerHTML.includes('Alert를 불러오는 중입니다.'));
    assert.ok(!view.root.innerHTML.includes('evt_review_018'));
    resolve(response); await request;
    assert.equal(controller.state.detail.phase, phase);
    assert.equal(controller.state.detail.data, null);
    assert.ok(!view.root.innerHTML.includes('evt_review_018'));
  }
});

test('malformed mock lookup data is invalid rather than TypeError or normal empty/default values', async () => {
  for (const fixture of [undefined, {}, {alerts: null}, {alerts: [null]}, {alerts: [{alert_id: 18}]}]) {
    const controller = createController(createMockAdapter(fixture, '', 0));
    await controller.load();
    assert.equal(controller.state.list.phase, 'invalid');
    await controller.select(18);
    assert.equal(controller.state.detail.phase, 'invalid');
  }
  const bad = copy(18); delete bad.uncertainty_score;
  const controller = createController(createMockAdapter(envelope([bad]), '', 0));
  await controller.load();
  assert.equal(controller.state.list.phase, 'invalid');
  await controller.select(18);
  assert.equal(controller.state.detail.phase, 'invalid');
});
