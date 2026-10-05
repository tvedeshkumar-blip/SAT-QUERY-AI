# SatQuery AI — Migration Guide

This document details the architectural migration from the legacy planetary image viewer (`satellite-photo-explorer`) to **SatQuery AI** for ISRO Problem Statement 26167.

---

## Key Refactoring Steps

1. **Decoupled Architecture:** Separated single-tier Express monolith into React `frontend/` and FastAPI `backend/`.
2. **Geospatial Processing:** Replaced plain web JPEG/PNG handling with `Rasterio` GeoTIFF metadata parsing (CRS, affine bounds, band count, nodata).
3. **Specialist Model Adapters:** Introduced `ModelRegistry` and specialist adapters (`RemoteSensingVQAAdapter`, `RemoteSensingCaptioner`, `RemoteSensingGrounder`, `ChangeDetector`, `ChangeVQA`, `OpticalSARAnalyzer`).
4. **Agent Controller:** Implemented auto-routing task classifier and observable execution trace logging (`ExecutionTraceTracker`).
5. **Visual Evidence Engine:** Created multi-layer Evidence Viewer supporting binary masks, bounding box overlays, difference change maps, and derived statistics.
6. **Report Generation:** Implemented PDF and JSON downloadable report endpoints.
