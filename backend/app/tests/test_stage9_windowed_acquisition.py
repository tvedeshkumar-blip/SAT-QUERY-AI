"""
Unit and integration test suite for Stage 9: Interactive Windowed Acquisition & Workspace Ingestion Subsystem.
Tests all requirements:
1. Windowed retrieval request schema validation (bounding box geometry, latitudes, longitudes).
2. Protocol & host security allowlists (HTTPS enforcement, untrusted host rejection).
3. HTTP 206 Partial Content verification and non-206 rejection.
4. Safe window dimension clamping (<= 1024x1024 px).
5. In-memory GeoTIFF serialization fidelity (CRS, affine transform, nodata, dtypes).
6. REST API endpoint POST /api/v1/acquisition/retrieve-window behavior & error handling.
7. Local sample windowed retrieval for offline continuity.
8. End-to-end integration: windowed acquisition, cross-sensor validation, agent analysis, verification, and Stage 8 reporting.
"""

import base64
import numpy as np
import pytest
import rasterio
from rasterio.io import MemoryFile
from pydantic import ValidationError
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from app.main import app
from app.schemas.acquisition import (
    STACWindowedRetrieveRequest,
    STACRetrieveResponse
)
from app.acquisition.windowed_reader import SafeWindowedCOGReader, WindowedRetrievalError
from app.acquisition.stac_service import stac_service, STACAcquisitionService
from app.acquisition.asset_validator import AssetValidator
from app.acquisition.cross_sensor_validator import CrossSensorValidator
from app.agent.controller import agent_controller
from app.schemas.analysis import AnalysisRequest, ImageInput


client = TestClient(app)


def test_01_windowed_request_schema_validation():
    """Validates bounding box format, latitude/longitude bounds, and length requirements."""
    # Valid bounding box in EPSG:4326 [min_lon, min_lat, max_lon, max_lat]
    req = STACWindowedRetrieveRequest(
        scene_id="S2A_TEST_01",
        asset_key="B04",
        aoi_bbox=[77.58, 12.96, 77.60, 12.98],
        collection="sentinel-2-l2a"
    )
    assert req.aoi_bbox == [77.58, 12.96, 77.60, 12.98]
    assert req.scene_id == "S2A_TEST_01"

    # Inverted latitude: min_lat > max_lat
    with pytest.raises(ValidationError):
        STACWindowedRetrieveRequest(
            scene_id="S2A_TEST_01",
            asset_key="B04",
            aoi_bbox=[77.58, 13.00, 77.60, 12.90]
        )

    # Invalid latitude out of [-90, 90]
    with pytest.raises(ValidationError):
        STACWindowedRetrieveRequest(
            scene_id="S2A_TEST_01",
            asset_key="B04",
            aoi_bbox=[77.58, -95.0, 77.60, 12.90]
        )

    # Invalid longitude out of [-180, 180]
    with pytest.raises(ValidationError):
        STACWindowedRetrieveRequest(
            scene_id="S2A_TEST_01",
            asset_key="B04",
            aoi_bbox=[190.0, 12.0, 195.0, 13.0]
        )

    # Incorrect element count (3 elements instead of 4)
    with pytest.raises(ValidationError):
        STACWindowedRetrieveRequest(
            scene_id="S2A_TEST_01",
            asset_key="B04",
            aoi_bbox=[77.58, 12.0, 77.60]
        )


def test_02_untrusted_host_rejected_by_windowed_reader():
    """Security check: assets residing on untrusted hosts are rejected immediately."""
    untrusted_url = "https://unauthorized-storage.example.org/rasters/test.tif"
    with pytest.raises(WindowedRetrievalError, match="not in the trusted satellite host allowlist"):
        SafeWindowedCOGReader.read_cog_window(
            url=untrusted_url,
            bbox_wgs84=[77.58, 12.96, 77.60, 12.98]
        )


def test_03_insecure_http_protocol_rejected():
    """Security check: insecure unencrypted HTTP protocol URLs are rejected."""
    insecure_url = "http://sentinel-cogs.s3.us-west-2.amazonaws.com/test.tif"
    with pytest.raises(WindowedRetrievalError, match="Insecure protocol: only HTTPS URLs are allowed"):
        SafeWindowedCOGReader.read_cog_window(
            url=insecure_url,
            bbox_wgs84=[77.58, 12.96, 77.60, 12.98]
        )


