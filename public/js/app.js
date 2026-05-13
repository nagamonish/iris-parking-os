import { api } from './api.js';
import { renderAuth } from './views/auth.js';
import { renderShell } from './views/dashboard.js';

const app = document.getElementById('app');

const state = {
  loading: true,
  user: null,
  workspace: null,
  view: 'overview',
  authMode: 'register',
  error: '',
  notice: ''
};

function setState(patch) {
  Object.assign(state, patch);
  render();
}

function render() {
  if (state.loading) {
    app.innerHTML = '<main class="landing"><section class="landing-grid"><div class="hero-panel"><h1>IRIS<span>.</span></h1><p class="hero-copy">Loading workspace...</p></div></section></main>';
    return;
  }

  app.innerHTML = state.user && state.workspace
    ? renderShell(state)
    : renderAuth(state);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function loadWorkspace() {
  const { workspace } = await api.workspace();
  setState({ user: workspace.user, workspace, error: '', notice: '' });
}

async function initialize() {
  try {
    const [{ user }, { workspace }] = await Promise.all([api.me(), api.workspace()]);
    setState({ loading: false, user, workspace });
  } catch {
    setState({ loading: false, user: null, workspace: null });
  }
}

app.addEventListener('click', async (event) => {
  const authMode = event.target.closest('[data-auth-mode]')?.dataset.authMode;
  if (authMode) {
    setState({ authMode, error: '', notice: '' });
    return;
  }

  const view = event.target.closest('[data-view]')?.dataset.view;
  if (view) {
    setState({ view });
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;

  try {
    if (action === 'logout') {
      await api.logout();
      setState({ user: null, workspace: null, authMode: 'login', notice: 'Logged out.', view: 'overview' });
    }
    if (action === 'refresh') await loadWorkspace();
    if (action === 'scan') {
      const { workspace } = await api.scan();
      setState({ workspace, notice: 'Camera scan saved.', error: '' });
    }
    if (action === 'reassign') {
      const { workspace } = await api.reassign();
      setState({ workspace, notice: 'Driver assignment updated.', error: '' });
    }
  } catch (error) {
    setState({ error: error.message, notice: '' });
  }
});

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('form');
  if (!form) return;
  event.preventDefault();

  const type = form.dataset.form;
  try {
    if (type === 'register') {
      const payload = formData(form);
      const { user, workspace } = await api.register(payload);
      setState({ user, workspace, error: '', notice: '', view: 'overview' });
    }

    if (type === 'login') {
      const { user, workspace } = await api.login(formData(form));
      setState({ user, workspace, error: '', notice: '', view: 'overview' });
    }

    if (type === 'facility') {
      const { workspace } = await api.addFacility(formData(form));
      setState({ workspace, error: '', notice: 'Facility saved to SQLite.' });
    }
  } catch (error) {
    setState({ error: error.message, notice: '' });
  }
});

initialize();
