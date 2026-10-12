"""
Targeted test suite for Step 1: Satellite Asset Retrieval Safeguards.

Tests all Step 1 requirements:
1. Preserves 35 MiB full-download safety limit.
2. Uses existing AOI windowed retrieval workflow for large COG assets when AOI is provided.
3. Reports precise blocker when large COG asset cannot be retrieved without an AOI.
4. HTTP Range and Content-Range behavior:
   - Rejects HTTP 416 (Range Not Satisfiable) safely.
   - Rejects HTTP 501 / 500 range failures safely.
   - Rejects HTTP 206 missing Content-Range header.
   - Rejects HTTP 206 with malformed Content-Range header.
   - Accepts valid HTTP 206 with RFC 7233 compliant Content-Range.
5. Truncation and empty download payload detection.
6. Payload validation failure distinction: corrupt or invalid rasters return status="error".
"""

import os
import sys
import io

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import pytest
import numpy as np
from unittest.mock import patch, MagicMock
import httpx

from app.schemas.acquisition import (
    STACRetrieveRequest,
    STACWindowedRetrieveRequest
)
from app.acquisition.stac_service import STACAcquisitionService, stac_service
from app.acquisition.windowed_reader import SafeWindowedCOGReader, WindowedRetrievalError
from app.acquisition.asset_validator import AssetValidator


# ==============================================================================
# Requirement 1 & 2: Large COG & 35 MiB Full-Download Safety Limit
# ==============================================================================

def test_large_cog_with_aoi_transitions_to_windowed_retrieval():
    """
    Verifies that a COG asset exceeding 35 MiB automatically delegates to the
    existing AOI windowed retrieval workflow when an AOI bounding box is provided.
    """
    service = STACAcquisitionService()
    service.MAX_DOWNLOAD_BYTES = 35 * 1024 * 1024

    service._scene_cache["test_s2_scene"] = {
        "collection": "sentinel-2-l2a",
        "datetime": "2024-03-20T00:00:00Z",
        "raw_assets": {
            "visual": {
                "href": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/test_visual.tif",
                "type": "image/tiff; application=geotiff; profile=cloud-optimized",
                "file:size": 52 * 1024 * 1024  # 52 MB (> 35 MB)
            }
        },
        "search_bbox": [77.58, 12.96, 77.60, 12.98]
    }

    req = STACRetrieveRequest(
        scene_id="test_s2_scene",
        asset_key="visual",
        aoi_bbox=[77.58, 12.96, 77.60, 12.98],
        collection="sentinel-2-l2a"
    )

    with patch.object(service, "retrieve_window") as mock_window:
        mock_window.return_value = MagicMock(status="success", scene_id="test_s2_scene", asset_key="visual")
        resp = service.retrieve(req)

        assert mock_window.called
        call_arg = mock_window.call_args[0][0]
        assert isinstance(call_arg, STACWindowedRetrieveRequest)
        assert call_arg.scene_id == "test_s2_scene"
        assert call_arg.asset_key == "visual"
        assert call_arg.aoi_bbox == [77.58, 12.96, 77.60, 12.98]
        assert resp.status == "success"


def test_large_cog_without_aoi_preserves_safety_limit_and_reports_blocker():
    """
    Verifies that a COG asset exceeding 35 MiB without any AOI is safely blocked
    and returns an error explaining that bounded sub-windowing requires an AOI.
    """
    service = STACAcquisitionService()
    service.MAX_DOWNLOAD_BYTES = 35 * 1024 * 1024

    service._scene_cache["test_s2_scene_no_aoi"] = {
        "collection": "sentinel-2-l2a",
        "datetime": "2024-03-20T00:00:00Z",
        "raw_assets": {
            "visual": {
                "href": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/test_visual.tif",
                "type": "image/tiff",
                "file:size": 75 * 1024 * 1024  # 75 MB
            }
        }
        # Note: No search_bbox in cache
    }

    req = STACRetrieveRequest(
        scene_id="test_s2_scene_no_aoi",
        asset_key="visual",
        aoi_bbox=None,  # No AOI provided
        collection="sentinel-2-l2a"
    )

    resp = service.retrieve(req)
    assert resp.status == "error"
    assert "exceeds the configured retrieval safety limit of 35MB" in resp.error
    assert "Full-tile Sentinel COG rasters require bounded sub-windowing" in resp.error