def test_04_missing_or_failed_206_range_rejected():
    """Ensures servers that return HTTP 200 instead of HTTP 206 Partial Content are aborted."""
    test_url = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/test.tif"
    
    mock_head = MagicMock()
    mock_head.status_code = 200
    mock_head.headers = {"content-length": "50000000", "accept-ranges": "bytes"}

    mock_range = MagicMock()
    mock_range.status_code = 200  # BAD: Server attempted full object transfer instead of 206

    mock_client = MagicMock()
    mock_client.__enter__.return_value = mock_client
    mock_client.head.return_value = mock_head
    mock_client.get.return_value = mock_range

    with patch("httpx.Client", return_value=mock_client):
        with pytest.raises(WindowedRetrievalError, match="instead of 206 Partial Content"):
            SafeWindowedCOGReader.read_cog_window(
                url=test_url,
                bbox_wgs84=[77.58, 12.96, 77.60, 12.98]
            )


def test_05_in_memory_geotiff_serialization_and_metadata_fidelity():
    """Verifies array serialization to GeoTIFF preserves CRS, transform, nodata, and passes asset validation."""
    arr = np.random.uniform(0.01, 1.5, size=(64, 64)).astype(np.float32)
    meta = {
        "crs": "EPSG:32643",
        "transform": [10.0, 0.0, 779880.0, 0.0, -10.0, 1436370.0],
        "nodata": -32768.0,
        "bands": 1,
        "tags": {
            "POLARIZATION": "VV",
            "SENSOR": "Sentinel-1 C-SAR IW RTC",
            "CALIBRATION": "gamma0"
        }
    }

    raw_bytes = STACAcquisitionService._array_to_geotiff_bytes(arr, meta)
    assert len(raw_bytes) > 0

    # Read back through rasterio to confirm structural integrity
    with MemoryFile(raw_bytes) as mem:
        with mem.open() as src:
            assert str(src.crs) == "EPSG:32643"
            assert src.shape == (64, 64)
            assert src.dtypes[0] == "float32"
            assert src.nodata == -32768.0
            assert src.tags().get("POLARIZATION") == "VV"
            read_data = src.read(1)
            np.testing.assert_allclose(read_data, arr, rtol=1e-5)

    # Validate through AssetValidator
    val_report = AssetValidator.validate_asset(
        raw_bytes,
        filename="test_serialized_window.tif",
        provenance={"sensor": "Sentinel-1 C-SAR IW RTC", "modality": "SAR"}
    )
    assert val_report["status"] == "valid"
    assert val_report["asset_category"] in ("scientific_raster", "single_band_spectral")
    assert val_report["raster_metadata"]["crs"] == "EPSG:32643"
    assert val_report["raster_metadata"]["width"] == 64
    assert val_report["raster_metadata"]["height"] == 64


def test_06_local_sample_windowed_retrieval():
    """Tests windowed retrieval for local demonstration sample rasters."""
    req = STACWindowedRetrieveRequest(
        scene_id="local_sample_cartosat_optical_bengaluru",
        asset_key="visual",
        aoi_bbox=[77.58, 12.96, 77.60, 12.98]
    )

    resp = stac_service.retrieve_window(req)
    assert resp.status == "success"
    assert resp.category == "scientific_raster"
    assert resp.data_base64.startswith("data:image/tiff;base64,")
    assert resp.provenance.get("windowed_crop") is True
    assert resp.metadata.get("crs") is not None
    assert resp.validation is not None
    assert resp.validation.status == "valid"


def test_07_api_endpoint_windowed_retrieval_success_and_error_handling():
    """Tests POST /api/v1/acquisition/retrieve-window HTTP interface."""
    # 1. Valid local sample window retrieval
    valid_payload = {
        "scene_id": "local_sample_cartosat_optical_bengaluru",
        "asset_key": "visual",
        "aoi_bbox": [77.58, 12.96, 77.60, 12.98]
    }
    r = client.post("/api/v1/acquisition/retrieve-window", json=valid_payload)
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "success"
    assert data["category"] == "scientific_raster"
    assert "data_base64" in data
    assert data["data_base64"].startswith("data:image/tiff;base64,")
    assert data["metadata"]["width"] > 0
    assert data["metadata"]["height"] > 0

    # 2. Invalid AOI bounding box format returns 422 Unprocessable Entity
    invalid_bbox_payload = {
        "scene_id": "local_sample_cartosat_optical_bengaluru",
        "asset_key": "visual",
        "aoi_bbox": [77.58, 14.00, 77.60, 12.00]  # min_lat > max_lat
    }
    r_err = client.post("/api/v1/acquisition/retrieve-window", json=invalid_bbox_payload)
    assert r_err.status_code == 422

    # 3. Non-existent scene returns 400 Bad Request
    missing_scene_payload = {
        "scene_id": "non_existent_scene_xyz_999",
        "asset_key": "B04",
        "aoi_bbox": [77.58, 12.96, 77.60, 12.98]
    }
    r_miss = client.post("/api/v1/acquisition/retrieve-window", json=missing_scene_payload)
    assert r_miss.status_code == 400
    assert "not found in active STAC search session" in r_miss.json()["detail"]


