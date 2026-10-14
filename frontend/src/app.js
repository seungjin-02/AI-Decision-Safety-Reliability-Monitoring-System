import {summaryFor,signalReason,evidenceValues,statusText,createController,queryIsDirty} from './display-contract.mjs';
const esc = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  mark:'<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
  down:'<path d="m7 10 5 5 5-5"/>',
  critical:'<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v4m0 4h.01"/>',
  warn:'<path d="m12 3 9 9-9 9-9-9 9-9Z"/><path d="M12 8v5m0 3h.01"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  person:'<circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  minus:'<path d="M6 12h12"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trace:'<path d="M4 6h10M4 12h16M4 18h10"/>',
  sort:'<path d="M8 4v16m-4-4 4 4 4-4M15 6h5m-5 5h4m-4 5h3"/>',
  list:'<path d="M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
const actionNames = {human_review_required:'사람의 검토 수행',immediate_investigation:'즉시 조사',escalate_incident:'사고 대응 단계로 전달',monitor_closely:'주의 깊게 모니터링',review_missing_or_incomplete_information:'누락되거나 불완전한 정보 검토',no_immediate_action_required:'즉각적인 조치 요구 없음'};
const categoryNames={risk:'위험 신호',uncertainty:'불확실성 신호',failure:'실패 신호'};
function timeParts(alert) {
  const date = new Date(new Date(alert.created_at).getTime() + 9 * 3600000).toISOString();
  return {date: date.slice(0, 10).replaceAll('-', '.'), time: date.slice(11, 19)};
}
function levelIcon(level) {
  if (level === 'CRITICAL') return icon('critical');
  if (level === 'WARN') return icon('warn');
  return icon('info');
}
const sev = a => `<span class="sev ${a.level}">${levelIcon(a.level)}<span>${a.level}</span>
    </span>`;
const review = a => `<span class="review-status ${a.human_required?'':'none'}">${icon(a.human_required?'person':'minus')}<span>${a.human_required?'검토 필요':'검토 요구 없음'}</span>
    </span>`;
