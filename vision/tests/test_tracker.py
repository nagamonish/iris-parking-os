"""Focused unit tests for IOUTracker + Track in parking_detector.py.

Pure stdlib + numpy/cv2-free for the tracker itself. Run directly:

    python3 vision/tests/test_tracker.py

or via unittest discovery:

    python3 -m unittest vision.tests.test_tracker
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from vision.parking_detector import IOUTracker, Track, _iou


def det(x1, y1, x2, y2, *, conf=0.9, label="car"):
    """Build a minimal detection dict shaped like the detector emits."""
    return {
        "box": [x1, y1, x2, y2],
        "polygon": [[x1, y1], [x2, y1], [x2, y2], [x1, y2]],
        "confidence": conf,
        "label": label,
        "source": "yolo",
    }


class IoUHelperTests(unittest.TestCase):
    def test_identical_boxes(self):
        self.assertAlmostEqual(_iou([0, 0, 10, 10], [0, 0, 10, 10]), 1.0)

    def test_disjoint_boxes(self):
        self.assertEqual(_iou([0, 0, 10, 10], [20, 20, 30, 30]), 0.0)

    def test_half_overlap(self):
        # 10x10 each, overlap is 5x10 = 50, union = 100+100-50 = 150
        self.assertAlmostEqual(_iou([0, 0, 10, 10], [5, 0, 15, 10]), 50 / 150)

    def test_zero_area_box(self):
        self.assertEqual(_iou([0, 0, 0, 0], [0, 0, 10, 10]), 0.0)


class TrackerBasicTests(unittest.TestCase):
    def setUp(self):
        self.tracker = IOUTracker(iou_threshold=0.2, max_age=2, min_hits=2)

    def test_first_detection_creates_track_but_not_confirmed(self):
        confirmed = self.tracker.update([det(0, 0, 50, 50)], timestamp=0.0)
        # min_hits=2, so a brand-new track isn't confirmed yet
        self.assertEqual(confirmed, [])
        self.assertEqual(len(self.tracker.tracks), 1)
        self.assertEqual(self.tracker.tracks[0].id, 1)
        self.assertEqual(self.tracker.tracks[0].hits, 1)

    def test_same_detection_two_frames_confirms_track(self):
        self.tracker.update([det(0, 0, 50, 50)], timestamp=0.0)
        confirmed = self.tracker.update([det(0, 0, 50, 50)], timestamp=0.25)
        self.assertEqual(len(confirmed), 1)
        self.assertEqual(confirmed[0].id, 1)
        self.assertEqual(confirmed[0].hits, 2)

    def test_slow_motion_keeps_track_id_stable(self):
        self.tracker.update([det(0, 0, 50, 50)], timestamp=0.0)
        # Shift by 10px — IoU is still high (~0.66), so it should match.
        self.tracker.update([det(10, 0, 60, 50)], timestamp=0.25)
        confirmed = self.tracker.update([det(20, 0, 70, 50)], timestamp=0.5)
        self.assertEqual(len(confirmed), 1)
        self.assertEqual(confirmed[0].id, 1)
        self.assertEqual(confirmed[0].hits, 3)
        # Centroid history should reflect movement.
        cx, cy = confirmed[0].centroid
        pcx, pcy = confirmed[0].previous_centroid
        self.assertGreater(cx, pcx)


class TrackerLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tracker = IOUTracker(iou_threshold=0.2, max_age=2, min_hits=1)

    def test_track_ages_and_expires(self):
        self.tracker.update([det(0, 0, 50, 50)], timestamp=0.0)
        self.assertEqual(len(self.tracker.tracks), 1)
        # No detections for max_age+1 frames → track should be dropped.
        self.tracker.update([], timestamp=0.25)
        self.assertEqual(self.tracker.tracks[0].age, 1)
        self.tracker.update([], timestamp=0.5)
        self.assertEqual(self.tracker.tracks[0].age, 2)
        self.tracker.update([], timestamp=0.75)
        self.assertEqual(self.tracker.tracks, [])  # expired

    def test_missed_frame_recovers_when_detection_returns(self):
        self.tracker.update([det(0, 0, 50, 50)], timestamp=0.0)
        self.tracker.update([], timestamp=0.25)  # missed
        # Same vehicle reappears in roughly the same spot — should reattach.
        confirmed = self.tracker.update([det(5, 5, 55, 55)], timestamp=0.5)
        self.assertEqual(len(confirmed), 1)
        self.assertEqual(confirmed[0].id, 1)
        self.assertEqual(confirmed[0].hits, 2)
        self.assertEqual(confirmed[0].age, 0)


class TrackerMultiObjectTests(unittest.TestCase):
    def setUp(self):
        self.tracker = IOUTracker(iou_threshold=0.2, max_age=2, min_hits=1)

    def test_two_non_overlapping_detections_get_distinct_ids(self):
        confirmed = self.tracker.update(
            [det(0, 0, 50, 50), det(200, 200, 250, 250)],
            timestamp=0.0,
        )
        self.assertEqual({t.id for t in confirmed}, {1, 2})

    def test_greedy_match_picks_higher_iou(self):
        # Seed two tracks at distinct positions.
        self.tracker.update(
            [det(0, 0, 50, 50), det(100, 100, 150, 150)],
            timestamp=0.0,
        )
        # Detections arrive in the OPPOSITE order. Greedy matching by IoU
        # should still attach each detection to its same-position track.
        confirmed = self.tracker.update(
            [det(102, 102, 152, 152), det(2, 2, 52, 52)],
            timestamp=0.25,
        )
        # Order is implementation detail; what matters is the box→id mapping.
        by_id = {t.id: t.box for t in confirmed}
        self.assertIn(1, by_id)
        self.assertIn(2, by_id)
        # Track 1 was at origin, should still be at origin-ish.
        self.assertLess(by_id[1][0], 50)
        # Track 2 was at (100,100), should still be there-ish.
        self.assertGreater(by_id[2][0], 50)

    def test_new_vehicle_gets_new_id(self):
        self.tracker.update([det(0, 0, 50, 50)], timestamp=0.0)
        self.tracker.update([det(0, 0, 50, 50)], timestamp=0.25)
        confirmed = self.tracker.update(
            [det(0, 0, 50, 50), det(300, 300, 350, 350)],
            timestamp=0.5,
        )
        ids = sorted(t.id for t in confirmed)
        self.assertEqual(ids, [1, 2])


class MinHitsGateTests(unittest.TestCase):
    def test_min_hits_three(self):
        tracker = IOUTracker(iou_threshold=0.2, max_age=2, min_hits=3)
        first = tracker.update([det(0, 0, 50, 50)], timestamp=0.0)
        second = tracker.update([det(0, 0, 50, 50)], timestamp=0.25)
        third = tracker.update([det(0, 0, 50, 50)], timestamp=0.5)
        self.assertEqual(first, [])
        self.assertEqual(second, [])
        self.assertEqual(len(third), 1)
        self.assertEqual(third[0].hits, 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