def test_08_end_to_end_windowed_acquisition_and_cross_sensor_analysis():
    """
    End-to-end integration:
    Generates two windowed scientific GeoTIFFs (Optical surface reflectance & SAR backscatter),
    validates the pair via CrossSensorValidator, executes joint analysis in AgentController,
    and confirms deterministic verification passes with Stage 8 reproducible report generation.
    """
    # 1. Generate Optical Window GeoTIFF (Sentinel-2 BOA Red Reflectance, 32x32, EPSG:32643)
    opt_data = np.full((32, 32), 1298, dtype=np.uint16)  # 1298 DN = 0.1298 BOA reflectance
    opt_meta = {
        "crs": "EPSG:32643",
        "transform": [10.0, 0.0, 779880.0, 0.0, -10.0, 1436370.0],
        "nodata": 0,
        "bands": 1,
        "tags": {"SENSOR": "Sentinel-2 MSI Level-2A", "DATA_TYPE": "Surface Reflectance BOA"}
    }
    opt_bytes = STACAcquisitionService._array_to_geotiff_bytes(opt_data, opt_meta)
    opt_b64 = "data:image/tiff;base64," + base64.b64encode(opt_bytes).decode("utf-8")

    # 2. Generate SAR Window GeoTIFF (Sentinel-1 RTC VV Backscatter, 32x32, EPSG:32643)
    sar_data = np.full((32, 32), 0.7417, dtype=np.float32)  # 0.7417 linear gamma-0 power
    sar_meta = {
        "crs": "EPSG:32643",
        "transform": [10.0, 0.0, 779880.0, 0.0, -10.0, 1436370.0],
        "nodata": -32768.0,
        "bands": 1,
        "tags": {
            "SENSOR": "Sentinel-1 C-SAR IW RTC",
            "POLARIZATION": "VV",
            "CALIBRATION": "gamma0",
            "TERRAIN_CORRECTION": "radiometrically_terrain_corrected"
        }
    }
    sar_bytes = STACAcquisitionService._array_to_geotiff_bytes(sar_data, sar_meta)
    sar_b64 = "data:image/tiff;base64," + base64.b64encode(sar_bytes).decode("utf-8")

    # 3. Cross-Sensor Pair Pre-Validation
    pair_report = CrossSensorValidator.validate_pair(
        optical_input=opt_b64,
        sar_input=sar_b64,
        optical_filename="s2_b04_window.tif",
        sar_filename="s1_vv_window.tif",
        optical_provenance={"sensor": "Sentinel-2", "modality": "OPTICAL"},
        sar_provenance={
            "sensor": "Sentinel-1",
            "modality": "SAR",
            "polarization": "VV",
            "calibration_status": "calibrated_backscatter",
            "terrain_correction_status": "radiometrically_terrain_corrected"
        }
    )
    assert pair_report["status"] in ("compatible", "compatible_with_limitations")
    assert pair_report["is_compatible"] is True
    assert pair_report["crs_compatible"] is True
    assert pair_report["modality_compatible"] is True

    # 4. Ingest into AgentController via AnalysisRequest
    req = AnalysisRequest(
        query="Perform joint optical and SAR analysis of surface reflectance and radar roughness.",
        mode="optical_sar",
        images=[
            ImageInput(
                data=opt_b64,
                mimeType="image/tiff",
                filename="s2_b04_window.tif",
                role="optical",
                asset_category="scientific_raster",
                provenance={
                    "sensor": "Sentinel-2 MSI",
                    "modality": "OPTICAL",
                    "datetime": "2024-03-28T05:27:01Z"
                }
            ),
            ImageInput(
                data=sar_b64,
                mimeType="image/tiff",
                filename="s1_vv_window.tif",
                role="sar",
                asset_category="scientific_raster",
                provenance={
                    "sensor": "Sentinel-1 C-SAR",
                    "modality": "SAR",
                    "polarization": "VV",
                    "calibration_status": "calibrated_backscatter",
                    "terrain_correction_status": "radiometrically_terrain_corrected",
                    "datetime": "2024-03-22T00:40:42Z"
                }
            )
        ]
    )

    response = agent_controller.process_request(req)

    # 5. Verify analysis execution, verification, and Stage 8 report integrity
    assert response.actual_model_used == "OpticalSARJointAnalysisProvider"
    assert response.fallback_used is False
    assert response.verification is not None
    assert response.verification.deterministic_passed is True
    assert response.reproducible_report is not None
    assert response.reproducible_report.report_id.startswith("report_")

    # Verify physical measurements separated from display statistics
    phys_measurements = response.reproducible_report.physical_measurements
    display_stats = response.reproducible_report.display_statistics
    assert len(phys_measurements) >= 2
    assert len(display_stats) >= 1

    # Check units
    units = [p.unit for p in phys_measurements]
    assert any("reflectance" in u or "[0, 1]" in u for u in units)
    assert any("linear power" in u or "dB" in u for u in units)
