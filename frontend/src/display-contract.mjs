// Display contract only. No scoring, classification or action recommendation.
export class ResponseDataError extends Error {}
export class AlertNotFound extends Error {}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = Number.isSafeInteger;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
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
export function validateList(response, requestedLimit = response?.limit) {
  requireValid(object(response) && integer(response.count) && response.count >= 0 && integer(response.limit) && response.limit >= 1 && response.limit <= 100 && Array.isArray(response.alerts));
  response.alerts.forEach(validateAlert);
  requireValid(response.limit === requestedLimit && response.count === response.alerts.length && response.count <= response.limit);
  requireValid(Object.hasOwn(response, 'next_cursor'));
  if (response.next_cursor !== null) {
    requireValid(object(response.next_cursor) && integer(response.next_cursor.alert_id) && response.next_cursor.alert_id > 0 && date(response.next_cursor.created_at));
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
export function createController(adapter, onChange = () => {}) {
  const state = {
    query: {level: '', human: '', limit: 5},
    limitInput: {draft: '5', error: ''},
    idInput: {draft: '', error: ''},
    list: {phase: 'loading', data: null},
    detail: {phase: 'idle', data: null},
    selected: null,
    detailSource: null
  };
  let listRequest = 0;
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
    let candidate = initialSelection;
    if (candidate === null) {
      if (state.detailSource === 'list') candidate = state.selected;
      else if (listCandidate?.intent === detailIntent) candidate = listCandidate.id;
    }
    const intent = detailIntent;
    listCandidate = candidate === null ? null : {id: candidate, intent};
    const request = ++listRequest;
    state.query = applied;
    state.list = {phase: 'loading', data: null};
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
      validateList(response, applied.limit);
      const data = response.alerts;
      state.list = {phase: 'success', data, response};
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
      state.list = {phase, data: null};
      listCandidate = null;
      if (intent === detailIntent && state.detailSource !== 'direct') {
        state.selected = null;
        state.detailSource = null;
        state.detail = {phase: 'idle', data: null};
      }
      notify();
    }
  }
  function setDraft(input, draft) {
    input.draft = draft;
    input.error = '';
    notify();
  }
  function positiveInteger(draft) {
    if (typeof draft !== 'string' || !/^\d+$/.test(draft)) return null;
    const value = Number(draft);
    return integer(value) && value > 0 ? value : null;
  }
  function applyLimit() {
    const limit = positiveInteger(state.limitInput.draft);
    if (limit === null || limit > 100) {
      state.limitInput.error = '조회 개수는 1~100의 정수로 입력하세요.';
      notify();
      return;
    }
    state.limitInput.error = '';
    return load({...state.query, limit});
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
    state, load, select, close, applyLimit, lookupId,
    setLimitDraft: draft => setDraft(state.limitInput, draft),
    setIdDraft: draft => setDraft(state.idInput, draft),
    retryList: () => load(),
    retryDetail: () => select(state.selected, state.detailSource)
  };
}
