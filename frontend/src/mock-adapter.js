import {ResponseDataError, AlertNotFound} from './display-contract.mjs';

// These guards cover only fields used for mock lookup/filter/sort operations.
// The controller owns full list/detail response validation.
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
      if (scenario === 'list-invalid') {
        if (items[0]) delete items[0].risk_score;
        else throw new ResponseDataError('Missing preview item');
        return result;
      }
      result.alerts = scenario === 'list-empty' ? [] : items.filter(item =>
        (!query.level || item.level === query.level) &&
        (!query.human || String(item.human_required) === query.human)
      ).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.alert_id - a.alert_id);
      result.count = result.alerts.length;
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
