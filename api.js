const BASE = (import.meta.env.VITE_BACKEND_URL ?? '') + '/api';

// Makes any returned video link work no matter how PUBLIC_URL is set: keeps only the /uploads/<file> part
// and points it at this app's backend (same site by default, or VITE_BACKEND_URL when hosted separately).
export function mediaUrl(u) {
  if (!u) return u;
  const m = String(u).match(/\/uploads\/[^?#]+/);
  return m ? (import.meta.env.VITE_BACKEND_URL ?? '').replace(/\/$/, '') + m[0] : u;
}

function getUserId() {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('user_token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      localStorage.setItem('im_token', token);
      localStorage.setItem('im_user', JSON.stringify({ id: payload.id, name: payload.name, email: payload.email }));
      window.history.replaceState({}, '', window.location.pathname);
    }
    const u = localStorage.getItem('im_user');
    return u ? JSON.parse(u).id : null;
  } catch { return null; }
}

// Normal calls give up after 90s (covers a sleeping Render server waking up); uploads get 15 minutes.
const TIMEOUT_MS = 90 * 1000, UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;

async function request(method, path, data, isForm = false, extraHeaders = {}) {
  const userId = getUserId();
  let token = null;
  try { token = localStorage.getItem('im_token'); } catch { /* storage blocked */ }
  const auth = { ...(userId ? { 'x-user-id': userId } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), isForm ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS);
  const opts = {
    method,
    headers: isForm ? { ...auth, ...extraHeaders } : { 'Content-Type': 'application/json', ...auth, ...extraHeaders },
    body: data ? (isForm ? data : JSON.stringify(data)) : undefined,
    signal: ctrl.signal
  };
  let res;
  try { res = await fetch(`${BASE}${path}`, opts); }
  catch (e) {
    if (e && e.name === 'AbortError') throw new Error('The server took too long to answer. It may be waking up - please try again in a moment.');
    throw new Error('Could not reach the server. Check your internet and try again.');
  } finally { clearTimeout(timer); }
  let json = null;
  try { json = await res.json(); } catch { /* not JSON (e.g. a gateway error page) */ }
  if (res.status === 401 && json && json.code === 'session_expired') {
    // Do NOT redirect: the page keeps the user's work and shows a "sign in again" banner instead.
    try { localStorage.removeItem('im_token'); } catch { /* ignore */ }
    window.dispatchEvent(new Event('im:session-expired'));
    throw new Error(json.error || 'Your session expired. Please sign in again.');
  }
  if (!res.ok) throw new Error((json && json.error) || (res.status >= 500 ? 'The server had a problem. Please try again.' : `Request failed (${res.status})`));
  if (json === null) throw new Error('The server sent an unexpected answer. Please try again.');
  return json;
}

// UI state (camelCase) -> API fields (snake_case). Empty values are omitted so bots/humans can skip any of them.
function toApiOptions(o = {}) {
  const out = {};
  if (o.brief?.trim())        out.brief = o.brief.trim();
  if (o.instructions?.trim()) out.instructions = o.instructions.trim();
  if (o.mustInclude?.trim())  out.must_include = o.mustInclude.trim();
  if (o.mentions?.trim())     out.mentions = o.mentions.trim();
  if (o.hashtags?.trim())     out.hashtags = o.hashtags.trim();
  if (o.aiHashtags)           out.ai_hashtags = true;
  if (typeof o.creditLine === 'boolean') out.credit_line = o.creditLine;
  if (o.tweak?.trim())        out.tweak = o.tweak.trim();
  if (o.tosExact?.trim())       out.tos_exact = o.tosExact.trim();
  if (o.tosMustInclude?.trim()) out.tos_must_include = o.tosMustInclude.trim();
  return out;
}

// Long steps (download, caption, render) run as background jobs on the server: we start one, then check on it
// every few seconds. No single request stays open for minutes, so nothing "sticks" on slow connections.
// The result has the same shape as before, so callers don't change. Pass onStatus to show progress.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function requestJob(method, path, data, isForm, onStatus) {
  const start = await request(method, path, data, isForm, { 'x-async': '1' });
  if (!start.jobId) return start;                       // older server: it answered directly
  const t0 = Date.now();
  let errors = 0;
  for (;;) {
    await sleep(2500);
    let j;
    try { j = await request('GET', `/content/job/${start.jobId}`); errors = 0; }
    catch (e) {
      if (/job is gone|session expired/i.test(e.message)) throw e;   // server restarted / signed out
      if (++errors >= 6) throw new Error('Lost connection to the server. Check your internet and try again.');
      continue;                                         // a hiccup (or the server waking up): try again
    }
    if (onStatus) onStatus(j);
    if (j.status === 'done') return j.result;
    if (j.status === 'error') throw new Error(j.error || 'Something went wrong');
    if (Date.now() - t0 > 25 * 60 * 1000) throw new Error('This is taking too long. Please try again.');
  }
}

