import pytest
import numpy as np
import httpx
from unittest.mock import patch, MagicMock

from app.acquisition.windowed_reader import (
    SafeWindowedCOGReader,
    WindowedRetrievalError
)

def test_insecure_http_protocol_rejected():
    with pytest.raises(WindowedRetrievalError, match="Insecure protocol"):
        SafeWindowedCOGReader.read_cog_window(
            url="http://sentinel-cogs.s3.us-west-2.amazonaws.com/test.tif",
            bbox_wgs84=[77.5, 12.9, 77.6, 13.0]
        )

def test_untrusted_host_rejected():
    with pytest.raises(WindowedRetrievalError, match="Security violation: host"):
        SafeWindowedCOGReader.read_cog_window(
            url="https://evil-untrusted-host.com/fake_cog.tif",
            bbox_wgs84=[77.5, 12.9, 77.6, 13.0]
        )

def test_server_without_accept_ranges_rejected():
    with patch("httpx.Client.head") as mock_head:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.headers = {"content-length": "1000000"}  # No Accept-Ranges header
        mock_head.return_value = mock_resp

        with pytest.raises(WindowedRetrievalError, match="Accept-Ranges: bytes"):
            SafeWindowedCOGReader.read_cog_window(
                url="https://sentinel-cogs.s3.us-west-2.amazonaws.com/test.tif",
                bbox_wgs84=[77.5, 12.9, 77.6, 13.0]
            )

def test_server_returning_200_instead_of_206_aborts_immediately():
    with patch("httpx.Client.head") as mock_head, patch("httpx.Client.get") as mock_get:
        mock_head_resp = MagicMock()
        mock_head_resp.status_code = 200
        mock_head_resp.headers = {"accept-ranges": "bytes", "content-length": "1000000"}
        mock_head.return_value = mock_head_resp

        # Server ignores Range header and returns full object (HTTP 200)
        mock_get_resp = MagicMock()
        mock_get_resp.status_code = 200  # Not 206!
        mock_get.return_value = mock_get_resp

        with pytest.raises(WindowedRetrievalError, match="returned HTTP 200 instead of 206"):
            SafeWindowedCOGReader.read_cog_window(
                url="https://sentinel-cogs.s3.us-west-2.amazonaws.com/test.tif",
                bbox_wgs84=[77.5, 12.9, 77.6, 13.0]
            )

def test_live_s2_scientific_b04_window_retrieval():
    """
    Demonstrates physical windowed reading of live Sentinel-2 B04 (red surface reflectance)
    without downloading the 235 MB full file.
    """
    s2_b04_url = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/43/P/GQ/2024/3/S2A_43PGQ_20240328_0_L2A/B04.tif"
    aoi_bengaluru = [77.58, 12.96, 77.60, 12.98]  # ~2km x 2km window

    data, meta = SafeWindowedCOGReader.read_cog_window(
        url=s2_b04_url,
        bbox_wgs84=aoi_bengaluru,
        max_bytes=25 * 1024 * 1024
    )

    # 1. Scientific Dtype & Values: uint16 BOA reflectance
    assert data.dtype == np.uint16
    assert data.ndim == 2
    assert meta["dtype"] == "uint16"
    assert meta["bands"] == 1

    # 2. Georeferencing preserved
    assert meta["crs"] == "EPSG:32643"
    assert meta["georeferenced"] is True
    assert len(meta["transform"]) == 6
    assert meta["transform"][0] == 10.0  # 10m pixel width
    assert meta["transform"][4] == -10.0  # 10m pixel height

    # 3. Bounded dimensions
    assert meta["width"] <= 1024
    assert meta["height"] <= 1024
    assert meta["width"] > 0
    assert meta["height"] > 0

    # 4. Provenance
    assert meta["retrieval_method"] == "http_range_windowed_cog"
    assert meta["full_source_bytes"] > 200 * 1024 * 1024  # Source is ~235 MB
    assert meta["elapsed_seconds"] < 15.0  # Finished within timeout budget
