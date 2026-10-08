import {createDashboard} from './app.js';
import {createMockAdapter} from './mock-adapter.js';
import {createApiAdapter} from './api-adapter.js';

export function startDashboard(document, location, fetchRequest = globalThis.fetch) {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') === 'mock' ? 'mock' : 'api';
  let adapter;
  if (mode === 'mock') {
    let response;
    try {
      response = JSON.parse(document.getElementById('fixtures').textContent);
    } catch {
      // Leave malformed fixtures for controller validation; never default to [].
    }
    adapter = createMockAdapter(response, params.get('preview') || '');
  } else {
    adapter = createApiAdapter(fetchRequest);
  }
  const controller = createDashboard(adapter, document, mode);
  const ready = controller.load(controller.state.query, mode === 'mock' ? 18 : null);
  return {controller, ready};
}

if (typeof document !== 'undefined') startDashboard(document, location);