export const api = {
  // STOP ALL (kill switch)
  stopAll:    () => request('POST', '/kill/stop'),
  resumeAll:  () => request('POST', '/kill/resume'),
  stopStatus: () => request('GET',  '/kill/status'),
  // Accounts
  getAccounts:   ()         => request('GET',    '/accounts'),
  addAccount:    (data)     => request('POST',   '/accounts', data),
  updateAccount: (id, data) => request('PUT',    `/accounts/${id}`, data),
  deleteAccount: (id)       => request('DELETE', `/accounts/${id}`),
  saveReactionProfile: (id, data) => request('PUT', `/accounts/${id}/reaction-profile`, data),
  // Content processing
  processUrl:  (url, account_id, options = {}, onStatus) =>
    requestJob('POST', '/content/process-url', { url, account_id, ...toApiOptions(options) }, false, onStatus),
  processFile: (file, account_id, options = {}, onStatus) => {
    const fd = new FormData();
    fd.append('video', file);
    if (account_id) fd.append('account_id', account_id);
    Object.entries(toApiOptions(options)).forEach(([k, v]) => fd.append(k, String(v)));
    return requestJob('POST', '/content/process-file', fd, true, onStatus);
  },
  generateReaction: (postId, body = {}) => request('POST', `/content/reaction/${postId}`, body),
  regenerateCaption: (postId, account_id, options = {}) =>
    request('POST', `/content/regenerate/${postId}`, { account_id: account_id || undefined, ...toApiOptions(options) }),
  updateCaption: (postId, data) => request('PUT', `/content/caption/${postId}`, data),
  attachVideo: (postId, file) => {
    const fd = new FormData();
    fd.append('video', file);
    return request('POST', `/content/attach-video/${postId}`, fd, true);
  },
  enhanceVideo:  (postId, opts, onStatus) => requestJob('POST', `/content/enhance/${postId}`, opts, false, onStatus),
  autopilot:         () => request('GET', '/autopilot'),
  autopilotSettings: (id, body) => request('PUT', `/autopilot/${id}/settings`, body),
  autopilotQueue:    (id) => request('GET', `/autopilot/${id}/queue`),
  autopilotAdd:      (id, urls, options) => request('POST', `/autopilot/${id}/queue`, { urls, options }),
  autopilotRemove:   (itemId) => request('DELETE', `/autopilot/item/${itemId}`),
  autopilotRetry:    (itemId) => request('POST', `/autopilot/item/${itemId}/retry`),
  autopilotRun:      (id) => request('POST', `/autopilot/${id}/run`),
  autopilotResume:   (id) => request('POST', `/autopilot/${id}/resume`),
  autopilotSources:      (id) => request('GET', `/autopilot/${id}/sources`),
  autopilotAddSources:   (id, sources, platform) => request('POST', `/autopilot/${id}/sources`, { sources, platform }),
  autopilotScanSources:  (id) => request('POST', `/autopilot/${id}/sources/scan`),
  autopilotRemoveSource: (sourceId) => request('DELETE', `/autopilot/source/${sourceId}`),
  cardPreview:   (account_id, text, scale, mode, theme) => request('POST', '/content/card-preview', { account_id, text, scale, mode, theme }),
  // Posts
  getPosts: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/posts${q ? '?' + q : ''}`);
  },
  publishPost: (id, data = {}) => request('POST', `/posts/${id}/publish`, data),
  schedulePost:(id, data)      => request('POST', `/posts/${id}/schedule`, data),
  deletePost:  (id)            => request('DELETE', `/posts/${id}`),
  clonePost:   (id, account_ids) => request('POST', `/posts/${id}/clone`, { account_ids }),
  getPostLink: (id)            => request('POST', `/posts/${id}/link`),
  refreshAvatar: (id)          => request('POST', `/accounts/${id}/avatar`),
};
