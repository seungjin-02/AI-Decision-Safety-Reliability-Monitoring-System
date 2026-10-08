// Display contract only. No scoring, classification or action recommendation.
export class ResponseDataError extends Error {}
export class AlertNotFound extends Error {}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = Number.isSafeInteger;
// Compare aware timestamps by their meaning, preserving server microseconds.
export function timestamp(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = '', zone] = match;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  calendar.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  if (Number(year) < 1 || calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() + 1 !== Number(month) || calendar.getUTCDate() !== Number(day) || calendar.getUTCHours() !== Number(hour) || calendar.getUTCMinutes() !== Number(minute) || calendar.getUTCSeconds() !== Number(second)) return null;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return null;
  const milliseconds = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`);
  return Number.isFinite(milliseconds) ? BigInt(milliseconds) * 1000000n + BigInt(fraction.padEnd(9, '0')) : null;
}
const date = value => timestamp(value) !== null;
export function compareKeys(a, b) {
  const left = timestamp(a.created_at), right = timestamp(b.created_at);
  requireValid(left !== null && right !== null);
  return left < right ? -1 : left > right ? 1 : Math.sign(a.alert_id - b.alert_id);
}
const jsonValue = value => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (Array.isArray(value) && value.every(jsonValue)) || (object(value) && Object.values(value).every(jsonValue));
function requireValid(valid) { if (!valid) throw new ResponseDataError('Invalid required response data'); }
export function validateAlert(a) {
  requireValid(object(a));
  requireValid(integer(a.alert_id) && a.alert_id > 0 && typeof a.trace_id === 'string' && typeof a.event_id === 'string' && date(a.created_at));
  requireValid(['INFO','WARN','CRITICAL'].includes(a.level) && typeof a.human_required === 'boolean');
  requireValid(integer(a.risk_score) && integer(a.uncertainty_score) && typeof a.reason_summary === 'string');
  requireValid(Array.isArray(a.recommended_actions) && a.recommended_actions.every(v => typeof v === 'string'));
  requireValid(Array.isArray(a.signals));
  for (const s of a.signals) {
    requireValid(object(s) && typeof s.rule_id === 'string' && typeof s.category === 'string' && integer(s.score));
    requireValid(typeof s.reason === 'string' && object(s.evidence) && jsonValue(s.evidence) && typeof s.is_critical_override === 'boolean');
  }
  // GET metadata is neither required nor presented.
  return a;
}
export function validateList(response, requestedLimit = response?.limit, pageQuery = null) {
  requireValid(object(response) && integer(response.count) && response.count >= 0 && integer(response.limit) && response.limit >= 1 && response.limit <= 100 && Array.isArray(response.alerts));
  response.alerts.forEach(validateAlert);
  requireValid(response.limit === requestedLimit && response.count === response.alerts.length && response.count <= response.limit);
  requireValid(Object.hasOwn(response, 'next_cursor'));
  if (response.next_cursor !== null) {
    requireValid(object(response.next_cursor) && integer(response.next_cursor.alert_id) && response.next_cursor.alert_id > 0 && date(response.next_cursor.created_at));
  }
  requireValid(new Set(response.alerts.map(a => a.alert_id)).size === response.count);
  if (pageQuery) {
    const direction = pageQuery.sort_order === 'asc' ? 1 : -1;
    const existing = pageQuery.existing || [];
    const seen = new Set(existing.map(a => a.alert_id));
    let boundary = pageQuery.cursor || null;
    for (const alert of response.alerts) {
      requireValid(!seen.has(alert.alert_id));
      if (boundary) requireValid(compareKeys(alert, boundary) * direction > 0);
      boundary = alert;
    }
    if (response.next_cursor !== null) {
      requireValid(response.count === response.limit && response.count > 0);
      requireValid(compareKeys(response.next_cursor, response.alerts.at(-1)) === 0);
      if (pageQuery.cursor) requireValid(compareKeys(response.next_cursor, pageQuery.cursor) * direction > 0);
    }
  }
  return response;
}
const knownLowApproval = s => s.rule_id === 'approve_confidence_low' && s.evidence.decision_type === 'approve' && typeof s.evidence.confidence === 'number';
const knownMissingVersion = s => s.rule_id === 'missing_model_version' && s.evidence.model_version === null;
const knownLatency = s => s.rule_id === 'latency_high' && typeof s.evidence.latency_ms === 'number';
const knownTimeout = s => s.rule_id === 'evaluation_integrity_override' && s.evidence.error_code === 'timeout_01';
export function signalReason(s) {
  if (knownTimeout(s)) return '입력된 실패 코드가 응답 시간 초과를 나타냅니다.';
  if (knownLatency(s)) return '입력된 지연 시간이 평가 기준을 초과했습니다.';
  if (knownLowApproval(s)) return '입력된 승인 판단의 신뢰도가 평가 기준보다 낮습니다.';
  if (knownMissingVersion(s)) return '입력된 모델 버전 정보가 없습니다.';
  return s.reason;
}
export function summaryFor(a) {
  if (a.level === 'INFO' && a.signals.length === 0 && a.reason_summary === 'risk signals remain low and do not require escalation') return '현재 평가 기준에서 위험 신호 수준이 낮게 분류되었습니다.';
  // Exact, documented rule/evidence combinations; never alert IDs or scores.
  if (a.signals.length === 1 && knownTimeout(a.signals[0])) return '평가 대상의 응답 시간 초과가 보고되었습니다.';
  if (a.signals.length === 1 && knownMissingVersion(a.signals[0])) return '입력된 모델 버전 정보가 없습니다.';
  if (a.signals.length === 1 && knownLowApproval(a.signals[0])) return '낮은 신뢰도의 승인 판단이 입력되었습니다.';
  if (a.signals.length === 2 && a.signals.some(knownLowApproval) && a.signals.some(knownMissingVersion)) return '낮은 신뢰도의 승인 판단과 모델 버전 누락이 입력되었습니다.';
  if (a.signals.length === 2 && a.signals.some(knownLowApproval) && a.signals.some(knownLatency)) return '낮은 신뢰도의 승인 판단과 입력 지연의 기준 초과가 확인되었습니다.';
  return a.reason_summary;
}
export function evidenceValues(evidence) {
  return Object.entries(evidence).map(([key,value]) => ({key, raw:JSON.stringify(value), missing:value === null}));
}
export const statusText = Object.freeze({
  loading:'Alert를 불러오는 중입니다.', empty:'현재 조회 조건에 맞는 Alert가 없습니다.',
  notfound:'해당 Alert를 찾을 수 없습니다.', error:'Alert를 불러오지 못했습니다.',
  invalid:'응답 데이터를 확인할 수 없습니다.'
});
export class QueryInputError extends Error {}
export const defaultDraft = Object.freeze({limit: '5', level: '', human: '', created_from: '', created_to: '', sort_order: 'desc'});
function positiveInteger(draft) {
  if (typeof draft !== 'string' || !/^\d+$/.test(draft)) return null;
  const value = Number(draft);
  return integer(value) && value > 0 ? value : null;
}
function kstBoundary(input) {
  if (input === '') return '';
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/.test(input)) throw new QueryInputError('생성 시각을 올바른 KST 날짜와 시간으로 입력하세요.');
  const aware = `${input.length === 16 ? input + ':00' : input}+09:00`;
  if (!date(aware)) throw new QueryInputError('생성 시각을 올바른 KST 날짜와 시간으로 입력하세요.');
  return aware;
}
export function queryFromDraft(draft) {
  const limit = positiveInteger(draft.limit);
  if (limit === null || limit > 100) throw new QueryInputError('조회 개수는 1~100의 정수로 입력하세요.');
  if (!['', 'INFO', 'WARN', 'CRITICAL'].includes(draft.level) || !['', 'true', 'false'].includes(draft.human) || !['asc', 'desc'].includes(draft.sort_order)) throw new QueryInputError('조회 조건을 확인하세요.');
  const created_from = kstBoundary(draft.created_from), created_to = kstBoundary(draft.created_to);
  if (created_from && created_to && timestamp(created_from) >= timestamp(created_to)) throw new QueryInputError('생성 시작 시각은 종료 시각보다 빨라야 합니다.');
  return {limit, level: draft.level, human: draft.human, created_from, created_to, sort_order: draft.sort_order};
}
export function queryIsDirty(state) {
  try {
    const draft = queryFromDraft(state.draft);
    return Object.keys(draft).some(key => draft[key] !== state.query[key]);
  } catch { return true; }
}
export function createController(adapter, onChange = () => {}) {
  const state = {
    query: queryFromDraft(defaultDraft), // Last applied conditions, independent of edits.
    draft: {...defaultDraft}, queryError: '',
    idInput: {draft: '', error: ''},
    list: {phase: 'loading', data: null},
    detail: {phase: 'idle', data: null},
    selected: null,
    detailSource: null
  };
  let listRequest = 0;
  let moreRequest = 0;
  let detailRequest = 0;
  // User detail intent is independent of list request order. A late list may
  // restore its candidate only if no new selection/direct lookup/close occurred.
  let detailIntent = 0;
  let listCandidate = null;
  const notify = () => onChange(state);

  function close() {
    detailRequest++;
    detailIntent++;
    listCandidate = null;
    state.selected = null;
    state.detailSource = null;
    state.detail = {phase: 'idle', data: null};
    notify();
  }

  async function select(id, source = 'list') {
    if (!integer(id) || id <= 0) return;
    detailIntent++;
    listCandidate = null;
    const request = ++detailRequest;
    state.selected = id;
    state.detailSource = source;
    state.detail = {phase: 'loading', data: null};
    notify();
    try {
      const data = await adapter.detail(id);
      if (request !== detailRequest) return;
      validateAlert(data);
      requireValid(data.alert_id === id);
      state.detail = {phase: 'success', data};
    } catch (error) {
      if (request !== detailRequest) return;
      let phase = 'error';
      if (error instanceof ResponseDataError) {
        phase = 'invalid';
      } else if (error instanceof AlertNotFound) {
        phase = 'notfound';
      }
      state.detail = {phase, data: null};
    }
    notify();
  }
  async function load(query = state.query, initialSelection = null) {
    const applied = {...state.query, ...query};
    requireValid(integer(applied.limit) && applied.limit >= 1 && applied.limit <= 100);
    requireValid(['', 'INFO', 'WARN', 'CRITICAL'].includes(applied.level) && ['', 'true', 'false'].includes(applied.human));
    requireValid(['asc', 'desc'].includes(applied.sort_order));
    requireValid((applied.created_from === '' || date(applied.created_from)) && (applied.created_to === '' || date(applied.created_to)));
    requireValid(!applied.created_from || !applied.created_to || timestamp(applied.created_from) < timestamp(applied.created_to));
    let candidate = initialSelection;
    if (candidate === null) {
      if (state.detailSource === 'list') candidate = state.selected;
      else if (listCandidate?.intent === detailIntent) candidate = listCandidate.id;
    }
    const intent = detailIntent;
    listCandidate = candidate === null ? null : {id: candidate, intent};
    const request = ++listRequest;
    moreRequest++;
    state.query = applied;
    state.list = {phase: 'loading', data: null, cursor: null, more: {phase: 'idle'}};
    if (state.detailSource !== 'direct') {
      detailRequest++;
      state.selected = null;
      state.detailSource = null;
      state.detail = {phase: candidate === null ? 'idle' : 'loading', data: null};
    }
    notify();
    try {
      const response = await adapter.list({...applied});
      if (request !== listRequest) return;
      validateList(response, applied.limit, applied);
      const data = response.alerts;
      state.list = {phase: 'success', data, response, cursor: response.next_cursor, more: {phase: 'idle'}};
      listCandidate = null;
      if (intent === detailIntent && state.detailSource !== 'direct') {
        state.detail = {phase: 'idle', data: null};
        if (candidate !== null && data.some(a => a.alert_id === candidate)) {
          await select(candidate);
          return;
        }
      }
      notify();
    } catch (error) {
      if (request !== listRequest) return;
      const phase = error instanceof ResponseDataError ? 'invalid' : 'error';
      state.list = {phase, data: null, cursor: null, more: {phase: 'idle'}};
      listCandidate = null;
      if (intent === detailIntent && state.detailSource !== 'direct') {
        state.selected = null;
        state.detailSource = null;
        state.detail = {phase: 'idle', data: null};
      }
      notify();
    }
  }
  async function loadMore() {
    if (state.list.phase !== 'success' || !state.list.cursor || state.list.more.phase === 'loading') return;
    const generation = listRequest, request = ++moreRequest;
    const query = {...state.query}, cursor = {...state.list.cursor}, previous = state.list.data;
    state.list.more = {phase: 'loading'};
    notify();
    try {
      const response = await adapter.list({...query, cursor_created_at: cursor.created_at, cursor_alert_id: cursor.alert_id});
      if (generation !== listRequest || request !== moreRequest) return;
      validateList(response, query.limit, {...query, cursor, existing: previous});
      state.list = {...state.list, data: [...previous, ...response.alerts], response, cursor: response.next_cursor, more: {phase: 'idle'}};
    } catch (error) {
      if (generation !== listRequest || request !== moreRequest) return;
      state.list.more = {phase: error instanceof ResponseDataError ? 'invalid' : 'error'};
    }
    notify();
  }
  function setQueryDraft(name, value) {
    if (!Object.hasOwn(defaultDraft, name) || typeof value !== 'string') return;
    state.draft[name] = value;
    state.queryError = '';
    notify();
  }
  function applyQuery() {
    let query;
    try { query = queryFromDraft(state.draft); }
    catch (error) {
      state.queryError = error.message;
      notify();
      return;
    }
    state.queryError = '';
    return load(query);
  }
  function resetFilters() {
    for (const name of ['level', 'human', 'created_from', 'created_to']) state.draft[name] = '';
    state.queryError = '';
    notify();
  }
  function lookupId() {
    const id = positiveInteger(state.idInput.draft);
    if (id === null) {
      state.idInput.error = 'Alert ID는 정확하게 표현할 수 있는 양의 정수로 입력하세요.';
      notify();
      return;
    }
    state.idInput.error = '';
    return select(id, 'direct');
  }
  return {
    state, load, loadMore, select, close, applyQuery, resetFilters, lookupId, setQueryDraft,
    setIdDraft(draft) {state.idInput = {draft, error: ''}; notify();},
    retryList: () => load(),
    retryDetail: () => select(state.selected, state.detailSource)
  };
}
