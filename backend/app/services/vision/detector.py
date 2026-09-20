"""Object detection for a single frame.

YOLOv8n when ultralytics is installed, and a labelled motion fallback when it
is not. The fallback exists because a demo that cannot run the model at all is
worse than one that says so: every result carries the `engine` that produced
it, so nothing downstream can mistake moving pixels for a recognised object.

Model weights download once on first use and are cached by ultralytics.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

ENGINE_YOLO = "yolov8n"
ENGINE_MOTION = "motion-fallback"

# Confidence floor. Below this a COCO detection is noise more often than not,
# and an investigator chasing it wastes the time the tool was meant to save.
MIN_CONFIDENCE = 0.35

# COCO classes grouped by what they mean to an investigator. Anything not
# listed is still detected but lands in "ambient" and is not treated as a lead.
RELEVANCE: dict[str, str] = {
    "person": "person",
    "car": "vehicle",
    "truck": "vehicle",
    "bus": "vehicle",
    "motorcycle": "vehicle",
    "bicycle": "vehicle",
    "train": "vehicle",
    "boat": "vehicle",
    "backpack": "carried",
    "handbag": "carried",
    "suitcase": "carried",
    "cell phone": "device",
    "laptop": "device",
    "knife": "weapon",
    "scissors": "weapon",
    "baseball bat": "weapon",
}


@dataclass(frozen=True)
class Detection:
    """One object found in one frame. Box is pixel (x1, y1, x2, y2)."""

    label: str
    confidence: float
    box: tuple[int, int, int, int]

    @property
    def relevance(self) -> str:
        return RELEVANCE.get(self.label, "ambient")

    def as_dict(self) -> dict[str, Any]:
        return {
            "label": self.label,
            "confidence": round(self.confidence, 3),
            "box": list(self.box),
            "relevance": self.relevance,
        }


@lru_cache(maxsize=1)
def _load_yolo() -> Any | None:
    """Load YOLOv8n once per process, or return None if it is unavailable.

    Cached on the None result too: a missing dependency will not become present
    mid-run, and retrying the import for every frame would cost more than the
    detection.
    """
    try:
        from ultralytics import YOLO
    except Exception:  # pragma: no cover - depends on the install
        logger.info("ultralytics not installed; vision falls back to motion detection")
        return None
    try:
        return YOLO("yolov8n.pt")
    except Exception:  # pragma: no cover - first-run weight download can fail
        logger.exception("YOLOv8n weights could not be loaded")
        return None


def active_engine() -> str:
    return ENGINE_YOLO if _load_yolo() is not None else ENGINE_MOTION


def detect(frame: np.ndarray) -> list[Detection]:
    """Detections for one BGR frame, strongest first."""
    model = _load_yolo()
    if model is None:
        return _detect_motion(frame)
    return _detect_yolo(model, frame)


def _detect_yolo(model: Any, frame: np.ndarray) -> list[Detection]:
    results = model.predict(frame, verbose=False, conf=MIN_CONFIDENCE)
    found: list[Detection] = []
    for result in results:
        names = result.names
        for box in result.boxes:
            confidence = float(box.conf[0])
            if confidence < MIN_CONFIDENCE:
                continue
            x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])
            found.append(
                Detection(
                    label=str(names[int(box.cls[0])]),
                    confidence=confidence,
                    box=(x1, y1, x2, y2),
                )
            )
    found.sort(key=lambda d: d.confidence, reverse=True)
    return found


def _detect_motion(frame: np.ndarray) -> list[Detection]:
    """Contour boxes over the brightest edges — a shape, never an identity.

    Labelled "motion" precisely so it cannot be read as a person or a vehicle.
    """
    try:
        import cv2
    except Exception:  # pragma: no cover - opencv is a hard dependency
        return []

    grey = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(grey, (5, 5), 0)
    edges = cv2.Canny(blurred, 60, 160)
    edges = cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    height, width = grey.shape[:2]
    min_area = (height * width) * 0.01
    found: list[Detection] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if w * h < min_area:
            continue
        # Fraction of the frame the region covers, as a stand-in for confidence.
        found.append(
            Detection(
                label="motion",
                confidence=min(0.99, (w * h) / (height * width) * 4),
                box=(x, y, x + w, y + h),
            )
        )
    found.sort(key=lambda d: d.confidence, reverse=True)
    return found[:8]
