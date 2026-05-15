#!/usr/bin/env python3
import argparse
import csv
import json
import math
import sys
import time
from collections import deque


DEFAULT_MODEL = "auto"
AUTO_OBB_MODEL = "yolo26m-obb.pt"
AUTO_FALLBACK_MODEL = "yolov8n.pt"
VEHICLE_CLASS_IDS = [2, 3, 5, 7]
VEHICLE_LABELS = {"car", "motorcycle", "bus", "truck"}
OBB_VEHICLE_LABELS = {"small_vehicle", "large_vehicle", "vehicle"}


def emit(payload):
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def setup_error(message):
    emit({
        "type": "setup_required",
        "message": message,
        "install": "python3.11 -m venv .venv && .venv/bin/python -m pip install -r vision/requirements.txt"
    })


try:
    import cv2
    import numpy as np
except Exception as exc:
    setup_error(f"OpenCV/NumPy are required for real-world detection: {exc}")
    raise SystemExit(2)


def parse_args():
    parser = argparse.ArgumentParser(description="Sightline parking occupancy detector")
    parser.add_argument("--video", required=True)
    parser.add_argument("--calibration", required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--confidence", type=float, default=0.55)
    parser.add_argument("--sample-rate", type=float, default=4.0)
    parser.add_argument("--event-window", type=int, default=7)
    parser.add_argument("--occupancy-threshold", type=float, default=0.46)
    parser.add_argument("--warmup-seconds", type=float, default=3.2)
    parser.add_argument("--max-space-events-per-second", type=int, default=2)
    parser.add_argument("--lane-cooldown-seconds", type=float, default=5.0)
    parser.add_argument("--allow-template-space-events", action="store_true")
    parser.add_argument("--ground-truth")
    parser.add_argument("--emit-progress", action="store_true")
    parser.add_argument("--allow-motion-fallback", action="store_true")
    return parser.parse_args()


def load_json(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return {}


def normalize_event_type(value):
    value = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "entered": "space_occupied",
        "vehicle_entered": "space_occupied",
        "vehicle_in": "space_occupied",
        "car_entered": "space_occupied",
        "exit": "space_opened",
        "exited": "space_opened",
        "vehicle_exited": "space_opened",
        "vehicle_left": "space_opened",
        "vehicle_out": "space_opened",
        "open": "space_opened",
        "available": "space_opened",
        "occupied": "space_occupied",
        "parked": "space_occupied",
        "motion": "motion_detected"
    }
    return aliases.get(value, value)


def read_ground_truth(path):
    if not path:
        return None

    try:
        if path.lower().endswith(".csv"):
            with open(path, "r", encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
            events = rows
            tolerance = 2.5
            if rows:
                raw_tolerance = rows[0].get("toleranceSeconds", rows[0].get("tolerance", ""))
                if raw_tolerance:
                    tolerance = float(raw_tolerance)
        else:
            data = load_json(path)
            events = data.get("events", data if isinstance(data, list) else [])
            tolerance = float(data.get("toleranceSeconds", data.get("tolerance", 2.5))) if isinstance(data, dict) else 2.5
    except Exception as exc:
        emit({"type": "error", "message": f"Unable to read ground truth: {exc}"})
        return None

    normalized = []
    for event in events:
        timestamp = event.get(
            "timeSeconds",
            event.get("time_seconds", event.get("time", event.get("timestamp", event.get("videoSecond", event.get("video_second", event.get("second", 0))))))
        )
        try:
            timestamp = float(timestamp)
        except Exception:
            timestamp = 0.0
        event_type = normalize_event_type(event.get("eventType", event.get("event_type", event.get("type", ""))))
        if not event_type:
            continue
        space_id = (
            event.get("spaceId")
            or event.get("space_id")
            or event.get("spotId")
            or event.get("spot_id")
            or event.get("stall")
            or event.get("region")
            or ""
        )
        normalized.append({
            "time": timestamp,
            "eventType": event_type,
            "spaceId": str(space_id).strip()
        })

    return {"events": normalized, "tolerance": tolerance}


def events_match(predicted, truth, tolerance):
    if normalize_event_type(predicted.get("eventType")) != normalize_event_type(truth.get("eventType")):
        return False
    predicted_space = str(predicted.get("spaceId") or "")
    truth_space = str(truth.get("spaceId") or "")
    if truth_space and predicted_space and truth_space != predicted_space:
        return False
    return abs(float(predicted.get("timestamp", 0)) - float(truth.get("time", 0))) <= tolerance


def confidence_bucket(confidence):
    confidence = int(confidence or 0)
    if confidence < 70:
        return "50-69"
    if confidence < 80:
        return "70-79"
    if confidence < 90:
        return "80-89"
    if confidence < 95:
        return "90-94"
    return "95-99"


def build_validation_report(predictions, ground_truth):
    if not ground_truth:
        return None

    truth_events = ground_truth["events"]
    tolerance = ground_truth["tolerance"]
    matched_truth = set()
    matched_predictions = set()
    matches = []

    for prediction_index, prediction in enumerate(predictions):
        candidates = []
        for truth_index, truth in enumerate(truth_events):
            if truth_index in matched_truth or not events_match(prediction, truth, tolerance):
                continue
            latency = float(prediction.get("timestamp", 0)) - float(truth.get("time", 0))
            candidates.append((abs(latency), latency, truth_index))
        if not candidates:
            continue
        _, latency, truth_index = sorted(candidates, key=lambda item: item[0])[0]
        matched_truth.add(truth_index)
        matched_predictions.add(prediction_index)
        matches.append({"prediction": prediction_index, "truth": truth_index, "latency": round(latency, 2)})

    tp = len(matches)
    fp = max(0, len(predictions) - tp)
    fn = max(0, len(truth_events) - tp)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    latencies = [match["latency"] for match in matches]

    buckets = {}
    for index, prediction in enumerate(predictions):
        key = confidence_bucket(prediction.get("confidence", 0))
        bucket = buckets.setdefault(key, {"bucket": key, "total": 0, "correct": 0, "accuracy": 0})
        bucket["total"] += 1
        if index in matched_predictions:
            bucket["correct"] += 1

    for bucket in buckets.values():
        bucket["accuracy"] = round(bucket["correct"] / bucket["total"], 3) if bucket["total"] else 0

    false_positive_events = [event for index, event in enumerate(predictions) if index not in matched_predictions]
    warnings = []
    if truth_events and len(predictions) > max(10, len(truth_events) * 4):
        warnings.append(
            f"Ground truth has {len(truth_events)} labeled event"
            f"{'' if len(truth_events) == 1 else 's'} but the detector produced {len(predictions)} predictions. "
            "Precision is only meaningful when the file labels every visible occupancy or motion event in the clip."
        )

    burst_seconds = {}
    for event in false_positive_events:
        second = round(float(event.get("timestamp", event.get("videoSecond", 0))), 1)
        burst_seconds[second] = burst_seconds.get(second, 0) + 1
    if any(count >= 3 for count in burst_seconds.values()):
        warnings.append(
            "Several false positives happened at the same video second. That usually points to camera calibration "
            "polygons that do not match the footage, or a vehicle confidence threshold that is too low for this angle."
        )

    return {
        "type": "validation",
        "truthEvents": len(truth_events),
        "predictedEvents": len(predictions),
        "truePositives": tp,
        "falsePositives": fp,
        "falseNegatives": fn,
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "f1": round(f1, 3),
        "meanLatencySeconds": round(sum(latencies) / len(latencies), 2) if latencies else None,
        "toleranceSeconds": tolerance,
        "matches": matches,
        "missed": [event for index, event in enumerate(truth_events) if index not in matched_truth],
        "falsePositiveSamples": false_positive_events[:6],
        "confidenceBuckets": [buckets[key] for key in ["50-69", "70-79", "80-89", "90-94", "95-99"] if key in buckets],
        "warnings": warnings
    }


def default_calibration(width, height):
    spaces = []
    start_x = 0.15
    start_y = 0.24
    space_w = 0.105
    space_h = 0.19
    gap_x = 0.035
    gap_y = 0.11
    for row in range(2):
        for col in range(5):
            x = start_x + col * (space_w + gap_x)
            y = start_y + row * (space_h + gap_y)
            spaces.append({
                "id": f"P{row * 5 + col + 1}",
                "points": [[x, y], [x + space_w, y], [x + space_w, y + space_h], [x, y + space_h]]
            })
    return {
        "spaces": spaces,
        "lanes": [{
            "id": "main_lane",
            "points": [[0.04, 0.72], [0.96, 0.72], [0.96, 0.92], [0.04, 0.92]]
        }],
        "notes": "Default calibration. Replace with camera-specific stall and lane polygons for real deployments."
    }


def to_pixels(points, width, height):
    converted = []
    normalized = all(0 <= float(x) <= 1 and 0 <= float(y) <= 1 for x, y in points)
    for x, y in points:
        converted.append([
            int(round(float(x) * width if normalized else float(x))),
            int(round(float(y) * height if normalized else float(y)))
        ])
    return np.array(converted, dtype=np.int32)


def build_region(region, width, height):
    polygon = to_pixels(region.get("points", []), width, height)
    mask = np.zeros((height, width), dtype=np.uint8)
    if len(polygon) >= 3:
        cv2.fillPoly(mask, [polygon], 255)
    return {
        "id": str(region.get("id") or region.get("label") or "region"),
        "polygon": polygon,
        "mask": mask,
        "area": max(1, int(np.count_nonzero(mask)))
    }


def region_templates_match(actual_regions, template_regions):
    if len(actual_regions or []) != len(template_regions or []):
        return False
    for actual, template in zip(actual_regions or [], template_regions or []):
        if str(actual.get("id")) != str(template.get("id")):
            return False
        actual_points = actual.get("points") or []
        template_points = template.get("points") or []
        if len(actual_points) != len(template_points):
            return False
        for actual_point, template_point in zip(actual_points, template_points):
            if len(actual_point) != 2 or len(template_point) != 2:
                return False
            if abs(float(actual_point[0]) - float(template_point[0])) > 0.001:
                return False
            if abs(float(actual_point[1]) - float(template_point[1])) > 0.001:
                return False
    return True


def load_calibration(path, width, height):
    data = load_json(path)
    used_default = not data.get("spaces")
    if not data.get("spaces"):
        data = default_calibration(width, height)
    default_template = default_calibration(width, height)
    is_template = used_default or (
        region_templates_match(data.get("spaces"), default_template.get("spaces"))
        and region_templates_match(data.get("lanes"), default_template.get("lanes"))
    )
    spaces = [build_region(space, width, height) for space in data.get("spaces", [])]
    lanes = [build_region(lane, width, height) for lane in data.get("lanes", [])]
    return {**data, "spaces_px": spaces, "lanes_px": lanes, "is_template": is_template}


def box_mask(box, width, height):
    x1, y1, x2, y2 = [int(round(value)) for value in box]
    x1 = max(0, min(width - 1, x1))
    x2 = max(0, min(width - 1, x2))
    y1 = max(0, min(height - 1, y1))
    y2 = max(0, min(height - 1, y2))
    mask = np.zeros((height, width), dtype=np.uint8)
    if x2 > x1 and y2 > y1:
        mask[y1:y2, x1:x2] = 255
    return mask


def polygon_from_box(box):
    x1, y1, x2, y2 = [float(value) for value in box]
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]


def box_from_polygon(polygon):
    points = np.array(polygon, dtype=np.float32)
    x_values = points[:, 0]
    y_values = points[:, 1]
    return [float(x_values.min()), float(y_values.min()), float(x_values.max()), float(y_values.max())]


def detection_mask(detection, width, height):
    polygon = detection.get("polygon")
    if polygon and len(polygon) >= 3:
        mask = np.zeros((height, width), dtype=np.uint8)
        points = np.array(polygon, dtype=np.int32)
        points[:, 0] = np.clip(points[:, 0], 0, width - 1)
        points[:, 1] = np.clip(points[:, 1], 0, height - 1)
        cv2.fillPoly(mask, [points], 255)
        return mask
    return box_mask(detection["box"], width, height)


def box_center(box):
    x1, y1, x2, y2 = box
    return ((x1 + x2) / 2, (y1 + y2) / 2)


def detection_center(detection):
    polygon = detection.get("polygon")
    if polygon and len(polygon) >= 3:
        points = np.array(polygon, dtype=np.float32)
        return (float(points[:, 0].mean()), float(points[:, 1].mean()))
    return box_center(detection["box"])


def center_distance(detection_a, detection_b):
    ax, ay = detection_center(detection_a)
    bx, by = detection_center(detection_b)
    return math.hypot(ax - bx, ay - by)


def center_in_region(detection, region):
    cx, cy = detection_center(detection)
    return cv2.pointPolygonTest(region["polygon"], (float(cx), float(cy)), False) >= 0


def overlap_ratio(detection, region, width, height):
    vehicle_mask = detection_mask(detection, width, height)
    overlap = cv2.bitwise_and(vehicle_mask, region["mask"])
    return np.count_nonzero(overlap) / region["area"]


def tensor_to_list(value):
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "tolist"):
        return value.tolist()
    return value


