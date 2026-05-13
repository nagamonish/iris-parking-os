import { brand, escapeHtml } from '../components.js';

const slides = [
  {
    n: '01',
    title: 'Live occupancy before arrival',
    body: 'Drivers see availability by destination, deck, and open spaces before they commit to the trip.'
  },
  {
    n: '02',
    title: 'Camera-to-space intelligence',
    body: 'IRIS maps existing cameras to stall geometry, confidence, and live inventory.'
  },
  {
    n: '03',
    title: 'Exact in-lot guidance',
    body: 'Operators and drivers share one reliable state for spot assignment, rerouting, and rules.'
  }
];

export function renderAuth(state) {
  const isRegister = state.authMode === 'register';
  return `
    <main class="landing">
      <header class="landing-header">
        ${brand()}
        <button class="button secondary" data-auth-mode="${isRegister ? 'login' : 'register'}">
          ${isRegister ? 'Log in' : 'Create account'}
        </button>
      </header>
      <section class="landing-grid">
        <div class="hero-panel">
          <div>${brand()}</div>
          <h1>Sightline<span>.</span></h1>
          <p class="hero-copy">Minimal parking intelligence with registration, persistence, and operational control that operators can trust.</p>
          <div class="hero-actions">
            <button class="button" data-auth-mode="register">Create workspace</button>
            <button class="button secondary" data-auth-mode="login">Log in</button>
          </div>
          <div class="slide-rail">
            ${slides.map((slide, index) => `
              <article class="slide-card ${index === 0 ? 'active' : ''}">
                <span>${slide.n}</span>
                <strong>${escapeHtml(slide.title)}</strong>
                <p>${escapeHtml(slide.body)}</p>
              </article>
            `).join('')}
          </div>
        </div>
        <aside class="auth-panel">
          <h2>${isRegister ? 'Create your workspace' : 'Welcome back'}</h2>
          <p>${isRegister ? 'Accounts are stored in SQLite with persistent sessions.' : 'Log back into your persisted IRIS workspace.'}</p>
          <div class="auth-tabs">
            <button class="auth-tab ${isRegister ? 'active' : ''}" data-auth-mode="register">Register</button>
            <button class="auth-tab ${!isRegister ? 'active' : ''}" data-auth-mode="login">Login</button>
          </div>
          ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ''}
          ${state.notice ? `<div class="notice">${escapeHtml(state.notice)}</div>` : ''}
          ${isRegister ? registerForm() : loginForm()}
        </aside>
      </section>
    </main>
  `;
}

function registerForm() {
  return `
    <form class="form" data-form="register">
      <div class="field">
        <label for="name">Name</label>
        <input id="name" name="name" value="Avery Morgan" autocomplete="name" required>
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" name="email" type="text" inputmode="email" value="ops@example.com" autocomplete="email" required>
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" value="parking123" autocomplete="new-password" required>
      </div>
      <div class="field">
        <label>Account type</label>
        <div class="role-grid">
          <label class="choice">
            <span class="choice-copy">
              <strong>Provider</strong>
              <span>Operate facilities and cameras</span>
            </span>
            <input type="radio" name="role" value="provider" checked>
          </label>
          <label class="choice">
            <span class="choice-copy">
              <strong>Driver</strong>
              <span>Use guidance and availability</span>
            </span>
            <input type="radio" name="role" value="driver">
          </label>
        </div>
      </div>
      <div class="field">
        <label for="organizationName">Workspace name</label>
        <input id="organizationName" name="organizationName" value="Crown City Parking Group" required>
      </div>
      <div class="field">
        <label for="providerType">Provider type</label>
        <select id="providerType" name="providerType">
          <option>Commercial Parking Company</option>
          <option>University</option>
          <option>Apartment Complex</option>
          <option>Office Building</option>
          <option>Event Venue</option>
          <option>Municipal Government</option>
          <option>Hospital</option>
          <option>Private Business</option>
        </select>
      </div>
      <button class="button full" type="submit">Create account</button>
    </form>
  `;
}

function loginForm() {
  return `
    <form class="form" data-form="login">
      <div class="field">
        <label for="loginEmail">Email</label>
        <input id="loginEmail" name="email" type="text" inputmode="email" value="ops@example.com" autocomplete="email" required>
      </div>
      <div class="field">
        <label for="loginPassword">Password</label>
        <input id="loginPassword" name="password" type="password" value="parking123" autocomplete="current-password" required>
      </div>
      <button class="button full" type="submit">Log in</button>
    </form>
  `;
}
