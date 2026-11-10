"""WaPOR COG window downloads, run in worker processes.

rasterio/GDAL serialise /vsicurl/ opens across threads of one process, so a thread pool
gives ~3x parallelism at best. Each WaPOR month costs ~5 sequential range requests
(~2 s first-byte latency each from GCS), so throughput comes from many opens at once:
a process pool shared by every product and extent.

Background warming and on-demand requests (the map, a clicked point) share the pool, but
warming may hold at most PROCESSES workers: URGENT_PROCESSES more are always free, so the
month on screen never queues behind a region's backlog. Warm callers take their slot with
warm_slot() before they lock a month, so a queued warm job never blocks an urgent one.

This module imports only rasterio so spawned workers start fast.
"""

from __future__ import annotations

import multiprocessing
import os
import threading
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path

# Workers for background warming; URGENT_PROCESSES more are reserved for on-demand reads
PROCESSES = int(os.environ.get("WAPOR_PROCESSES", "16"))
URGENT_PROCESSES = int(os.environ.get("WAPOR_URGENT_PROCESSES", "4"))

GDAL_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
    "CPL_VSIL_CURL_USE_HEAD": "NO",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_MULTIPLEX": "YES",
    "GDAL_HTTP_MULTIRANGE": "YES",
    # The global COGs carry ~2 MB of tile offsets; read only the entries the window needs
    "GDAL_INGESTED_BYTES_AT_OPEN": "16384",
    "VSI_CACHE": "TRUE",
    "VSI_CACHE_SIZE": "25000000",
}

_pool: ProcessPoolExecutor | None = None
_pool_lock = threading.Lock()
_warm_slots = threading.BoundedSemaphore(PROCESSES)


def warm_slot() -> threading.BoundedSemaphore:
    """`with warm_slot():` around a background download, taken before any per-month lock."""
    return _warm_slots


def _executor() -> ProcessPoolExecutor:
    global _pool
    with _pool_lock:
        if _pool is None:
            # spawn: the API process runs threads, which fork does not copy safely
            _pool = ProcessPoolExecutor(
                max_workers=PROCESSES + URGENT_PROCESSES, mp_context=multiprocessing.get_context("spawn")
            )
        return _pool


def fetch_window(url: str, dest: str, extent: tuple[float, float, float, float], default_scale: float, default_nodata: float) -> bool:
    """Window the COG at `url` to `extent` and write it to `dest`. False if the file does not exist."""
    import rasterio
    from rasterio.errors import RasterioIOError
    from rasterio.windows import from_bounds

    west, south, east, north = extent
    try:
        with rasterio.Env(**GDAL_ENV):
            with rasterio.open(f"/vsicurl/{url}") as src:
                window = from_bounds(west, south, east, north, src.transform).round_offsets().round_lengths()
                arr = src.read(1, window=window)
                transform = src.window_transform(window)
                nodata = src.nodata if src.nodata is not None else default_nodata
                scale = src.scales[0] if src.scales else default_scale
    except RasterioIOError:
        return False
    path = Path(dest)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{os.getpid()}.tmp.tif")
    profile = {
        "driver": "GTiff",
        "dtype": arr.dtype.name,
        "width": int(arr.shape[1]),
        "height": int(arr.shape[0]),
        "count": 1,
        "crs": "EPSG:4326",
        "transform": transform,
        "nodata": nodata,
        "compress": "lzw",
    }
    with rasterio.open(tmp, "w", **profile) as dst:
        dst.write(arr, 1)
        dst.scales = (float(scale),)
    tmp.replace(path)
    return True


def download(url: str, dest: Path, extent: tuple[float, float, float, float], default_scale: float, default_nodata: float) -> bool:
    """Run fetch_window in the shared process pool and wait for it (call from a thread)."""
    global _pool
    try:
        return _executor().submit(fetch_window, url, str(dest), extent, default_scale, default_nodata).result()
    except BrokenProcessPool:
        with _pool_lock:
            _pool = None
        raise
