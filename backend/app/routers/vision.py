"""CCTV stills and uploaded video, read for clues.

Detection runs in a BackgroundTask and the UI polls VisionRun.status, the same
shape as document ingest (PLAN.md section 5.1). A thirty-second clip is a
multi-second decode before the model sees a single frame, and holding the
request open for it would time out the upload long before the answer arrived.
"""

from __future__ import annotations

import logging
import shutil

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app import models
from app.config import get_settings
from app.db import SessionLocal, get_db
from app.schemas import CameraGrab, VisionRunDetail, VisionRunOut
from app.services.vision import pipeline
from app.services.vision.detector import active_engine

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/cases/{case_id}/vision", tags=["vision"])

SOURCE_VIDEO = "video"
SOURCE_CCTV = "cctv"


def _frames_dir(run_id: int):
    return settings.evidence_store_dir / "vision" / str(run_id)


def _require_case(db: Session, case_id: int) -> None:
    if db.get(models.Case, case_id) is None:
        raise HTTPException(status_code=404, detail="Case not found")


def _load_run(db: Session, case_id: int, run_id: int) -> models.VisionRun:
    run = db.get(models.VisionRun, run_id)
    if run is None or run.case_id != case_id:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return run


@router.get("", response_model=list[VisionRunOut])
def list_runs(case_id: int, db: Session = Depends(get_db)):
    _require_case(db, case_id)
    stmt = (
        select(models.VisionRun)
        .where(models.VisionRun.case_id == case_id)
        .order_by(models.VisionRun.created_at.desc())
    )
    return db.scalars(stmt).all()


@router.get("/{run_id}", response_model=VisionRunDetail)
def get_run(case_id: int, run_id: int, db: Session = Depends(get_db)):
    _require_case(db, case_id)
    run = db.scalar(
        select(models.VisionRun)
        .options(selectinload(models.VisionRun.frames))
        .where(models.VisionRun.id == run_id, models.VisionRun.case_id == case_id)
    )
    if run is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return run


@router.get("/{run_id}/frames/{frame_index}")
def get_frame(case_id: int, run_id: int, frame_index: int, db: Session = Depends(get_db)):
    """The annotated JPEG for one frame."""
    _require_case(db, case_id)
    _load_run(db, case_id, run_id)
    frame = db.scalar(
        select(models.VisionFrame).where(
            models.VisionFrame.run_id == run_id,
            models.VisionFrame.frame_index == frame_index,
        )
    )
    if frame is None:
        raise HTTPException(status_code=404, detail="Frame not found")

    path = settings.evidence_store_dir / frame.image_path
    if not path.is_file():
        raise HTTPException(status_code=410, detail="Frame image is no longer on disk")
    return FileResponse(path, media_type="image/jpeg")


@router.post("/video", response_model=VisionRunOut, status_code=202)
async def analyse_video(
    case_id: int,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    max_frames: int = Form(0),
    db: Session = Depends(get_db),
):
    _require_case(db, case_id)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")

    limit = settings.vision_max_upload_mb * 1024 * 1024
    if len(raw) > limit:
        raise HTTPException(
            status_code=413,
            detail=f"Clip is larger than the {settings.vision_max_upload_mb}MB limit.",
        )

    run = _create_run(db, case_id, SOURCE_VIDEO, file.filename or "upload")
    wanted = max_frames or settings.vision_max_frames
    background.add_task(_run_video, run.id, raw, wanted)
    return run