def tensor_to_float(value):
    if hasattr(value, "item"):
        return float(value.item())
    return float(value)


def normalize_label(label):
    return str(label or "").strip().lower().replace("-", "_").replace(" ", "_")


def is_vehicle_label(label):
    normalized = normalize_label(label)
    return normalized in VEHICLE_LABELS or normalized in OBB_VEHICLE_LABELS


class VehicleDetector:
    def __init__(self, model_path, confidence, allow_motion_fallback):
        self.requested_model_path = model_path or DEFAULT_MODEL
        self.auto_fallback = str(self.requested_model_path).lower() in {"auto", "auto-obb", "auto_obb", "auto_obb_v8"}
        self.model_path = AUTO_OBB_MODEL if self.auto_fallback else self.requested_model_path
        self.fallback_model_path = AUTO_FALLBACK_MODEL if self.auto_fallback else None
        self.confidence = confidence
        self.model = None
        self.fallback_model = None
        self.uses_obb = "obb" in str(self.model_path or "").lower()
        self.detector_type = "auto_obb_v8" if self.auto_fallback else ("yolo_obb" if self.uses_obb else "yolo")
        self.motion_fallback = False
        self.fallback_warning_sent = False
        self.background = cv2.createBackgroundSubtractorMOG2(
            history=180,
            varThreshold=36,
            detectShadows=True
        )

        if self.requested_model_path and str(self.requested_model_path).lower() != "none":
            try:
                from ultralytics import YOLO
                self.YOLO = YOLO
                self.model = YOLO(self.model_path)
            except Exception as exc:
                if not allow_motion_fallback:
                    setup_error(f"YOLO model runtime is required for vehicle detection: {exc}")
                    raise SystemExit(2)
                self.motion_fallback = True
                emit({"type": "warning", "message": f"Using motion fallback because YOLO failed to load: {exc}"})
        else:
            self.motion_fallback = True

    def detect(self, frame):
        if self.model is None:
            return self.detect_motion(frame)

        detections = self.detect_with_model(self.model, frame, self.uses_obb)
        if detections or not self.auto_fallback:
            return detections

        if self.fallback_model is None:
            self.fallback_model = self.YOLO(self.fallback_model_path)
        fallback_detections = self.detect_with_model(self.fallback_model, frame, False)
        if fallback_detections and not self.fallback_warning_sent:
            self.fallback_warning_sent = True
            emit({
                "type": "warning",
                "message": (
                    f"{self.model_path} produced no detections on this footage, so Auto mode "
                    f"fell back to {self.fallback_model_path}. This is common for low-angle CCTV clips."
                )
            })
        for detection in fallback_detections:
            detection["source"] = "yolo_auto_fallback"
        return fallback_detections

    def detect_with_model(self, model, frame, uses_obb):
        predict_args = {
            "conf": self.confidence,
            "imgsz": 1024 if uses_obb else 640,
            "verbose": False
        }
        if not uses_obb:
            predict_args["classes"] = VEHICLE_CLASS_IDS

        results = model.predict(frame, **predict_args)
        detections = []
        names = model.names
        for result in results:
            if uses_obb:
                detections.extend(self.detect_obb(result, names))
            else:
                detections.extend(self.detect_boxes(result, names))
        return detections

    def detect_obb(self, result, names):
        obb = getattr(result, "obb", None)
        if obb is None or getattr(obb, "cls", None) is None:
            return []

        detections = []
        polygons = tensor_to_list(obb.xyxyxyxy)
        classes = tensor_to_list(obb.cls)
        confidences = tensor_to_list(obb.conf)
        for polygon, cls_value, conf_value in zip(polygons, classes, confidences):
            cls_id = int(cls_value)
            label = str(names.get(cls_id, cls_id))
            if not is_vehicle_label(label):
                continue
            normalized_polygon = [[float(x), float(y)] for x, y in polygon]
            detections.append({
                "box": box_from_polygon(normalized_polygon),
                "polygon": normalized_polygon,
                "confidence": tensor_to_float(conf_value),
                "label": normalize_label(label),
                "source": "yolo_obb"
            })
        return detections

    def detect_boxes(self, result, names):
        boxes = getattr(result, "boxes", None)
        if boxes is None:
            return []

        detections = []
        for box in boxes:
            cls_id = int(tensor_to_float(box.cls[0]))
            label = str(names.get(cls_id, cls_id))
            if not is_vehicle_label(label):
                continue
            xyxy = [float(value) for value in tensor_to_list(box.xyxy[0])]
            detections.append({
                "box": xyxy,
                "polygon": polygon_from_box(xyxy),
                "confidence": tensor_to_float(box.conf[0]),
                "label": normalize_label(label),
                "source": "yolo"
            })
        return detections

    def detect_motion(self, frame):
        blurred = cv2.GaussianBlur(frame, (5, 5), 0)
        mask = self.background.apply(blurred)
        _, mask = cv2.threshold(mask, 250, 255, cv2.THRESH_BINARY)
        kernel = np.ones((5, 5), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        frame_area = frame.shape[0] * frame.shape[1]
        detections = []
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < frame_area * 0.004:
                continue
            x, y, w, h = cv2.boundingRect(contour)
            if w < 24 or h < 18:
                continue
            confidence = min(0.82, max(0.42, math.sqrt(area / frame_area) * 4.5))
            detections.append({
                "box": [x, y, x + w, y + h],
                "polygon": polygon_from_box([x, y, x + w, y + h]),
                "confidence": confidence,
                "label": "vehicle_candidate",
                "source": "motion"
            })
        return detections


class OccupancyModel:
    def __init__(
        self,
        spaces,
        lanes,
        width,
        height,
        window,
        threshold,
        warmup_seconds,
        max_space_events_per_second,
        lane_cooldown_seconds
    ):
        self.spaces = spaces
        self.lanes = lanes
        self.width = width
        self.height = height
        self.window = window
        self.threshold = threshold
        self.warmup_seconds = warmup_seconds
        self.max_space_events_per_second = max(1, max_space_events_per_second)
        self.lane_cooldown_seconds = max(1.0, lane_cooldown_seconds)
        self.space_history = {space["id"]: deque(maxlen=window) for space in spaces}
        self.space_state = {space["id"]: None for space in spaces}
        self.lane_cooldown = {lane["id"]: 0.0 for lane in lanes}
        self.last_burst_warning_at = -999.0
        self.previous_detections = []

    def moving_detections(self, detections):
        if not self.previous_detections:
            return []

        movement_threshold = max(18.0, math.hypot(self.width, self.height) * 0.014)
        max_tracking_jump = max(130.0, math.hypot(self.width, self.height) * 0.16)
        moving = []
        for detection in detections:
            if detection.get("source") == "motion":
                moving.append(detection)
                continue
            distances = [
                center_distance(detection, previous)
                for previous in self.previous_detections
            ]
            if distances and movement_threshold <= min(distances) <= max_tracking_jump:
                moving.append(detection)
        return moving

    def assign_detections_to_spaces(self, detections):
        assigned = {space["id"]: {"score": 0.0, "confidences": []} for space in self.spaces}
        for detection in detections:
            candidates = []
            for space in self.spaces:
                ratio = overlap_ratio(detection, space, self.width, self.height)
                if center_in_region(detection, space):
                    ratio = max(ratio, 0.72)
                if ratio > 0:
                    candidates.append((ratio, space["id"]))
            if not candidates:
                continue
            best_score, best_space_id = max(candidates, key=lambda item: item[0])
            if best_score < self.threshold:
                continue
            slot = assigned[best_space_id]
            slot["score"] = max(slot["score"], best_score)
            slot["confidences"].append(detection["confidence"])
        return assigned

    def update(self, detections, frame_index, timestamp):
        events = []
        space_changes = []
        moving_detections = self.moving_detections(detections)
        assigned_spaces = self.assign_detections_to_spaces(detections)
        for space in self.spaces:
            assignment = assigned_spaces[space["id"]]
            best_score = assignment["score"]
            confidences = assignment["confidences"]
            occupied = best_score >= self.threshold
            history = self.space_history[space["id"]]
            history.append(1 if occupied else 0)
            if len(history) < self.window:
                continue

            stable_score = sum(history) / len(history)
            next_state = stable_score >= 0.62
            previous_state = self.space_state[space["id"]]
            state_strength = stable_score if next_state else 1 - stable_score
            overlap_strength = min(1.0, best_score / max(0.01, self.threshold * 2.2))
            detection_confidence = max(confidences or [0.62])
            confidence = int(round(100 * detection_confidence * (0.38 + state_strength * 0.34 + overlap_strength * 0.2)))
            confidence = max(50, min(95, confidence))

            if previous_state is None:
                self.space_state[space["id"]] = next_state
                continue
            if next_state != previous_state:
                self.space_state[space["id"]] = next_state
                if timestamp < self.warmup_seconds:
                    continue
                event_type = "space_occupied" if next_state else "space_opened"
                delta = 1 if next_state else -1
                space_changes.append({
                    "type": "event",
                    "eventType": event_type,
                    "spaceId": space["id"],
                    "confidence": confidence,
                    "motionScore": int(round(best_score * 100)),
                    "delta": delta,
                    "timestamp": timestamp,
                    "message": f"classified {space['id']} as {'occupied' if next_state else 'open'}."
                })

        if len(space_changes) > self.max_space_events_per_second:
            if timestamp - self.last_burst_warning_at >= max(1.0, self.warmup_seconds):
                self.last_burst_warning_at = timestamp
                events.append({
                    "type": "warning",
                    "timestamp": timestamp,
                    "message": (
                        f"Suppressed {len(space_changes)} simultaneous stall changes at {timestamp:.2f}s. "
                        "That usually means the calibration polygons do not match this camera angle, or the "
                        "confidence threshold should be raised before persisting events."
                    )
                })
        else:
            events.extend(space_changes)

        for lane in self.lanes:
            if timestamp < self.warmup_seconds or timestamp < self.lane_cooldown[lane["id"]]:
                continue
            lane_hits = [d for d in moving_detections if center_in_region(d, lane)]
            if lane_hits:
                best = max(lane_hits, key=lambda item: item["confidence"])
                self.lane_cooldown[lane["id"]] = timestamp + self.lane_cooldown_seconds
                events.append({
                    "type": "event",
                    "eventType": "motion_detected",
                    "spaceId": lane["id"],
                    "confidence": int(round(max(0.55, min(0.96, best["confidence"])) * 100)),
                    "motionScore": 70,
                    "delta": 0,
                    "timestamp": timestamp,
                    "message": f"tracked vehicle motion through lane {lane['id']}."
                })

        self.previous_detections = detections
        return events


def run():
    args = parse_args()
    capture = cv2.VideoCapture(args.video)
    if not capture.isOpened():
        emit({"type": "error", "message": "Unable to open uploaded video."})
        raise SystemExit(1)

    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 30)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = frame_count / fps if fps else 0
    stride = max(1, int(round(fps / max(0.5, args.sample_rate))))

    calibration = load_calibration(args.calibration, width, height)
    ground_truth = read_ground_truth(args.ground_truth)
    emit({
        "type": "calibration",
        "spaces": [space["id"] for space in calibration["spaces_px"]],
        "lanes": [lane["id"] for lane in calibration["lanes_px"]],
        "duration": round(duration, 2),
        "fps": round(fps, 2),
        "frameCount": frame_count
    })
    if ground_truth:
        emit({
            "type": "ground_truth",
            "events": len(ground_truth["events"]),
            "toleranceSeconds": ground_truth["tolerance"]
        })

    if calibration["is_template"] and not args.allow_template_space_events:
        emit({
            "type": "warning",
            "message": (
                "Using the template calibration. Stall occupancy events are disabled for this run because "
                "template boxes do not describe a real camera angle. Replace the JSON polygons with this "
                "camera's actual stall zones to score spaces."
            )
        })

    detector = VehicleDetector(args.model, args.confidence, args.allow_motion_fallback)
    spaces = calibration["spaces_px"] if args.allow_template_space_events or not calibration["is_template"] else []
    occupancy = OccupancyModel(
        spaces,
        calibration["lanes_px"],
        width,
        height,
        args.event_window,
        args.occupancy_threshold,
        args.warmup_seconds,
        args.max_space_events_per_second,
        args.lane_cooldown_seconds
    )

    processed = 0
    emitted = 0
    predictions = []
    started = time.time()
    detector_label = detector.detector_type if detector.model is not None else "motion_fallback"

    for frame_index in range(frame_count or 10**9):
        ok, frame = capture.read()
        if not ok:
            break
        if frame_index % stride != 0:
            continue

        timestamp = frame_index / fps if fps else 0
        detections = detector.detect(frame)
        events = occupancy.update(detections, frame_index, timestamp)
        for event in events:
            if event.get("type") != "event":
                emit(event)
                continue
            event["detector"] = detector_label
            predictions.append({
                "eventType": event.get("eventType"),
                "spaceId": event.get("spaceId"),
                "confidence": event.get("confidence"),
                "timestamp": event.get("timestamp"),
                "videoSecond": event.get("timestamp"),
                "detector": event.get("detector"),
                "motionScore": event.get("motionScore")
            })
            emit(event)
            emitted += 1

        processed += 1
        if args.emit_progress and processed % 6 == 0:
            emit({
                "type": "progress",
                "processedFrames": processed,
                "videoSecond": round(timestamp, 2),
                "detections": len(detections)
            })

    capture.release()
    emit({
        "type": "summary",
        "processedFrames": processed,
        "events": emitted,
        "runtimeSeconds": round(time.time() - started, 2),
        "detector": detector_label,
        "model": args.model,
        "resolvedModel": detector.model_path,
        "fallbackModel": detector.fallback_model_path
    })
    validation = build_validation_report(predictions, ground_truth)
    if validation:
        emit(validation)


if __name__ == "__main__":
    try:
        run()
    except SystemExit:
        raise
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        raise SystemExit(1)
