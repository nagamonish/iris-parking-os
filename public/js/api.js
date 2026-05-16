async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      ...(isFormData ? {} : { 'content-type': 'application/json' }),
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }
  return payload;
}

export const api = {
  me: () => request('/api/me'),
  workspace: () => request('/api/workspace'),
  register: (body) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }),
  addFacility: (body) => request('/api/facilities', { method: 'POST', body: JSON.stringify(body) }),
  scan: () => request('/api/scan', { method: 'POST', body: JSON.stringify({}) }),
  cameraEvent: (body) => request('/api/camera-events', { method: 'POST', body: JSON.stringify(body) }),
  saveCalibration: (body) => request('/api/facility-calibration', { method: 'POST', body: JSON.stringify(body) }),
  visionAnalyze: (body, options = {}) => fetch('/api/vision/analyze', { method: 'POST', credentials: 'same-origin', body, ...options }),
  reassign: () => request('/api/driver/reassign', { method: 'POST', body: JSON.stringify({}) })
};
