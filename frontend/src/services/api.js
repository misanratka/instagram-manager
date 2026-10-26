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
      localStorage.setItem('im_user', JSON.stringify({ id: payload.id, name: payload.name, email: payload.email }));
      window.history.replaceState({}, '', window.location.pathname);
    }
    const u = localStorage.getItem('im_user');
    return u ? JSON.parse(u).id : null;
  } catch { return null; }
}

async function request(method, path, data, isForm = false, extraHeaders = {}) {
  const userId = getUserId();
  const opts = {
    method,
    headers: isForm
      ? { ...(userId ? { 'x-user-id': userId } : {}), ...extraHeaders }
      : { 'Content-Type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}), ...extraHeaders },
    body: data ? (isForm ? data : JSON.stringify(data)) : undefined
  };
  const res = await fetch(`${BASE}${path}`, opts);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// UI state (camelCase) -> API fields (snake_case). Empty values are omitted so bots/humans can skip any of them.
function toApiOptions(o = {}) {
  const out = {};
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
      if (/job is gone/i.test(e.message)) throw e;      // the server restarted
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
  // Accounts
  getAccounts:   ()         => request('GET',    '/accounts'),
  addAccount:    (data)     => request('POST',   '/accounts', data),
  updateAccount: (id, data) => request('PUT',    `/accounts/${id}`, data),
  deleteAccount: (id)       => request('DELETE', `/accounts/${id}`),
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
  cardPreview:   (account_id, text, scale, mode) => request('POST', '/content/card-preview', { account_id, text, scale, mode }),
  // Posts
  getPosts: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/posts${q ? '?' + q : ''}`);
  },
  publishPost: (id, data = {}) => request('POST', `/posts/${id}/publish`, data),
  schedulePost:(id, data)      => request('POST', `/posts/${id}/schedule`, data),
  deletePost:  (id)            => request('DELETE', `/posts/${id}`),
};