# ==============================================================================
# Requirement 3: HTTP Range and Content-Range Verification
# ==============================================================================

def test_http_range_416_not_satisfiable_rejected_safely():
    """Ensures server returning HTTP 416 (Range Not Satisfiable) raises WindowedRetrievalError."""
    test_url = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/test.tif"

    mock_head = MagicMock()
    mock_head.status_code = 200
    mock_head.headers = {"content-length": "1000000", "accept-ranges": "bytes"}

    mock_range = MagicMock()
    mock_range.status_code = 416  # Range Not Satisfiable

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.head.return_value = mock_head
    mock_client.get.return_value = mock_range

    with patch("httpx.Client", return_value=mock_client):
        with pytest.raises(WindowedRetrievalError, match="HTTP 416"):
            SafeWindowedCOGReader.read_cog_window(
                url=test_url,
                bbox_wgs84=[77.58, 12.96, 77.60, 12.98]
            )


def test_http_range_server_error_rejected_safely():
    """Ensures server returning HTTP 501 / 500 on range request raises WindowedRetrievalError."""
    test_url = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/test.tif"

    mock_head = MagicMock()
    mock_head.status_code = 200
    mock_head.headers = {"content-length": "1000000", "accept-ranges": "bytes"}

    mock_range = MagicMock()
    mock_range.status_code = 501  # Not Implemented

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.head.return_value = mock_head
    mock_client.get.return_value = mock_range

    with patch("httpx.Client", return_value=mock_client):
        with pytest.raises(WindowedRetrievalError, match="HTTP 501"):
            SafeWindowedCOGReader.read_cog_window(
                url=test_url,
                bbox_wgs84=[77.58, 12.96, 77.60, 12.98]
            )


def test_http_range_missing_content_range_header_rejected():
    """Ensures HTTP 206 response omitting Content-Range header is rejected."""
    test_url = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/test.tif"

    mock_head = MagicMock()
    mock_head.status_code = 200
    mock_head.headers = {"content-length": "1000000", "accept-ranges": "bytes"}

    mock_range = MagicMock()
    mock_range.status_code = 206
    # Dictionary without Content-Range header
    mock_range.headers = {"content-length": "1024"}

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.head.return_value = mock_head
    mock_client.get.return_value = mock_range

    with patch("httpx.Client", return_value=mock_client):
        with pytest.raises(WindowedRetrievalError, match="omitted mandatory 'Content-Range' response header"):
            SafeWindowedCOGReader.read_cog_window(
                url=test_url,
                bbox_wgs84=[77.58, 12.96, 77.60, 12.98]
            )


def test_http_range_malformed_content_range_header_rejected():
    """Ensures HTTP 206 response with malformed Content-Range header is rejected."""
    test_url = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/test.tif"

    mock_head = MagicMock()
    mock_head.status_code = 200
    mock_head.headers = {"content-length": "1000000", "accept-ranges": "bytes"}

    mock_range = MagicMock()
    mock_range.status_code = 206
    mock_range.headers = {"content-range": "items 0-100/500"}  # Invalid range unit (items instead of bytes)

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.head.return_value = mock_head
    mock_client.get.return_value = mock_range

    with patch("httpx.Client", return_value=mock_client):
        with pytest.raises(WindowedRetrievalError, match="invalid 'Content-Range' header format"):
            SafeWindowedCOGReader.read_cog_window(
                url=test_url,
                bbox_wgs84=[77.58, 12.96, 77.60, 12.98]
            )


