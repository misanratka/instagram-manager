const BASE = (import.meta.env.VITE_BACKEND_URL ?? '') + '/api';

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

async function request(method, path, data, isForm = false) {
  const userId = getUserId();
  const opts = {
    method,
    headers: isForm
      ? (userId ? { 'x-user-id': userId } : {})
      : { 'Content-Type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
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
  attachVideo: (postId, file) => {
    const fd = new FormData();
    fd.append('video', file);
    return request('POST', `/content/attach-video/${postId}`, fd, true);
  },
  enhanceVideo:  (postId, opts) => request('POST', `/content/enhance/${postId}`, opts),
  // Posts
  getPosts: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/posts${q ? '?' + q : ''}`);
  },
  publishPost: (id, data = {}) => request('POST', `/posts/${id}/publish`, data),
  schedulePost:(id, data)      => request('POST', `/posts/${id}/schedule`, data),
  deletePost:  (id)            => request('DELETE', `/posts/${id}`),
};
