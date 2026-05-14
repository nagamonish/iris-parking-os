export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

export function icon(name) {
  const icons = {
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12c4.8-6 11.2-6 16 0-4.8 6-11.2 6-16 0Z"/><path d="M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/></svg>',
    grid: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v7H4z"/><path d="M14 4h6v16h-6z"/><path d="M4 15h6v5H4z"/></svg>',
    camera: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h9a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><path d="m17 11 4-2v6l-4-2"/></svg>',
    route: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c5-9 9 1 14-8"/><path d="M14 5h5v5"/><path d="M7 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"/></svg>',
    shield: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 2.9 8.4 7 10 4.1-1.6 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-5"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    scan: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3"/><path d="M16 4h3a1 1 0 0 1 1 1v3"/><path d="M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 12h8"/></svg>',
    sun: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4V2"/><path d="M12 22v-2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M4 12H2"/><path d="M22 12h-2"/><path d="m4.93 19.07 1.41-1.41"/><path d="m17.66 6.34 1.41-1.41"/><path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>',
    moon: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 7 7 0 1 0 20 15.5Z"/></svg>',
    logout: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M14 4h5v16h-5"/></svg>'
  };
  return icons[name] || '';
}

export function brand() {
  return `
    <div class="brand">
      <span class="brand-mark">${icon('eye')}</span>
      <span>IRIS Parking OS</span>
    </div>
  `;
}

export function themeToggle(theme, compact = false) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const label = theme === 'dark' ? 'Light' : 'Dark';
  return `
    <button class="theme-toggle ${compact ? 'compact' : ''}" type="button" data-action="theme" aria-label="Switch to ${nextTheme} mode" title="Switch to ${nextTheme} mode">
      ${icon(theme === 'dark' ? 'sun' : 'moon')}
      <span>${label}</span>
    </button>
  `;
}

export function metric(label, value, hint) {
  return `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <em>${escapeHtml(hint)}</em>
    </article>
  `;
}

export function pill(text, dot = false) {
  return `<span class="pill">${dot ? '<i class="dot"></i>' : ''}${escapeHtml(text)}</span>`;
}