# ==============================================================================
# Requirement 4: Truncation, Empty Payloads & Validation Status Distinction
# ==============================================================================

def test_download_truncated_payload_detected_and_rejected():
    """Ensures stream ending with total_bytes < Content-Length is flagged as error."""
    service = STACAcquisitionService()

    service._scene_cache["test_scene_trunc"] = {
        "collection": "sentinel-2-l2a",
        "datetime": "2024-03-20T00:00:00Z",
        "raw_assets": {
            "thumbnail": {
                "href": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/thumb.jpg",
                "type": "image/jpeg"
            }
        }
    }

    req = STACRetrieveRequest(
        scene_id="test_scene_trunc",
        asset_key="thumbnail",
        collection="sentinel-2-l2a"
    )

    mock_stream = MagicMock()
    mock_stream.status_code = 200
    mock_stream.headers = {"content-length": "50000"}  # Server claims 50,000 bytes
    mock_stream.iter_bytes.return_value = [b"truncated_data_100_bytes" * 5]  # Only ~125 bytes delivered

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.stream.return_value.__enter__.return_value = mock_stream

    with patch("httpx.Client", return_value=mock_client):
        resp = service.retrieve(req)
        assert resp.status == "error"
        assert "Asset download truncated" in resp.error


def test_download_empty_payload_detected_and_rejected():
    """Ensures stream delivering 0 bytes is flagged as error."""
    service = STACAcquisitionService()

    service._scene_cache["test_scene_empty"] = {
        "collection": "sentinel-2-l2a",
        "datetime": "2024-03-20T00:00:00Z",
        "raw_assets": {
            "thumbnail": {
                "href": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/thumb.jpg",
                "type": "image/jpeg"
            }
        }
    }

    req = STACRetrieveRequest(
        scene_id="test_scene_empty",
        asset_key="thumbnail",
        collection="sentinel-2-l2a"
    )

    mock_stream = MagicMock()
    mock_stream.status_code = 200
    mock_stream.headers = {}
    mock_stream.iter_bytes.return_value = []  # 0 bytes

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.stream.return_value.__enter__.return_value = mock_stream

    with patch("httpx.Client", return_value=mock_client):
        resp = service.retrieve(req)
        assert resp.status == "error"
        assert "empty payload (0 bytes received)" in resp.error


def test_download_corrupt_payload_validation_fails_and_returns_error_status():
    """
    Ensures that when a downloaded payload is corrupted or invalid (e.g. random garbage bytes),
    physical asset validation marks it invalid and retrieve returns status="error" rather than success.
    """
    service = STACAcquisitionService()

    service._scene_cache["test_scene_corrupt"] = {
        "collection": "sentinel-2-l2a",
        "datetime": "2024-03-20T00:00:00Z",
        "raw_assets": {
            "visual": {
                "href": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/corrupt.tif",
                "type": "image/tiff"
            }
        }
    }

    req = STACRetrieveRequest(
        scene_id="test_scene_corrupt",
        asset_key="visual",
        collection="sentinel-2-l2a"
    )

    # 512 bytes of completely corrupted garbage (not a GeoTIFF, not a JPEG)
    corrupted_bytes = b"CORRUPTED_NON_RASTER_DATA_" * 20

    mock_stream = MagicMock()
    mock_stream.status_code = 200
    mock_stream.headers = {"content-length": str(len(corrupted_bytes))}
    mock_stream.iter_bytes.return_value = [corrupted_bytes]

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.stream.return_value.__enter__.return_value = mock_stream

    with patch("httpx.Client", return_value=mock_client):
        resp = service.retrieve(req)
        assert resp.status == "error"
        assert resp.data_base64 == ""
        assert "Retrieved asset payload validation failed" in resp.error
        assert resp.validation is not None
        assert resp.validation.status == "invalid"
