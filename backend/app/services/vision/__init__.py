"""Frame-level object detection over CCTV stills and uploaded video.

`detector` answers "what is in this frame"; `pipeline` turns a source into
frames, runs the detector over them, and reads clues out of the result.
"""
