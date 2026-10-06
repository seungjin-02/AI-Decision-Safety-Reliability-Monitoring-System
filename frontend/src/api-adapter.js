import {ResponseDataError, AlertNotFound} from './display-contract.mjs';

// HTTP transport only. Required response fields are validated by the controller.
export function createApiAdapter(fetchRequest = globalThis.fetch) {
  async function get(url, isDetail = false) {
    let response;
    try {
      response = await fetchRequest(url);
    } catch {
      throw new Error('Alert request failed');
    }
    if (isDetail && response.status === 404) throw new AlertNotFound();
    if (!response.ok) throw new Error('Alert request failed');
    try {
      return await response.json();
    } catch {
      throw new ResponseDataError('Invalid response JSON');
    }
  }

  return {
    list(query) {
      const params = new URLSearchParams({limit: '5'});
      if (query.level !== '') params.set('level', query.level);
      if (query.human !== '') params.set('human_required', query.human);
      return get(`/alerts?${params}`);
    },
    detail(id) {
      return get(`/alerts/${id}`, true);
    }
  };
}
