"""Vision: frame sampling, clue derivation, camera-URL guard, and the API."""

from __future__ import annotations

import numpy as np
import pytest

from app.services.vision import pipeline
from app.services.vision.detector import Detection

cv2 = pytest.importorskip("cv2", reason="OpenCV is required for video analysis")


def _frame(index: int, *labels: str) -> pipeline.SampledFrame:
    """A frame whose detections are exactly `labels`, at fixed boxes."""
    return pipeline.SampledFrame(
        index=index,
        timestamp_sec=float(index),
        image=np.zeros((120, 160, 3), np.uint8),
        detections=[
            Detection(label=label, confidence=0.9, box=(10, 10, 60, 90)) for label in labels
        ],
    )


def _clue_kinds(frames: list[pipeline.SampledFrame]) -> set[str]:
    return {clue["kind"] for clue in pipeline.derive_clues(frames)}


# --- Clue derivation ---------------------------------------------------------


def test_two_people_in_one_frame_is_a_group():
    clues = pipeline.derive_clues([_frame(0, "person", "person")])
    group = next(c for c in clues if c["kind"] == "group")
    assert "2 people" in group["title"]
    assert group["frames"] == [0]


def test_four_people_raises_the_severity():
    clues = pipeline.derive_clues([_frame(0, *["person"] * 4)])
    assert next(c for c in clues if c["kind"] == "group")["severity"] == "high"


def test_a_lone_person_is_presence_not_a_group():
    assert _clue_kinds([_frame(0, "person")]) == {"presence"}


def test_person_with_a_bag_reads_as_a_carried_item():
    clues = pipeline.derive_clues([_frame(0, "person", "backpack")])
    carried = next(c for c in clues if c["kind"] == "carried_item")
    assert "backpack" in carried["title"]


def test_a_bag_with_nobody_holding_it_is_not_a_handover():
    assert "carried_item" not in _clue_kinds([_frame(0, "backpack")])


def test_a_vehicle_in_one_frame_is_passing_traffic():
    assert "vehicle" not in _clue_kinds([_frame(0, "car")])


def test_a_vehicle_across_frames_is_a_lead():
    clues = pipeline.derive_clues([_frame(0, "car"), _frame(1, "car")])
    vehicle = next(c for c in clues if c["kind"] == "vehicle")
    assert vehicle["frames"] == [0, 1]


def test_a_weapon_is_flagged_high_and_sent_to_a_human():
    clues = pipeline.derive_clues([_frame(0, "knife")])
    weapon = next(c for c in clues if c["kind"] == "weapon")
    assert weapon["severity"] == "high"
    assert "human" in weapon["detail"]


def test_an_empty_scene_still_reports_something():
    clues = pipeline.derive_clues([_frame(0)])
    assert [c["kind"] for c in clues] == ["none"]


def test_unlisted_classes_stay_ambient_and_raise_no_clue():
    assert _clue_kinds([_frame(0, "potted plant")]) == {"none"}


def test_every_clue_names_the_frames_it_came_from():
    frames = [_frame(0, "person", "handbag"), _frame(1, "person", "car"), _frame(2, "car")]
    for clue in pipeline.derive_clues(frames):
        assert set(clue["frames"]) <= {f.index for f in frames}


# --- Summary -----------------------------------------------------------------


def test_summary_counts_labels_and_span():
    frames = [_frame(0, "person", "car"), _frame(1, "person")]
    summary = pipeline.summarise(frames)
    assert summary == {
        "frames": 2,
        "detections": 3,
        "labels": {"person": 2, "car": 1},
        "duration_sec": 1.0,
    }


# --- Camera URL guard --------------------------------------------------------


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://cam/1", "not-a-url"])
def test_only_camera_schemes_are_accepted(url):
    with pytest.raises(pipeline.VisionError):
        pipeline._guard_url(url, allow_private=True)


def test_private_cameras_are_reachable_by_default():
    pipeline._guard_url("rtsp://192.168.1.40/stream", allow_private=True)


def test_private_cameras_can_be_locked_out():
    with pytest.raises(pipeline.VisionError, match="Private and loopback"):
        pipeline._guard_url("http://127.0.0.1/snapshot.jpg", allow_private=False)


# --- Frame sampling and annotation ------------------------------------------


