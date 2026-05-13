# IRIS Parking OS

Minimal, reliable full-stack rebuild of the IRIS / Sightline parking platform.

## What Changed

- Real registration and login with secure password hashing.
- SQLite persistence for users, sessions, properties, facilities, camera events, and driver assignments.
- Clear server/client structure instead of a single static demo file.
- Minimal, professional UI with a carousel-led product motif.
- Local-first development with no external services required.

## Run Locally

```bash
npm run dev
```

Then open:

```text
http://localhost:4180
```

The app creates `data/iris.db` automatically on first run.

## Structure

```text
src/server/
  auth.js       Password hashing, cookie sessions, authenticated user lookup
  db.js         SQLite schema, seed data, workspace queries
  http.js       JSON/static helpers
  server.js     API routes and static app server

public/
  index.html
  styles.css
  js/
    app.js      UI state, routing, event binding, rendering
    api.js      API client
    components.js
    views/
      auth.js
      dashboard.js
```

## API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/workspace`
- `POST /api/facilities`
- `POST /api/scan`
- `POST /api/driver/reassign`

## Notes

This is intentionally small and dependency-free. Node 24's built-in SQLite module powers the database.
