import {createDashboard} from './app.js';
import {createMockAdapter} from './mock-adapter.js';

let response;
try {
  response=JSON.parse(document.getElementById('fixtures').textContent);
} catch {
  // An invalid response is handled by the controller, never replaced with [].
}
const scenario=new URLSearchParams(location.search).get('preview')||'';
const controller=createDashboard(createMockAdapter(response,scenario),document);
controller.load(controller.state.query,18);