@router.post("/camera", response_model=VisionRunOut, status_code=202)
def analyse_camera(
    case_id: int,
    body: CameraGrab,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    _require_case(db, case_id)
    url = body.url.strip()
    if not url:
        raise HTTPException(status_code=422, detail="Camera URL is required")

    run = _create_run(db, case_id, SOURCE_CCTV, url)
    background.add_task(_run_camera, run.id, url, body.frames)
    return run


@router.delete("/{run_id}", status_code=204)
def delete_run(case_id: int, run_id: int, db: Session = Depends(get_db)):
    _require_case(db, case_id)
    run = _load_run(db, case_id, run_id)
    db.delete(run)
    # The Signal this run raised points back at it. Left behind it would cite a
    # run nobody can open, which is exactly the dangling evidence this app is
    # built to avoid.
    for alert in db.scalars(
        select(models.Alert).where(
            models.Alert.case_id == case_id,
            models.Alert.alert_type == "CCTV_SIGHTING",
        )
    ):
        if alert.evidence.get("vision_run_id") == run_id:
            db.delete(alert)
    db.commit()
    # Frames go with the run; leaving the JPEGs behind would grow the store
    # with images nothing can reach.
    shutil.rmtree(_frames_dir(run_id), ignore_errors=True)
    return None


def _create_run(db: Session, case_id: int, kind: str, ref: str) -> models.VisionRun:
    run = models.VisionRun(
        case_id=case_id,
        source_kind=kind,
        source_ref=ref[:500],
        engine=active_engine(),
        status="processing",
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def _run_video(run_id: int, raw: bytes, max_frames: int) -> None:
    _execute(run_id, lambda: pipeline.sample_video(raw, max_frames))


def _run_camera(run_id: int, url: str, frames: int) -> None:
    _execute(
        run_id,
        lambda: pipeline.grab_camera(
            url, frames, allow_private=settings.vision_allow_private_hosts
        ),
    )


def _execute(run_id: int, sample) -> None:
    """Sample, detect, persist. Owns its own session — it outlives the request.

    Any failure is written onto the run rather than raised into a background
    task nobody is awaiting, so the UI can show the operator what went wrong.
    """
    session = SessionLocal()
    try:
        run = session.get(models.VisionRun, run_id)
        if run is None:
            return
        try:
            frames = sample()
        except pipeline.VisionError as error:
            run.status = "failed"
            run.error = str(error)
            session.commit()
            return

        directory = _frames_dir(run_id)
        directory.mkdir(parents=True, exist_ok=True)

        for frame in frames:
            name = f"{frame.index:03d}.jpg"
            (directory / name).write_bytes(pipeline.annotate(frame))
            session.add(
                models.VisionFrame(
                    run_id=run_id,
                    frame_index=frame.index,
                    timestamp_sec=frame.timestamp_sec,
                    image_path=f"vision/{run_id}/{name}",
                    detections=[d.as_dict() for d in frame.detections],
                )
            )

        run.status = "processed"
        run.frame_count = len(frames)
        run.detection_count = sum(len(f.detections) for f in frames)
        run.clues = pipeline.derive_clues(frames)
        run.summary = pipeline.summarise(frames)
        session.add(_alert_for(run))
        session.commit()
    except Exception as error:  # noqa: BLE001 - the run must record why it stopped
        session.rollback()
        logger.exception("Vision run %s failed", run_id)
        _mark_failed(session, run_id, error)
    finally:
        session.close()


def _mark_failed(session: Session, run_id: int, error: Exception) -> None:
    try:
        run = session.get(models.VisionRun, run_id)
        if run is not None:
            run.status = "failed"
            run.error = str(error)[:500]
            session.commit()
    except Exception:  # pragma: no cover - the session itself is gone
        session.rollback()


def _alert_for(run: models.VisionRun) -> models.Alert:
    """Put the run in the Signals queue so it is reviewed like any other lead."""
    ranked = {"high": 3, "medium": 2, "low": 1}
    severity = max(
        (clue.get("severity", "low") for clue in run.clues),
        key=lambda s: ranked.get(s, 0),
        default="low",
    )
    headline = run.clues[0]["title"] if run.clues else "No detections"
    source = "Camera" if run.source_kind == SOURCE_CCTV else "Video"
    return models.Alert(
        case_id=run.case_id,
        alert_type="CCTV_SIGHTING",
        severity=severity,
        title=f"{source}: {headline}",
        description=(
            f"{run.detection_count} detections across {run.frame_count} frames "
            f"from {run.source_ref}, read by {run.engine}."
        ),
        entity_ids=[],
        evidence={
            "vision_run_id": run.id,
            "source_kind": run.source_kind,
            "source_ref": run.source_ref,
            "engine": run.engine,
            "clues": run.clues,
            "labels": run.summary.get("labels", {}),
        },
    )