def _write_clip(path, frames: int = 30, size=(160, 120), fps: int = 10) -> None:
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    assert writer.isOpened(), "no mp4v encoder available"
    for n in range(frames):
        canvas = np.full((size[1], size[0], 3), 20, np.uint8)
        cv2.rectangle(canvas, (n * 3, 30), (n * 3 + 40, 90), (200, 200, 200), -1)
        writer.write(canvas)
    writer.release()


def test_sampling_spreads_across_the_whole_clip(tmp_path):
    clip = tmp_path / "clip.mp4"
    _write_clip(clip, frames=30, fps=10)

    frames = pipeline.sample_video(clip.read_bytes(), max_frames=5)

    assert len(frames) == 5
    assert [f.index for f in frames] == [0, 1, 2, 3, 4]
    # Spread, not clustered at the start: the last sample is well into the clip.
    assert frames[-1].timestamp_sec >= 2.0
    assert frames[0].timestamp_sec == 0.0


def test_sampling_is_capped_even_when_more_is_asked_for(tmp_path):
    clip = tmp_path / "clip.mp4"
    _write_clip(clip, frames=200, fps=25)
    frames = pipeline.sample_video(clip.read_bytes(), max_frames=10_000)
    assert len(frames) <= pipeline.MAX_FRAMES_CEILING


def test_a_file_that_is_not_video_is_rejected_clearly():
    with pytest.raises(pipeline.VisionError, match="could not be decoded"):
        pipeline.sample_video(b"this is not a video", max_frames=4)


def test_annotate_returns_a_jpeg_with_the_boxes_drawn():
    frame = _frame(0, "person")
    data = pipeline.annotate(frame)
    assert data[:2] == b"\xff\xd8"  # JPEG SOI
    decoded = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == frame.image.shape
    # The source frame is uniformly black; a drawn box has to have changed it.
    assert decoded.any()


# --- API ---------------------------------------------------------------------


def test_listing_a_case_with_no_runs_is_empty(client, case):
    response = client.get(f"/api/cases/{case.id}/vision")
    assert response.status_code == 200
    assert response.json() == []


def test_listing_an_unknown_case_is_404(client):
    assert client.get("/api/cases/9999/vision").status_code == 404


def test_an_empty_upload_is_refused(client, case):
    response = client.post(
        f"/api/cases/{case.id}/vision/video",
        files={"file": ("empty.mp4", b"", "video/mp4")},
    )
    assert response.status_code == 422


def test_uploading_to_an_unknown_case_is_404(client):
    response = client.post(
        "/api/cases/9999/vision/video",
        files={"file": ("clip.mp4", b"data", "video/mp4")},
    )
    assert response.status_code == 404


def test_a_blank_camera_url_is_refused(client, case):
    response = client.post(f"/api/cases/{case.id}/vision/camera", json={"url": "   "})
    assert response.status_code == 422


def test_an_unknown_run_is_404(client, case):
    assert client.get(f"/api/cases/{case.id}/vision/4242").status_code == 404
    assert client.get(f"/api/cases/{case.id}/vision/4242/frames/0").status_code == 404


def test_deleting_a_run_takes_its_signal_with_it(client, case, db_session):
    """A Signal that cites a deleted run is evidence pointing at nothing."""
    from app import models

    run = models.VisionRun(
        case_id=case.id,
        source_kind="video",
        source_ref="gate-cam-3.mp4",
        engine="yolov8n",
        status="processed",
        clues=[{"kind": "group", "severity": "high", "title": "2 people", "frames": [0]}],
    )
    db_session.add(run)
    db_session.commit()

    mine = models.Alert(
        case_id=case.id,
        alert_type="CCTV_SIGHTING",
        severity="high",
        title="Video: 2 people",
        evidence={"vision_run_id": run.id},
    )
    other = models.Alert(
        case_id=case.id,
        alert_type="CCTV_SIGHTING",
        severity="low",
        title="Video: another run",
        evidence={"vision_run_id": run.id + 999},
    )
    unrelated = models.Alert(
        case_id=case.id,
        alert_type="STRUCTURING",
        severity="high",
        title="Split transfers",
        evidence={},
    )
    db_session.add_all([mine, other, unrelated])
    db_session.commit()

    assert client.delete(f"/api/cases/{case.id}/vision/{run.id}").status_code == 204

    remaining = {a.title for a in db_session.query(models.Alert).all()}
    assert "Video: 2 people" not in remaining
    # Only this run's signal goes: other runs and other signal types are untouched.
    assert remaining == {"Video: another run", "Split transfers"}
