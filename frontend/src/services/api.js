// In production (Vercel), VITE_BACKEND_URL points to the Render backend.
// In local dev it is empty and Vite proxies /api → localhost:3001.
const BASE = (import.meta.env.VITE_BACKEND_URL ?? '') + '/api';

async function request(method, path, data, isForm = false) {
  const opts = {
    method,
    headers: isForm ? {} : { 'Content-Type': 'application/json' },
    body: data ? (isForm ? data : JSON.stringify(data)) : undefined
  };
  const res = await fetch(`${BASE}${path}`, opts);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export const api = {
  // Accounts
  getAccounts:   ()         => request('GET',    '/accounts'),
  addAccount:    (data)     => request('POST',   '/accounts', data),
  updateAccount: (id, data) => request('PUT',    `/accounts/${id}`, data),
  deleteAccount: (id)       => request('DELETE', `/accounts/${id}`),

  // Content processing
  processUrl:  (url, account_id) => request('POST', '/content/process-url', { url, account_id }),
  processFile: (file, account_id) => {
    const fd = new FormData();
    fd.append('video', file);
    if (account_id) fd.append('account_id', account_id);
    return request('POST', '/content/process-file', fd, true);
  },
  updateCaption: (postId, data) => request('PUT', `/content/caption/${postId}`, data),
  enhanceVideo:  (postId, opts) => request('POST', `/content/enhance/${postId}`, opts),

  // Posts
  getPosts:    (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/posts${q ? '?' + q : ''}`);
  },
  publishPost: (id, data = {}) => request('POST', `/posts/${id}/publish`, data),
  schedulePost:(id, data)      => request('POST', `/posts/${id}/schedule`, data),
  deletePost:  (id)            => request('DELETE', `/posts/${id}`),
};
