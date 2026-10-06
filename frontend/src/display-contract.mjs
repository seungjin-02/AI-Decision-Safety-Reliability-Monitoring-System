// Display contract only. No scoring, classification or action recommendation.
export class ResponseDataError extends Error {}
export class PreviewNotFound extends Error {}
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
export function validateList(response) {
  requireValid(object(response) && integer(response.count) && response.count >= 0 && integer(response.limit) && response.limit >= 1 && response.limit <= 100 && Array.isArray(response.alerts));
  response.alerts.forEach(validateAlert);
  if (response.next_cursor !== undefined && response.next_cursor !== null) {
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
  const state = {query:{level:'',human:''},list:{phase:'loading',data:null},detail:{phase:'idle',data:null},selected:null};
  let listRequest = 0, detailRequest = 0;
  const notify = () => onChange(state);
  function close() { detailRequest++; state.selected=null; state.detail={phase:'idle',data:null}; notify(); }
  async function select(id) {
    const request = ++detailRequest;
    state.selected=id; state.detail={phase:'loading',data:null}; notify();
    try {
      const data = await adapter.detail(id);
      if (request !== detailRequest) return;
      validateAlert(data);
      requireValid(data.alert_id === id);
      state.detail={phase:'success',data};
    } catch (error) {
      if (request !== detailRequest) return;
      state.detail={phase:error instanceof ResponseDataError?'invalid':error instanceof PreviewNotFound?'notfound':'error',data:null};
    }
    notify();
  }
  async function load(query=state.query, initialSelection=null) {
    const previous = state.selected;
    const request = ++listRequest;
    detailRequest++;
    state.query={...query}; state.list={phase:'loading',data:null}; state.selected=null; state.detail={phase:'idle',data:null}; notify();
    try {
      const response = await adapter.list({...query});
      if (request !== listRequest) return;
      validateList(response);
      const data = [...response.alerts].sort((a,b) => Date.parse(b.created_at)-Date.parse(a.created_at) || b.alert_id-a.alert_id);
      state.list={phase:'success',data}; notify();
      const id = initialSelection ?? previous;
      if (id !== null && data.some(a=>a.alert_id===id)) await select(id);
    } catch (error) {
      if (request !== listRequest) return;
      state.list={phase:error instanceof ResponseDataError?'invalid':'error',data:null}; state.selected=null; state.detail={phase:'idle',data:null}; notify();
    }
  }
  return {state,load,select,close,retryList:()=>load(),retryDetail:()=>select(state.selected)};
}
