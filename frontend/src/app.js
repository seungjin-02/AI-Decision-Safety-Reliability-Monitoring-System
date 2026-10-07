import {summaryFor,signalReason,evidenceValues,statusText,createController} from './display-contract.mjs';
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
function filters({level,human}){
  return `<div class="filters">
    <div class="filter">
    <label for="level">평가 수준</label>
    <div class="select-wrap">
    <select id="level">
    <option value="">전체 수준</option>${['CRITICAL','WARN','INFO'].map(v=>`<option ${v===level?'selected':''}>${v}</option>`).join('')}</select>${icon('down')}</div>
    </div>
    <div class="filter">
    <label for="human">사람 검토</label>
    <div class="select-wrap">
    <select id="human">
    <option value="">전체 검토 요구</option>
    <option value="true" ${human==='true'?'selected':''}>검토 필요</option>
    <option value="false" ${human==='false'?'selected':''}>검토 요구 없음</option>
    </select>${icon('down')}</div>
    </div><button class="filter-reset" id="reset">필터 초기화</button></div>`;
}
function queryInputs(state) {
  const limit = state.limitInput;
  const limitNote = limit.error || (limit.draft !== String(state.query.limit)
    ? `미적용 · 현재 요청 개수 ${state.query.limit}건` : '1~100의 정수');
  const count = state.list.phase === 'success' ? `<span class="page-count">현재 표시 ${state.list.response.count}건</span>` : '';
  return `<form id="limit-form" class="query-input" novalidate>
    <label for="limit-input">조회 개수</label>
    <div class="query-line"><input id="limit-input" type="number" min="1" max="100" step="1" value="${esc(limit.draft)}" aria-describedby="limit-note" aria-invalid="${Boolean(limit.error)}">
    <button type="submit">조회</button>${count}</div>
    <p id="limit-note" class="input-note ${limit.error ? 'input-error' : ''}" ${limit.error ? 'role="alert"' : ''}>${esc(limitNote)}</p>
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
function queue(items,selected){
  return `<div class="master-guide">
    <span>사유 요약 · 이벤트 식별자</span>
    <span>생성 시각 · KST</span>
    </div>
    <div class="inbox-list">${items.map(a=>`<article class="inbox-row ${a.alert_id===selected?'selected':''}" aria-label="${esc(a.event_id)}">
    <div class="inbox-icon ${a.level==='CRITICAL'?'critical':''}">${levelIcon(a.level)}</div>
    <div class="inbox-main">
    <p class="inbox-summary">${esc(summaryFor(a))}</p>
    <div class="inbox-topline">
    <span class="mono quiet">${esc(a.event_id)}</span>
    <time datetime="${a.created_at}">${timeParts(a).date} ${timeParts(a).time}</time>
    </div>
    <div class="inbox-bottom">${sev(a)}${review(a)}</div>
    </div>
    <button class="view-action" data-select="${a.alert_id}" aria-label="${esc(a.event_id)} 상세 보기" ${a.alert_id===selected?'aria-current="true"':''}>${icon('arrow')}</button>
    </article>`).join('')}</div>`;
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
export function renderDashboard(state, document, controller, mode = 'mock'){
 const focused=document.activeElement;
 const focusId=focused?.id;
 const focusSelection=focused?.getAttribute('data-select');
 const caret = focused?.selectionStart;
 const caretEnd = focused?.selectionEnd;
 const {level, human} = state.query;
 const selected = state.detailSource === 'list' ? state.selected : null;
 let list;
 if (state.list.phase === 'success') {
   list = state.list.data.length
     ? queue(state.list.data, selected) : stateMessage('empty', 'list');
 } else {
   list = stateMessage(state.list.phase, 'list');
 }
 let panel;
 if (state.detail.phase === 'success') {
   panel = detail(state.detail.data);
 } else if (state.detail.phase === 'idle') {
   panel = `<div class="no-selection">${icon('list')}<h2>검토할 Alert를 선택하세요</h2>
    <p>목록의 상세 보기를 누르면 평가 사유와 판단 근거가 표시됩니다.</p>
    </div>`;
 } else {
   panel = stateMessage(state.detail.phase, 'detail');
 }
 document.getElementById('app').innerHTML=`<header class="mast">
    <div class="identity">
    <span class="mark">${icon('mark')}</span>
    <span>의사결정 모니터</span>
    </div>
    <div class="mast-right">
    <span class="small">내부 운영</span>
    <span class="mast-divider"></span>
    <span class="environment">${mode === 'api' ? '로컬 API 연결' : '예시 데이터'}</span>
    <span class="prototype-note">C2 · 검토용</span>
    </div>
    </header>
    <main class="split">
    <section class="master" aria-labelledby="list-title" aria-busy="${state.list.phase==='loading'}">
    <header class="master-head">
    <div class="list-heading">
    <h1 id="list-title">Alert 목록</h1>
    <span class="sort">${icon('sort')}최신 생성순 · KST</span>
    </div>${filters(state.query)}${queryInputs(state)}</header>${list}<p class="master-foot">${policy}</p>
    </section>
    <aside class="inspector" aria-label="선택한 Alert 상세" aria-busy="${state.detail.phase==='loading'}">${idInput(state)}
    <div class="inspector-head"><span class="selected-label">${icon('list')}${state.detailSource === 'direct' ? `ID 직접 조회 · Alert #${state.selected}` : '평가 상세'}</span>
    ${state.detail.phase !== 'idle' ? `<button id="close" class="view-action" aria-label="상세 패널 닫기">${icon('close')}</button>` : ''}</div>${panel}</aside>
    </main>`;
 document.getElementById('level').addEventListener('change',e=>controller.load({level:e.target.value,human}));
 document.getElementById('human').addEventListener('change',e=>controller.load({level,human:e.target.value}));
 document.getElementById('reset')?.addEventListener('click',()=>controller.load({level:'',human:''}));
 document.getElementById('limit-input').addEventListener('input',e=>controller.setLimitDraft(e.target.value));
 document.getElementById('alert-id').addEventListener('input',e=>controller.setIdDraft(e.target.value));
 // Native form submission handles both button and Enter, exactly once.
 document.getElementById('limit-form').addEventListener('submit',e=>{e.preventDefault();return controller.applyLimit();});
 document.getElementById('id-form').addEventListener('submit',e=>{e.preventDefault();return controller.lookupId();});
 document.querySelectorAll('[data-select]').forEach(button=>button.addEventListener('click',()=>controller.select(Number(button.dataset.select))));
 document.getElementById('close')?.addEventListener('click',()=>controller.close());
 document.getElementById('retry-list')?.addEventListener('click',()=>controller.retryList());
 document.getElementById('retry-detail')?.addEventListener('click',()=>controller.retryDetail());
 if(focusId) {
   const target = document.getElementById(focusId);
   target?.focus({preventScroll:true});
   if (caret !== null && caret !== undefined && target?.setSelectionRange) target.setSelectionRange(caret, caretEnd);
 }
 else if(focusSelection)document.querySelector(`[data-select="${focusSelection}"]`)?.focus({preventScroll:true});
}

export function createDashboard(adapter,document,mode = 'mock'){
 const controller=createController(adapter,state=>renderDashboard(state,document,controller,mode));
 return controller;
}