const policy = `${icon('info')}<span>검토 요구 없음은 안전 또는 처리 완료를 의미하지 않습니다.</span>`;
function queryInputs(state) {
  const d = state.draft;
  return `<form id="query-form" class="query-form" novalidate>
    <div class="query-grid">
      <div class="filter"><label for="limit-input">요청당 조회 개수</label><input id="limit-input" type="text" inputmode="numeric" autocomplete="off" value="${esc(d.limit)}" aria-describedby="query-error"></div>
      <div class="filter"><label for="sort-order">생성순 정렬</label><select id="sort-order"><option value="desc" ${d.sort_order==='desc'?'selected':''}>최신 생성순</option><option value="asc" ${d.sort_order==='asc'?'selected':''}>오래된 생성순</option></select></div>
      <div class="filter"><label for="level">평가 수준</label><select id="level"><option value="">전체 수준</option>${['INFO','WARN','CRITICAL'].map(v=>`<option ${v===d.level?'selected':''}>${v}</option>`).join('')}</select></div>
      <div class="filter"><label for="human">사람 검토</label><select id="human"><option value="">전체 검토 요구</option><option value="true" ${d.human==='true'?'selected':''}>검토 필요</option><option value="false" ${d.human==='false'?'selected':''}>검토 요구 없음</option></select></div>
      <div class="filter date-filter"><label for="created-from">생성 시작 · KST</label><input id="created-from" type="datetime-local" step="1" value="${esc(d.created_from)}"></div>
      <div class="filter date-filter"><label for="created-to">생성 종료 · KST</label><input id="created-to" type="datetime-local" step="1" value="${esc(d.created_to)}"></div>
    </div>
    <p class="input-note">개수 1~100 · Alert 저장 시각 기준 · 시작 포함 / 종료 미포함</p>
    <div class="query-actions"><button type="submit">조회</button><button type="button" id="reset" class="filter-reset">필터 초기화</button><span id="query-dirty" role="status"></span></div>
    <p id="query-error" class="input-error" role="alert" tabindex="-1"></p>
    <p id="applied-query" class="applied-query"></p>
  </form>`;
}
function idInput(state) {
  return `<form id="id-form" class="query-input direct-query" novalidate>
    <label for="alert-id">Alert ID</label>
    <div class="query-line"><input id="alert-id" type="text" inputmode="numeric" autocomplete="off" value="${esc(state.idInput.draft)}" aria-describedby="id-note" aria-invalid="${Boolean(state.idInput.error)}">
    <button type="submit">상세 조회</button></div>
    <p id="id-note" class="input-note ${state.idInput.error ? 'input-error' : ''}" ${state.idInput.error ? 'role="alert"' : ''}>${esc(state.idInput.error || '목록 조건과 별도로 양의 정수 ID를 조회합니다.')}</p>
    </form>`;
}
function rows(items, selected) {
  return items.map(a=>`<article id="row-${a.alert_id}" class="inbox-row ${a.alert_id===selected?'selected':''}" aria-label="${esc(a.event_id)}">
    <time class="row-time" datetime="${a.created_at}"><span>${timeParts(a).time}</span><span>${timeParts(a).date}</span></time>
    ${sev(a)}
    <div class="inbox-main">
    <p class="inbox-summary">${esc(summaryFor(a))}</p>
    <span class="mono quiet">${esc(a.event_id)}</span>
    </div>
    ${review(a)}
    <button class="view-action" data-select="${a.alert_id}" aria-label="${esc(a.event_id)} 상세 보기" ${a.alert_id===selected?'aria-current="true"':''}><span>상세</span>${icon('arrow')}</button>
    </article>`).join('');
}
function queue(items, selected) {
  return `<div class="master-guide" aria-hidden="true"><span>생성 시각 · KST</span><span>평가 수준</span><span>평가 사유 · event_id</span><span>사람 검토</span><span></span></div><div id="alert-rows" class="inbox-list">${rows(items,selected)}</div>`;
}
function scores(a){
  return `<div class="scores">
    <div class="score-row">
    <div>
    <div class="score-label">위험 점수</div>
    <code>risk_score</code>
    </div>
    <div class="score-value">${a.risk_score}</div>
    </div>
    <div class="score-row">
    <div>
    <div class="score-label">불확실성 점수</div>
    <code>uncertainty_score</code>
    </div>
    <div class="score-value">${a.uncertainty_score}</div>
    </div>
    </div>
    <p class="score-note">점수는 범주별 신호 점수 합계입니다.${a.signals.some(s=>s.is_critical_override)?'<br>서버 응답에 강제 CRITICAL 규칙 적용이 표시되어 있습니다.':''}</p>`;
}
function signals(alert) {
  if (alert.signals.length === 0) {
    return '<p class="empty-signals">발동된 평가 신호가 없습니다.</p>';
  }
  return alert.signals.map(signal => {
    const category = Object.hasOwn(categoryNames, signal.category)
      ? categoryNames[signal.category] : esc(signal.category);
    let evidence = '<p class="empty-evidence">표시할 판단 근거가 없습니다.</p>';
    if (Object.keys(signal.evidence).length > 0) {
      const rows = evidenceValues(signal.evidence).map(value => `<div class="evidence-row">
        <code class="key">${esc(value.key)}</code>
        <div class="${value.missing ? 'missing-evidence' : ''}">${value.missing ? '<span>입력값 없음</span>' : ''}<code>${esc(value.raw)}</code></div>
      </div>`).join('');
      evidence = `<div class="evidence">${rows}</div>`;
    }
    const overrideNote = signal.is_critical_override
      ? '<span>서버의 강제 CRITICAL 규칙 적용</span>' : '';
    return `<article class="signal">
      <div class="signal-top">
        <code>${esc(signal.rule_id)}</code><span class="category">${category}</span>
      </div>
      <div class="signal-content">
        <p class="signal-reason">${esc(signalReason(signal))}</p>
        <details class="raw-reason">
          <summary>사유 원문 보기</summary><code>${esc(signal.reason)}</code>
        </details>
        <div class="evidence-title"><span>판단 근거</span><code>evidence</code></div>
        ${evidence}
        <div class="signal-notes"><span>신호 점수 <code>${signal.score}</code></span>${overrideNote}</div>
      </div>
    </article>`;
  }).join('');
}
function trace(a){
  return `<section class="trace" aria-labelledby="trace-title">
    <h2 id="trace-title" class="trace-label">${icon('trace')}추적 정보</h2>
    <dl>
    <div>
    <dt>이벤트 식별자 · event_id</dt>
    <dd>${esc(a.event_id)}</dd>
    </div>
    <div>
    <dt>생성 요청 · trace_id</dt>
    <dd>${esc(a.trace_id)}</dd>
    </div>
    <div>
    <dt>생성 시각 · KST</dt>
    <dd>${timeParts(a).date} ${timeParts(a).time}</dd>
    </div>
    <div>
    <dt>Alert 번호 · alert_id</dt>
    <dd>${a.alert_id}</dd>
    </div>
    </dl>
    </section>`;
}
function detail(a) {
  let actions = '<p class="empty-actions">제공된 권장 조치가 없습니다.</p>';
  if (a.recommended_actions.length > 0) {
    const rows = a.recommended_actions.map((code, index) => {
      const name = Object.hasOwn(actionNames, code) ? actionNames[code] : esc(code);
      return `<li>
        <span class="action-index mono">${String(index + 1).padStart(2, '0')}</span>
        <div><span class="action-name">${name}</span><code class="action-code">${esc(code)}</code></div>
      </li>`;
    }).join('');
    actions = `<ol class="recommendations">${rows}</ol>`;
  }
  return `<header class="detail-intro">
    <div class="detail-meta">
    <span class="mono">${esc(a.event_id)}</span>
    <span>${timeParts(a).date} ${timeParts(a).time} KST</span>
    </div>
    <h2>${esc(summaryFor(a))}</h2>
    <details class="raw-reason summary-original">
    <summary>평가 사유 원문 보기</summary>
    <code>${esc(a.reason_summary)}</code>
    </details>
    <div class="decision-strip">
    <div class="field">
    <span class="cap">사람 검토</span>${review(a)}</div>
    <div class="field">
    <span class="cap">평가 수준</span>${sev(a)}</div>
    </div>${!a.human_required?'<p class="detail-policy small quiet">검토 요구 없음은 안전 또는 처리 완료를 의미하지 않습니다.</p>':''}</header>
    <div class="assessment-scores">${scores(a)}</div>
    <section class="reading-section" aria-labelledby="signals-title">
    <div class="section-header">
    <h2 id="signals-title">평가 신호와 판단 근거</h2>
    <span class="cap">signals</span>
    </div>${signals(a)}</section>
    <section class="reading-section" aria-labelledby="actions-title">
    <div class="section-header">
    <h2 id="actions-title">권장 조치</h2>
    <span class="cap">recommended_actions</span>
    </div>${actions}</section>${trace(a)}`;
}
function stateMessage(phase,where){
  return `<div class="state-message" role="${['error','invalid','notfound'].includes(phase)?'alert':'status'}">
    <p>${statusText[phase]}</p>${phase==='error'?`<button id="retry-${where}">다시 시도</button>`:''}</div>`;
}
// Forms are mounted once. Async results only update list/detail regions;
// appended pages retain the original row nodes and the master scroll position.
const rendered = new WeakMap();
const draftControls = {'limit-input':'limit',level:'level',human:'human','created-from':'created_from','created-to':'created_to','sort-order':'sort_order'};
const readingViews = {
  explore: {label:'탐색', title:'Alert 탐색'},
  investigate: {label:'조사', title:'선택한 Alert 조사'},
  focus: {label:'집중 읽기', title:'집중 읽기'}
};
// Presentation only: view changes never invoke the adapter or remount content.
function showReadingView(cache, document, view) {
  cache.view = view;
  document.getElementById('dashboard').setAttribute('data-layout',view);
  document.getElementById('view-title').textContent = readingViews[view].title;
  for (const name of Object.keys(readingViews)) {
    document.getElementById(`view-${name}`).setAttribute('aria-pressed',String(name===view));
  }
  for (const [id,hidden] of [['query-tools',view==='focus'],['master',view==='focus'],['inspector',view==='explore']]) {
    const node = document.getElementById(id);
    if (hidden) node.setAttribute('hidden',''); else node.removeAttribute('hidden');
  }
  if (document.activeElement?.closest?.('[hidden]')) document.getElementById(`view-${view}`).focus();
}
// Only explicit user actions move focus. Async renders retain the same anchor.
function openDetail(cache, document, request, opener) {
  if (!request) return;
  cache.detailOpener = opener;
  if (cache.view==='explore') showReadingView(cache,document,'investigate');
  document.getElementById('detail-head').focus();
}
function visible(element) {
  return Boolean(element?.isConnected && !element.closest('[hidden]') && element.getClientRects().length);
}
function restoreDetailFocus(cache, document) {
  const opener = cache.detailOpener;
  const original = opener?.kind==='list'
    ? [...document.querySelectorAll('[data-select]')].find(button=>Number(button.dataset.select)===opener.id)
    : document.getElementById('alert-id');
  const target = visible(original) ? original : document.getElementById('list-title');
  (visible(target) ? target : document.getElementById(`view-${cache.view}`)).focus();
  cache.detailOpener = null;
}
export function renderDashboard(state, document, controller, mode = 'mock') {
  const root = document.getElementById('app');
  let cache = rendered.get(root);
  if (!cache) {
    root.innerHTML = `<header class="mast"><div class="identity"><span class="mark">${icon('mark')}</span><span>AI 의사결정 모니터</span></div><div class="mast-right"><span class="small">내부 운영</span><span class="mast-divider"></span><span class="environment">${mode==='api'?'로컬 API 연결':'예시 데이터'}</span><span class="prototype-note">C2 · 검토용</span></div></header>
      <main id="dashboard" class="dashboard" data-layout="explore">
      <header class="workspace-head"><div><p class="eyebrow">DECISION RELIABILITY / ALERTS</p><h1 id="view-title">Alert 탐색</h1><p class="workspace-description">조회 조건을 적용해 탐색하고, 선택한 Alert의 근거를 읽습니다.</p></div>
      <div class="reading-views" role="group" aria-label="화면 보기">${Object.entries(readingViews).map(([name,view])=>`<button id="view-${name}" type="button" aria-pressed="${name==='explore'}">${esc(view.label)}</button>`).join('')}</div></header>
      <section id="query-tools" class="query-tools" aria-label="Alert 조회"><div class="query-shell"><h2>조회 조건</h2>${queryInputs(state)}</div>${idInput(state)}</section>
      <div class="split"><section id="master" class="master" aria-labelledby="list-title"><header class="master-head"><div class="list-heading"><h2 id="list-title" tabindex="-1">Alert 목록</h2><span class="sort">${icon('clock')}생성 시각 · KST</span></div><p class="list-reading-note">긴 사유는 최대 3줄, 식별자는 2줄로 표시합니다. 전체 내용은 상세에서 확인하세요.</p></header><div id="list-content"></div><div id="pagination"></div><p class="master-foot">${policy}</p></section>
      <aside id="inspector" class="inspector" aria-label="선택한 Alert 상세" hidden=""><div id="detail-head" class="inspector-head" tabindex="-1" role="group" aria-labelledby="detail-target"></div><div id="detail-content"></div></aside></div></main>`;
    cache = {buttons: new WeakSet(),view:'explore'};
    rendered.set(root, cache);
    for (const name of Object.keys(readingViews)) {
      document.getElementById(`view-${name}`).addEventListener('click',()=>showReadingView(cache,document,name));
    }
    for (const [id,name] of Object.entries(draftControls)) {
      const event = ['level','human','sort-order'].includes(id) ? 'change' : 'input';
      document.getElementById(id).addEventListener(event,e=>controller.setQueryDraft(name,e.target.value));
    }
    document.getElementById('reset').addEventListener('click',()=>controller.resetFilters());
    // Native submit covers both Enter and the submit button exactly once.
    document.getElementById('query-form').addEventListener('submit',e=>{
      e.preventDefault();const request=controller.applyQuery();
      if (!request) document.getElementById('query-error').focus();
      return request;
    });
    document.getElementById('alert-id').addEventListener('input',e=>controller.setIdDraft(e.target.value));
    document.getElementById('id-form').addEventListener('submit',e=>{
      e.preventDefault();
      const request = controller.lookupId();
      openDetail(cache,document,request,{kind:'direct'});
      if (!request) document.getElementById('alert-id').focus();
      return request;
    });
  }
  for (const [id,name] of Object.entries(draftControls)) {
    const input = document.getElementById(id);
    if (input.value !== state.draft[name]) input.value = state.draft[name];
    input.setAttribute('aria-invalid',String(Boolean(state.queryError)));
    input.setAttribute('aria-describedby','query-error');
  }
  const idControl = document.getElementById('alert-id');
  if (idControl.value !== state.idInput.draft) idControl.value = state.idInput.draft;
  idControl.setAttribute('aria-invalid',String(Boolean(state.idInput.error)));
  const idNote=document.getElementById('id-note');
  const idMessage=state.idInput.error || '목록 조건과 별도로 양의 정수 ID를 조회합니다.';
  if (cache.idMessage!==idMessage) {idNote.textContent=idMessage;cache.idMessage=idMessage;}
  idNote.classList.toggle('input-error',Boolean(state.idInput.error));
  if (state.idInput.error) idNote.setAttribute('role','alert'); else idNote.removeAttribute('role');
  document.getElementById('query-dirty').textContent = queryIsDirty(state) ? '조회 조건 변경 · 미적용' : '';
  document.getElementById('query-error').textContent = state.queryError;
  const q = state.query;
  document.getElementById('applied-query').textContent = `적용 조건 · 요청당 ${q.limit}건 · ${q.level||'전체 수준'} · ${q.human===''?'전체 검토 요구':q.human==='true'?'검토 필요':'검토 요구 없음'} · ${q.sort_order==='asc'?'오래된':'최신'} 생성순 · ${q.created_from ? q.created_from.replace('+09:00',' KST') : '시작 제한 없음'} → ${q.created_to ? q.created_to.replace('+09:00',' KST')+' 미포함' : '종료 제한 없음'}`;
  document.getElementById('master').setAttribute('aria-busy',String(state.list.phase==='loading'));
  document.getElementById('inspector').setAttribute('aria-busy',String(state.detail.phase==='loading'));
  const selected = state.detailSource==='list' ? state.selected : null;
  if (cache.listData !== state.list.data || cache.listPhase !== state.list.phase) {
    const region = document.getElementById('list-content');
    const old = cache.listData, current = state.list.data;
    const append = cache.listPhase==='success' && state.list.phase==='success' && old?.length && current.length>old.length && old.every((a,i)=>a===current[i]);
    if (append) document.getElementById('alert-rows').insertAdjacentHTML('beforeend',rows(current.slice(old.length),selected));
    else region.innerHTML = state.list.phase==='success' ? (current.length ? queue(current,selected) : stateMessage('empty','list')) : stateMessage(state.list.phase,'list');
    cache.listData = current; cache.listPhase = state.list.phase;
  }
  document.querySelectorAll('[data-select]').forEach(button=>{
    const chosen = Number(button.dataset.select)===selected;
    document.getElementById(`row-${button.dataset.select}`).classList.toggle('selected',chosen);
    if (chosen) button.setAttribute('aria-current','true'); else button.removeAttribute('aria-current');
    if (!cache.buttons.has(button)) {
      button.addEventListener('click',()=>{
        const id=Number(button.dataset.select),request=controller.select(id);
        openDetail(cache,document,request,{kind:'list',id});
        return request;
      });
      cache.buttons.add(button);
    }
  });
  let pagination = '', moreMessage='', morePhase='idle';
  if (state.list.phase==='success') {
    const phase=state.list.more.phase;
    const message = phase==='loading'?'추가 Alert를 불러오는 중입니다.':phase==='error'?'추가 Alert를 불러오지 못했습니다.':phase==='invalid'?'추가 응답 데이터를 확인할 수 없습니다.':state.list.cursor?'':'더 불러올 Alert가 없습니다.';
    moreMessage=message;morePhase=phase;
    pagination = `<span id="page-count" class="page-count">현재 불러온 ${state.list.data.length}건</span><p id="more-status" role="${['error','invalid'].includes(phase)?'alert':'status'}">${message}</p>${state.list.cursor?`<button id="more" aria-disabled="${phase==='loading'}">${['error','invalid'].includes(phase)?'다시 시도':'더보기'}</button>`:''}`;
  }
  if (cache.pagination !== pagination) {
    const previousMore=document.getElementById('more');
    const moreFocused=previousMore && document.activeElement===previousMore;
    if (previousMore && state.list.phase==='success' && state.list.cursor) {
      document.getElementById('page-count').textContent=`현재 불러온 ${state.list.data.length}건`;
      const status=document.getElementById('more-status');status.textContent=moreMessage;
      status.setAttribute('role',['error','invalid'].includes(morePhase)?'alert':'status');
      previousMore.textContent=['error','invalid'].includes(morePhase)?'다시 시도':'더보기';
      previousMore.setAttribute('aria-disabled',String(morePhase==='loading'));
    } else {
      document.getElementById('pagination').innerHTML = pagination;
      document.getElementById('more')?.addEventListener('click',()=>controller.loadMore());
      if (moreFocused) document.getElementById('list-title').focus();
    }
    cache.pagination = pagination;
  }
  const heading = `<span id="detail-target" class="selected-label">${icon('list')}${state.detailSource==='direct'?'ID 직접 조회':'평가 상세'}${state.selected!==null?` · Alert #${state.selected}`:''}</span>${state.detail.phase!=='idle'?`<button id="close" class="view-action" aria-label="상세 패널 닫기"><span>닫기</span>${icon('close')}</button>`:''}`;
  if (cache.heading !== heading) {
    document.getElementById('detail-head').innerHTML = heading;
    document.getElementById('close')?.addEventListener('click',()=>{
      if (cache.view==='focus') showReadingView(cache,document,'investigate');
      controller.close();restoreDetailFocus(cache,document);
    });
    cache.heading = heading;
  }
  if (cache.detail !== state.detail) {
    document.getElementById('detail-content').innerHTML = state.detail.phase==='success' ? detail(state.detail.data) : state.detail.phase==='idle' ? `<div class="no-selection">${icon('list')}<h2>검토할 Alert를 선택하세요</h2><p>목록의 상세 보기를 누르면 평가 사유와 판단 근거가 표시됩니다.</p></div>` : stateMessage(state.detail.phase,'detail');
    document.getElementById('retry-detail')?.addEventListener('click',()=>{
      const request=controller.retryDetail();
      openDetail(cache,document,request,cache.detailOpener||{kind:state.detailSource,id:state.selected});
      return request;
    });
    cache.detail = state.detail;
  }
  // Only a changed list region can create a new first-page retry button.
  const retry = document.getElementById('retry-list');
  if (retry && !cache.buttons.has(retry)) {
    retry.addEventListener('click',()=>{
      const request=controller.retryList();document.getElementById('list-title').focus();return request;
    }); cache.buttons.add(retry);
  }
}

export function createDashboard(adapter,document,mode = 'mock'){
 const controller=createController(adapter,state=>renderDashboard(state,document,controller,mode));
 return controller;
}
