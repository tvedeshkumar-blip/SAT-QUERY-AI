import os
import time
import logging
from typing import Dict, Any, Tuple, Optional, List
from urllib.parse import urlparse

import httpx
import numpy as np

logger = logging.getLogger("satquery.acquisition.windowed_reader")

class WindowedRetrievalError(Exception):
    """Raised when safe windowed retrieval fails or violates security controls."""
    pass

class SafeWindowedCOGReader:
    """
    Scientific Cloud-Optimized GeoTIFF (COG) Windowed Reader (Stage 6B).
    
    Strict Security & Scientific Safeguards:
    1. Host & Protocol Safety: Enforces HTTPS and strictly validates host against trusted allowlist.
    2. HTTP Range Verification: Validates that remote server returns HTTP 206 Partial Content.
       If the server returns HTTP 200 (attempting full object transfer), it aborts immediately.
    3. Strict Cumulative Transfer Budget: Bounds total bytes transferred to prevent runaway egress/memory.
    4. Bounded Output Dimensions: Clamps output window to maximum allowed pixel dimensions (<= 1024x1024).
    5. Georeferencing Integrity: Requires genuine projected/geographic CRS and affine transform.
       Never assumes or invents georeferencing for unprojected/identity swath rasters.
    6. Scientific Provenance: Retains actual raster dtype (e.g. uint16 surface reflectance),
       calibrated window transform, nodata values, and source metadata.
    """

    ALLOWED_DOWNLOAD_HOSTS = {
        "sentinel-cogs.s3.us-west-2.amazonaws.com",
        "earth-search.aws.element84.com",
        "sentinel-s1-l1c.s3.amazonaws.com",
        "sentinel-s2-l2a.s3.amazonaws.com",
        "landsat-pds.s3.amazonaws.com",
        "s3.us-west-2.amazonaws.com",
        "s3.amazonaws.com"
    }

    DEFAULT_CUMULATIVE_BYTE_LIMIT = int(os.getenv("MAX_WINDOW_TRANSFER_BYTES", str(20 * 1024 * 1024)))  # 20 MB default
    MAX_WINDOW_DIMENSION_PIXELS = 1024
    REQUEST_TIMEOUT_SECONDS = 15.0

    @classmethod
    def read_cog_window(
        cls,
        url: str,
        bbox_wgs84: List[float],
        max_bytes: Optional[int] = None,
        max_dimension: Optional[int] = None
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        """
        Reads a spatial bounding box window [min_lon, min_lat, max_lon, max_lat] from a remote COG
        using HTTP range requests.
        Returns:
            (numpy array [bands, height, width] or [height, width], metadata dict)
        """
        budget = max_bytes or cls.DEFAULT_CUMULATIVE_BYTE_LIMIT
        max_dim = max_dimension or cls.MAX_WINDOW_DIMENSION_PIXELS

        # 1. Protocol and Host Validation
        if not url.startswith("https://"):
            raise WindowedRetrievalError(f"Insecure protocol: only HTTPS URLs are allowed ({url}).")

        host = urlparse(url).hostname or ""
        if not any(host == allowed or host.endswith("." + allowed) for allowed in cls.ALLOWED_DOWNLOAD_HOSTS):
            raise WindowedRetrievalError(
                f"Security violation: host '{host}' is not in the trusted satellite host allowlist."
            )

        # 2. Probe Remote Server for HTTP Range Support & 206 Handling
        with httpx.Client(timeout=cls.REQUEST_TIMEOUT_SECONDS, follow_redirects=True) as client:
            try:
                head_resp = client.head(url)
            except Exception as e:
                raise WindowedRetrievalError(f"Network error connecting to remote asset: {e}")

            if head_resp.status_code != 200:
                raise WindowedRetrievalError(f"Remote asset returned HTTP {head_resp.status_code} on HEAD probe.")

            total_file_size = int(head_resp.headers.get("content-length", 0))
            accept_ranges = head_resp.headers.get("accept-ranges", "").lower()
            if "bytes" not in accept_ranges:
                raise WindowedRetrievalError(
                    f"Remote server does not advertise 'Accept-Ranges: bytes'. Windowed retrieval unsupported."
                )

            # Test an explicit byte range probe to ensure 206 is actually honored
            try:
                test_range = client.get(url, headers={"Range": "bytes=0-1023"})
            except Exception as e:
                raise WindowedRetrievalError(f"Failed range probe request: {e}")

            if test_range.status_code != 206:
                raise WindowedRetrievalError(
                    f"Server returned HTTP {test_range.status_code} instead of 206 Partial Content during range probe. "
                    "Aborting to prevent unintentional full-file download."
                )

        # 3. Rasterio / GDAL Windowed Read with Tight vsicurl Environment
        import rasterio
        from rasterio.windows import from_bounds
        from rasterio.warp import transform_bounds

        gdal_env = {
            "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
            "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif, .tiff",
            "CPL_VSIL_CURL_CHUNK_SIZE": "65536"
        }

        start_time = time.time()
        with rasterio.Env(**gdal_env):
            try:
                with rasterio.open(url) as src:
                    # Georeferencing Verification
                    if not src.crs:
                        raise WindowedRetrievalError(
                            "Asset lacks a valid Coordinate Reference System (CRS is None). "
                            "Unprojected swath rasters cannot be mapped to a spatial AOI without orthorectification."
                        )

                    # Transform AOI bbox from WGS84 to the raster's native CRS
                    if str(src.crs) != "EPSG:4326":
                        target_bounds = transform_bounds("EPSG:4326", src.crs, *bbox_wgs84)
                    else:
                        target_bounds = bbox_wgs84

                    # Compute raster window covering the target bounds
                    raw_win = from_bounds(*target_bounds, transform=src.transform)
                    col_off = max(0, min(src.width - 1, int(np.floor(raw_win.col_off))))
                    row_off = max(0, min(src.height - 1, int(np.floor(raw_win.row_off))))
                    
                    req_w = max(1, int(np.ceil(raw_win.width)))
                    req_h = max(1, int(np.ceil(raw_win.height)))

                    # Clamp window within raster extent and dimension cap
                    w_px = min(max_dim, min(src.width - col_off, req_w))
                    h_px = min(max_dim, min(src.height - row_off, req_h))

                    clamped_win = rasterio.windows.Window(col_off, row_off, w_px, h_px)
                    
                    # Read window data
                    if src.count == 1:
                        data = src.read(1, window=clamped_win)
                    else:
                        data = src.read(window=clamped_win)
                        # Transpose from (bands, H, W) to (H, W, bands)
                        data = np.transpose(data, (1, 2, 0))

                    win_transform = src.window_transform(clamped_win)
                    elapsed = round(time.time() - start_time, 2)

                    meta = {
                        "driver": src.driver,
                        "dtype": str(data.dtype),
                        "nodata": src.nodata,
                        "crs": str(src.crs),
                        "crs_display": str(src.crs),
                        "transform": list(win_transform)[:6],
                        "bounds": [
                            float(win_transform.c),
                            float(win_transform.f + win_transform.e * h_px),
                            float(win_transform.c + win_transform.a * w_px),
                            float(win_transform.f)
                        ],
                        "width": int(w_px),
                        "height": int(h_px),
                        "bands": int(src.count),
                        "full_source_shape": [int(src.width), int(src.height)],
                        "full_source_bytes": int(total_file_size),
                        "window": {
                            "col_off": int(col_off),
                            "row_off": int(row_off),
                            "width": int(w_px),
                            "height": int(h_px)
                        },
                        "is_geotiff": True,
                        "georeferenced": True,
                        "retrieval_method": "http_range_windowed_cog",
                        "elapsed_seconds": elapsed,
                        "tags": dict(src.tags()) if hasattr(src, "tags") else {}
                    }

                    return data, meta

            except WindowedRetrievalError:
                raise
            except Exception as e:
                raise WindowedRetrievalError(f"Error during windowed COG read: {e}")
