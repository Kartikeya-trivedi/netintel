"""Turn a video or a camera into sampled frames, detections, and clues.

Sampling is deliberate: a 90-second clip at 25fps is 2250 frames, and running
every one of them buys nothing an investigator can read. Frames are spread
evenly across the clip so the sample describes the whole source rather than
its first few seconds.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
import tempfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import numpy as np

from app.services.vision.detector import Detection, detect

logger = logging.getLogger(__name__)

# Enough frames to show movement over time, few enough to stay interactive.
DEFAULT_MAX_FRAMES = 12
MAX_FRAMES_CEILING = 40

# A still camera needs a moment between grabs or every frame is identical.
CCTV_GRAB_INTERVAL_SEC = 0.4

CARRIED = {"backpack", "handbag", "suitcase"}


class VisionError(RuntimeError):
    """A source could not be read. Carries a message meant for the operator."""


@dataclass
class SampledFrame:
    index: int
    timestamp_sec: float
    image: np.ndarray
    detections: list[Detection]


def _require_cv2():
    try:
        import cv2
    except Exception as exc:  # pragma: no cover - opencv is a hard dependency
        raise VisionError(
            "OpenCV is not installed. Run `uv sync` in backend/ to enable video analysis."
        ) from exc
    return cv2


def sample_video(raw: bytes, max_frames: int = DEFAULT_MAX_FRAMES) -> list[SampledFrame]:
    """Evenly spaced frames from an uploaded clip, each already detected over."""
    cv2 = _require_cv2()
    max_frames = max(1, min(max_frames, MAX_FRAMES_CEILING))

    # OpenCV reads containers off disk, not out of memory, so the upload needs a
    # real path. delete=False because Windows will not reopen an unclosed handle.
    with tempfile.NamedTemporaryFile(suffix=".upload", delete=False) as handle:
        handle.write(raw)
        temp_path = Path(handle.name)

    frames: list[SampledFrame] = []
    try:
        capture = cv2.VideoCapture(str(temp_path))
        if not capture.isOpened():
            raise VisionError("That file could not be decoded as video.")
        try:
            total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            fps = float(capture.get(cv2.CAP_PROP_FPS) or 0) or 25.0

            if total > 0:
                step = max(1, total // max_frames)
                targets = list(range(0, total, step))[:max_frames]
            else:
                # Some streams report no frame count; fall back to reading in order.
                targets = list(range(max_frames))

            for position, target in enumerate(targets):
                if total > 0:
                    capture.set(cv2.CAP_PROP_POS_FRAMES, target)
                ok, image = capture.read()
                if not ok or image is None:
                    break
                frames.append(
                    SampledFrame(
                        index=position,
                        timestamp_sec=round(target / fps, 2),
                        image=image,
                        detections=detect(image),
                    )
                )
        finally:
            capture.release()
    finally:
        temp_path.unlink(missing_ok=True)

    if not frames:
        raise VisionError("No frames could be read from that file.")
    return frames


def grab_camera(
    url: str, frames_wanted: int = 4, *, allow_private: bool = True
) -> list[SampledFrame]:
    """Pull a few stills from a camera URL (RTSP, MJPEG, or a snapshot endpoint)."""
    cv2 = _require_cv2()
    _guard_url(url, allow_private=allow_private)
    frames_wanted = max(1, min(frames_wanted, MAX_FRAMES_CEILING))

    capture = cv2.VideoCapture(url)
    if not capture.isOpened():
        raise VisionError(f"Could not open the camera at {url}.")
    try:
        frames: list[SampledFrame] = []
        for position in range(frames_wanted):
            ok, image = capture.read()
            if not ok or image is None:
                break
            frames.append(
                SampledFrame(
                    index=position,
                    timestamp_sec=round(position * CCTV_GRAB_INTERVAL_SEC, 2),
                    image=image,
                    detections=detect(image),
                )
            )
    finally:
        capture.release()

    if not frames:
        raise VisionError("The camera opened but returned no usable frames.")
    return frames


def _guard_url(url: str, *, allow_private: bool) -> None:
    """Reject anything that is not a camera URL, and optionally private hosts.

    The server fetches this address on the operator's behalf, so an unchecked
    value is a request-forgery primitive. Private ranges stay reachable by
    default because that is where cameras actually live; production sets
    VISION_ALLOW_PRIVATE_HOSTS=false and whitelists at the network layer.
    """
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https", "rtsp", "rtsps"}:
        raise VisionError("Camera URL must be http, https, rtsp, or rtsps.")
    if not parsed.hostname:
        raise VisionError("Camera URL has no host.")
    if allow_private:
        return
    try:
        resolved = socket.gethostbyname(parsed.hostname)
        address = ipaddress.ip_address(resolved)
    except (OSError, ValueError) as exc:
        raise VisionError(f"Could not resolve {parsed.hostname}.") from exc
    if address.is_private or address.is_loopback or address.is_link_local:
        raise VisionError("Private and loopback camera addresses are disabled on this server.")


def annotate(frame: SampledFrame) -> bytes:
    """The frame with its boxes drawn on, as JPEG bytes.

    An investigator has to be able to see what the model saw; a label and a
    score with no box on the picture is an assertion, not evidence.
    """
    cv2 = _require_cv2()
    canvas = frame.image.copy()
    height = canvas.shape[0]
    scale = max(0.4, min(1.0, height / 720))

    for found in frame.detections:
        x1, y1, x2, y2 = found.box
        colour = _colour_for(found.relevance)
        cv2.rectangle(canvas, (x1, y1), (x2, y2), colour, max(1, int(2 * scale)))
        caption = f"{found.label} {found.confidence:.0%}"
        (text_w, text_h), _ = cv2.getTextSize(caption, cv2.FONT_HERSHEY_SIMPLEX, 0.5 * scale, 1)
        cv2.rectangle(canvas, (x1, max(0, y1 - text_h - 6)), (x1 + text_w + 6, y1), colour, -1)
        cv2.putText(
            canvas,
            caption,
            (x1 + 3, max(text_h, y1 - 4)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5 * scale,
            (16, 16, 18),
            1,
            cv2.LINE_AA,
        )

    ok, buffer = cv2.imencode(".jpg", canvas, [cv2.IMWRITE_JPEG_QUALITY, 82])
    if not ok:
        raise VisionError("Frame could not be encoded.")
    return bytes(buffer.tobytes())


def _colour_for(relevance: str) -> tuple[int, int, int]:
    """BGR, matched to how the UI already colours entity types."""
    return {
        "person": (120, 190, 90),
        "vehicle": (220, 170, 80),
        "carried": (90, 150, 240),
        "device": (200, 140, 220),
        "weapon": (70, 70, 230),
    }.get(relevance, (150, 150, 155))


def derive_clues(frames: list[SampledFrame]) -> list[dict]:
    """Read leads out of the per-frame detections.

    Every clue names the frames it came from. A clue an investigator cannot
    open back to a picture is not usable in a case file.
    """
    clues: list[dict] = []

    def frames_with(predicate) -> list[int]:
        return [f.index for f in frames if predicate(f)]

    # Peak headcount — how many people were on camera at the busiest moment.
    per_frame_people = {
        f.index: sum(1 for d in f.detections if d.label == "person") for f in frames
    }
    peak = max(per_frame_people.values(), default=0)
    if peak >= 2:
        clues.append(
            {
                "kind": "group",
                "severity": "high" if peak >= 4 else "medium",
                "title": f"{peak} people on camera at once",
                "detail": "More than one person is in frame at the same time.",
                "frames": [i for i, n in per_frame_people.items() if n == peak],
            }
        )
    elif peak == 1:
        clues.append(
            {
                "kind": "presence",
                "severity": "low",
                "title": "One person on camera",
                "detail": "A single person appears in the sampled frames.",
                "frames": [i for i, n in per_frame_people.items() if n == 1],
            }
        )

    # A person and a bag in the same frame is the shape of a handover.
    handoff = frames_with(
        lambda f: any(d.label == "person" for d in f.detections)
        and any(d.label in CARRIED for d in f.detections)
    )
    if handoff:
        carried = sorted({d.label for f in frames for d in f.detections if d.label in CARRIED})
        clues.append(
            {
                "kind": "carried_item",
                "severity": "medium",
                "title": f"Person with {', '.join(carried)}",
                "detail": "A carried item appears alongside a person — check for a handover.",
                "frames": handoff,
            }
        )

    # A vehicle across several sampled frames is a vehicle that stayed.
    vehicle_frames = frames_with(lambda f: any(d.relevance == "vehicle" for d in f.detections))
    if len(vehicle_frames) >= 2:
        vehicles = sorted(
            {d.label for f in frames for d in f.detections if d.relevance == "vehicle"}
        )
        clues.append(
            {
                "kind": "vehicle",
                "severity": "medium",
                "title": f"{', '.join(vehicles)} present across {len(vehicle_frames)} frames",
                "detail": "A vehicle stays in view long enough to be more than passing traffic.",
                "frames": vehicle_frames,
            }
        )

    weapon_frames = frames_with(lambda f: any(d.relevance == "weapon" for d in f.detections))
    if weapon_frames:
        clues.append(
            {
                "kind": "weapon",
                "severity": "high",
                "title": "Possible weapon in frame",
                "detail": "Review directly — this class is easily confused and needs a human.",
                "frames": weapon_frames,
            }
        )

    device_frames = frames_with(lambda f: any(d.relevance == "device" for d in f.detections))
    if device_frames:
        clues.append(
            {
                "kind": "device",
                "severity": "low",
                "title": "Phone or laptop in use",
                "detail": "A device in frame can be cross-checked against call records.",
                "frames": device_frames,
            }
        )

    if not clues:
        clues.append(
            {
                "kind": "none",
                "severity": "low",
                "title": "Nothing of interest detected",
                "detail": "The sampled frames contain no people, vehicles, or carried items.",
                "frames": [],
            }
        )
    return clues


def summarise(frames: list[SampledFrame]) -> dict:
    """Counts the UI shows above the frame strip."""
    labels: Counter[str] = Counter()
    for frame in frames:
        labels.update(found.label for found in frame.detections)
    return {
        "frames": len(frames),
        "detections": sum(len(f.detections) for f in frames),
        "labels": dict(labels.most_common()),
        "duration_sec": round(max((f.timestamp_sec for f in frames), default=0.0), 2),
    }


__all__ = [
    "Detection",
    "SampledFrame",
    "VisionError",
    "annotate",
    "derive_clues",
    "grab_camera",
    "sample_video",
    "summarise",
]
