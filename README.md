# IRIS Parking OS

Minimal, reliable full-stack rebuild of the IRIS / Sightline parking platform.

## What Changed

- Real registration and login with secure password hashing.
- SQLite persistence for users, sessions, properties, facilities, camera events, and driver assignments.
- Clear server/client structure instead of a single static demo file.
- Minimal, professional UI with a carousel-led product motif.
- Local-first development with no external services required.
- Real-footage CV pipeline for operator testing with YOLO/OpenCV, stall calibration polygons, lane regions, temporal smoothing, and persisted live events.

## Run Locally

```bash
npm run dev
```

Then open:

```text
http://localhost:4180
```

The app creates `data/iris.db` automatically on first run.

## Real-World Camera Detection

The operator console can analyze uploaded parking-lot footage from `Camera detection -> Real-world CV detector`.

Install the local CV runtime once:

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -r vision/requirements.txt
```

Then run the web app normally:

```bash
npm run dev
```

The detector uses `auto` mode by default: it tries `yolo26m-obb.pt` for rotated vehicle detection, then falls back to `yolov8n.pt` when OBB sees no vehicles in low-angle CCTV footage. The first run downloads model weights locally. The UI also lets you compare `yolo26m-obb.pt`, `yolo26s-obb.pt`, `yolov8n.pt`, and motion fallback directly. Uploads are stored under `data/uploads/`, calibration JSON under `data/calibrations/`, and both are ignored by git.

The calibration JSON defines parking stall polygons and lane polygons in normalized image coordinates. Use `vision/sample-calibration.json` as the starting format, then replace the points with camera-specific regions for each real lot. The template is intentionally guarded: if you run real footage with the untouched template, the detector disables stall occupancy events and only reports lane motion so fake template boxes cannot pollute the event log.

### Accuracy Validation

You do not have to train a custom model before testing. Start with real clips, a camera-specific calibration file, and ground-truth labels for that exact clip. When you upload a JSON or CSV ground-truth file with the footage, the app runs validation mode and does not write candidate events into SQLite.

Ground-truth JSON:

```json
{
  "toleranceSeconds": 2.5,
  "events": [
    { "timeSeconds": 4.0, "eventType": "vehicle_entered", "spotId": "P7" },
    { "timeSeconds": 11.5, "eventType": "vehicle_left", "spotId": "P7" }
  ]
}
```

CSV uses the same columns:

```csv
timeSeconds,eventType,spotId
4.0,vehicle_entered,P7
11.5,vehicle_left,P7
```

The validation report streams precision, recall, F1, latency, false positives, missed events, confidence buckets, and warnings for sparse labels or calibration mismatch. Ground truth must include every visible event you want scored; a one-event file against an active lot will make legitimate extra detections look like false positives.

## Structure

```text
src/server/
  auth.js       Password hashing, cookie sessions, authenticated user lookup
  db.js         SQLite schema, seed data, workspace queries
  http.js       JSON/static helpers
  server.js     API routes and static app server
  vision.js     Upload persistence and Python detector process runner

vision/
  parking_detector.py      YOLO/OpenCV parking occupancy detector
  requirements.txt         Python CV dependencies
  sample-calibration.json  Example stall and lane polygons

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
- `POST /api/camera-events`
- `POST /api/vision/analyze`
- `POST /api/driver/reassign`

## Notes

Node 24's built-in SQLite module powers the database. The core web app remains dependency-free; the real-world detector is isolated in `vision/` so it can evolve independently from the operator console.
