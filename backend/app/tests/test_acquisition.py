import os
import sys
from unittest.mock import patch, MagicMock

# Ensure backend root is on sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.acquisition import STACSearchRequest, STACRetrieveRequest
from app.acquisition.stac_service import STACAcquisitionService, stac_service

client = TestClient(app)

MOCK_STAC_RESPONSE = {
    "type": "FeatureCollection",
    "features": [
        {
            "id": "S2A_43PGQ_20240328_0_L2A",
            "collection": "sentinel-2-l2a",
            "bbox": [77.45, 12.85, 77.75, 13.15],
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[77.45, 12.85], [77.75, 12.85], [77.75, 13.15], [77.45, 13.15], [77.45, 12.85]]]
            },
            "properties": {
                "datetime": "2024-03-28T05:25:20Z",
                "eo:cloud_cover": 0.35,
                "platform": "Sentinel-2A"
            },
            "assets": {
                "thumbnail": {
                    "href": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/S2A/thumbnail.jpg",
                    "type": "image/jpeg",
                    "roles": ["thumbnail"]
                },
                "visual": {
                    "href": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/S2A/TCI.tif",
                    "type": "image/tiff; application=geotiff",
                    "roles": ["visual"]
                },
                "red": {
                    "href": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/S2A/B04.tif",
                    "type": "image/tiff; application=geotiff",
                    "roles": ["data"]
                }
            }
        }
    ]
}

def test_stac_search_endpoint_with_mock():
    """Verify STAC search API endpoint with mocked Earth Search response."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = MOCK_STAC_RESPONSE

    mock_client_instance = MagicMock()
    mock_client_instance.post.return_value = mock_resp
    mock_client_instance.__enter__.return_value = mock_client_instance
    mock_client_instance.__exit__.return_value = None

    with patch("app.acquisition.stac_service.httpx.Client", return_value=mock_client_instance):
        payload = {
            "bbox": [77.45, 12.85, 77.75, 13.15],
            "start_date": "2024-03-01",
            "end_date": "2024-03-31",
            "collection": "sentinel-2-l2a",
            "max_cloud_cover": 20.0,
            "limit": 5
        }
        res = client.post("/api/v1/acquisition/search", json=payload)
        assert res.status_code == 200
        data = res.json()

        assert data["status"] == "success"
        assert data["total_results"] == 1
        assert len(data["scenes"]) == 1

        scene = data["scenes"][0]
        assert scene["id"] == "S2A_43PGQ_20240328_0_L2A"
        assert scene["modality"] == "OPTICAL"
        assert scene["cloud_cover"] == 0.35
        assert "thumbnail" in scene["assets"]
        assert scene["assets"]["thumbnail"]["category"] == "visual_preview"
        assert scene["assets"]["visual"]["category"] == "scientific_raster"

def test_stac_search_invalid_coordinates():
    """Verify error reporting on inverted latitude coordinates."""
    payload = {
        "bbox": [77.45, 13.15, 77.75, 12.85],  # min_lat > max_lat
        "collection": "sentinel-2-l2a"
    }
    res = client.post("/api/v1/acquisition/search", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "error"
    assert "Invalid bounding box" in data["error"]

def test_stac_search_empty_results():
    """Verify clean handling of zero results without data fabrication."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"type": "FeatureCollection", "features": []}

    mock_client_instance = MagicMock()
    mock_client_instance.post.return_value = mock_resp
    mock_client_instance.__enter__.return_value = mock_client_instance
    mock_client_instance.__exit__.return_value = None

    with patch("app.acquisition.stac_service.httpx.Client", return_value=mock_client_instance):
        payload = {
            "bbox": [0.0, 0.0, 1.0, 1.0],
            "collection": "sentinel-2-l2a"
        }
        res = client.post("/api/v1/acquisition/search", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "zero_results"
        assert data["total_results"] == 0
        assert len(data["scenes"]) == 0

def test_stac_search_network_fallback():
    """Verify graceful fallback to authentic local sample catalog when network is unreachable."""
    mock_client_instance = MagicMock()
    mock_client_instance.post.side_effect = Exception("Connection refused")
    mock_client_instance.__enter__.return_value = mock_client_instance
    mock_client_instance.__exit__.return_value = None

    with patch("app.acquisition.stac_service.httpx.Client", return_value=mock_client_instance):
        service = STACAcquisitionService()
        req = STACSearchRequest(
            bbox=[77.45, 12.85, 77.75, 13.15],
            collection="sentinel-2-l2a"
        )
        resp = service.search(req)
        assert resp.status == "success"
        assert "Local In-Repository" in resp.provider
        assert resp.total_results >= 1

def test_stac_retrieve_local_sample():
    """Verify safe retrieval and inspection of authentic local GeoTIFF sample."""
    service = STACAcquisitionService()
    # Trigger fallback to populate cache
    mock_client_instance = MagicMock()
    mock_client_instance.post.side_effect = Exception("Offline")
    mock_client_instance.__enter__.return_value = mock_client_instance
    mock_client_instance.__exit__.return_value = None

    with patch("app.acquisition.stac_service.httpx.Client", return_value=mock_client_instance):
        service.search(STACSearchRequest(bbox=[77.45, 12.85, 77.75, 13.15]))

    req = STACRetrieveRequest(
        scene_id="local_sample_cartosat_optical_bengaluru",
        asset_key="visual"
    )
    resp = service.retrieve(req)
    assert resp.status == "success"
    assert resp.category == "scientific_raster"
    assert resp.size_bytes > 0
    assert resp.data_base64.startswith("data:image/tiff;base64,")
    assert resp.metadata.get("is_geotiff") is True
    assert "EPSG:32644" in (resp.metadata.get("crs") or "")

def test_stac_retrieve_untrusted_host_blocked():
    """Verify that arbitrary external hosts not on the whitelist are strictly rejected."""
    service = STACAcquisitionService()
    service._scene_cache["evil_scene"] = {
        "raw_assets": {
            "thumbnail": {
                "href": "https://malicious-external-site.com/evil.jpg",
                "type": "image/jpeg"
            }
        }
    }
    req = STACRetrieveRequest(scene_id="evil_scene", asset_key="thumbnail")
    resp = service.retrieve(req)
    assert resp.status == "error"
    assert "not in the whitelist" in resp.error
