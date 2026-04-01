const BASE = '/api';

function request(path, options = {}) {
  return fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  }).then((r) => {
    if (!r.ok) return r.json().then((e) => Promise.reject(e));
    return r.json();
  });
}

export const api = {
  getProjects: () => request('/projects'),
  createProject: (data) => request('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id, data) => request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
  getCrumbs: (projectId) => request(`/crumbs${projectId ? `?projectId=${projectId}` : ''}`),
  createCrumb: (data) => request('/crumbs', { method: 'POST', body: JSON.stringify(data) }),
  importCrumbs: (data) => request('/import', { method: 'POST', body: JSON.stringify(data) }),
  getFiles: (projectId) => request(`/files?projectId=${projectId}`),
  createFile: (data) => request('/files', { method: 'POST', body: JSON.stringify(data) }),
  updateFile: (data) => request('/files', { method: 'PUT', body: JSON.stringify(data) }),
  deleteFile: (data) => request('/files', { method: 'DELETE', body: JSON.stringify(data) }),
};
