import {ResponseDataError, AlertNotFound, validateList, compareKeys, timestamp} from './display-contract.mjs';

// Lookup guards keep malformed data in the response-data error category.
// List filtering also uses the shared full validator before excluding records.
function itemsForOperations(response) {
  if (!response || !Array.isArray(response.alerts) || response.alerts.some(alert =>
    !alert || typeof alert !== 'object' || !Number.isSafeInteger(alert.alert_id) ||
    typeof alert.level !== 'string' || typeof alert.human_required !== 'boolean' ||
    typeof alert.created_at !== 'string'
  )) throw new ResponseDataError('Invalid mock lookup data');
  return response.alerts;
}

export function createMockAdapter(fixtureResponse, scenario = '', delayMs = 180) {
  const sample = structuredClone(fixtureResponse);
  const alert = Array.isArray(sample?.alerts)
    ? sample.alerts.find(item => item?.alert_id === 18) : undefined;
  const signal = Array.isArray(alert?.signals) ? alert.signals[0] : undefined;
  if (alert && signal && signal.evidence && typeof signal.evidence === 'object') {
    if (scenario === 'empty-evidence') signal.evidence = {};
    if (scenario === 'empty-signals') alert.signals = [];
    if (scenario === 'empty-actions') alert.recommended_actions = [];
    if (scenario === 'unknown-failure') signal.evidence.error_code = 'unmapped_failure';
    if (scenario === 'unknown-rule') signal.rule_id = 'unmapped_rule';
    if (scenario === 'values') {
      Object.assign(signal.evidence, {zero: 0, disabled: false, empty: '', missing: null});
    }
  }
  const delay = () => new Promise(resolve => setTimeout(resolve, delayMs));
  let listAttempts = 0;
  let detailAttempts = 0;
  return {
    async list(query) {
      const attempt = ++listAttempts;
      if (scenario === 'list-loading') return new Promise(() => {});
      await delay();
      if (scenario === 'list-error' && attempt === 1) throw new Error('Preview request failure');
      const result = structuredClone(sample);
      const items = itemsForOperations(result);
      // Validate the entire fixture before filtering/slicing; an excluded bad
      // record must not disappear as a normal empty response.
      validateList(result);
      if (scenario === 'list-invalid') {
        if (items[0]) delete items[0].risk_score;
        else throw new ResponseDataError('Missing preview item');
        return result;
      }
      result.alerts = scenario === 'list-empty' ? [] : items.filter(item =>
        (!query.level || item.level === query.level) &&
        (!query.human || String(item.human_required) === query.human) &&
        (!query.created_from || timestamp(item.created_at) >= timestamp(query.created_from)) &&
        (!query.created_to || timestamp(item.created_at) < timestamp(query.created_to)) &&
        (!query.cursor_created_at || compareKeys(item, {created_at: query.cursor_created_at, alert_id: query.cursor_alert_id}) * (query.sort_order === 'asc' ? 1 : -1) > 0)
      ).sort((a, b) => compareKeys(a, b) * (query.sort_order === 'asc' ? 1 : -1));
      const more = result.alerts.length > query.limit;
      result.alerts = result.alerts.slice(0, query.limit);
      result.limit = query.limit;
      result.count = result.alerts.length;
      const last = result.alerts.at(-1);
      result.next_cursor = more && last ? {created_at: last.created_at, alert_id: last.alert_id} : null;
      return result;
    },
    async detail(id) {
      const attempt = ++detailAttempts;
      if (scenario === 'detail-loading') return new Promise(() => {});
      await delay();
      if (scenario === 'detail-404') throw new AlertNotFound();
      if (scenario === 'detail-error' && attempt === 1) throw new Error('Preview request failure');
      const result = structuredClone(itemsForOperations(sample).find(item => item.alert_id === id));
      if (!result) throw new AlertNotFound();
      if (scenario === 'detail-invalid') delete result.human_required;
      return result;
    }
  };
}
