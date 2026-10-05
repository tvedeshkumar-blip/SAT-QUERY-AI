# SatQuery AI — Red Team Remediation Report

**Date:** 2026-09-28  
**Scope:** Engineering & Scientific Hardening Pass across Backend, Frontend, Evaluation, Training, and Geospatial Layers  
**Repository:** [Miruthula426/satellite-photo-explorer](https://github.com/Miruthula426/satellite-photo-explorer)  
**Audit Baseline:** [docs/RED_TEAM_AUDIT.md](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/docs/RED_TEAM_AUDIT.md)

---

## 1. Executive Summary

During this red team hardening phase, SatQuery AI underwent a systematic elimination of fabricated benchmark scores, ungrounded heuristic claims, synthetic evaluation masquerading as official agency runs, and unsafe geospatial assumptions (such as CRS guessing). 

The application has been transformed into a **scientifically defensible, transparent, and reproducible** remote sensing intelligence system. All untrained heuristics and procedural algorithms are now explicitly designated as **Baselines**, weightless neural stubs have been decoupled from false "loaded" states, real evaluation infrastructure has been established under [`backend/app/evaluation/`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/evaluation/), and training scripts now enforce authentic PyTorch pipelines that fail fast when data is missing rather than printing simulated progress.

---

## 2. Fixed

### A. Fabricated Benchmark Scores Removed
* **Removed Hardcoded Percentages:** Deleted all hardcoded occurrences of `84.6%` (RSVQA), `62.4%` (VRSBench), `79.2%` (CDVQA), and `88.1%` (ISRO CartoRISAT) across the codebase:
  - [`GET /api/v1/evaluation`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/api/routes_evaluation.py): Now returns `status: "not_evaluated"`, `results: []`, and an explicit explanation that metrics require mounted datasets.
  - [`frontend/src/services/api.ts`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/frontend/src/services/api.ts): Removed mock fallback arrays that injected fabricated scores when offline.
  - [`frontend/src/pages/BenchmarksPage.tsx`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/frontend/src/pages/BenchmarksPage.tsx): Displays **"NO VERIFIED BENCHMARK RESULTS"** when no evaluated runs are returned by the backend.
  - Documentation ([`README.md`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/README.md), [`docs/EVALUATION.md`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/docs/EVALUATION.md), [`docs/ISRO_SUBMISSION_SUMMARY.md`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/docs/ISRO_SUBMISSION_SUMMARY.md)): Replaced fabricated claims with honest descriptions of benchmark requirements.

### B. Simulated "ISRO Evaluation" Replaced with Synthetic Pipeline Validation
* Removed the endpoint that generated random NumPy arrays and synthetic masks under the name "Live ISRO Evaluation".
* Implemented [`/api/v1/evaluation/synthetic-validation`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/api/routes_evaluation.py#L35-L65) backed by [`backend/app/evaluation/synthetic_validator.py`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/evaluation/synthetic_validator.py).
* All returns explicitly state `is_official_isro_evaluation: false` and carry the disclaimer: *"SYNTHETIC LOCAL PIPELINE VALIDATION ONLY... This does NOT represent official ISRO / SAC Cartosat-2S or RISAT-1A evaluation scores."*
* The UI button in [`BenchmarksPage.tsx`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/frontend/src/pages/BenchmarksPage.tsx) was renamed from **"Run Live ISRO Evaluation"** to **"Run Synthetic Pipeline Validation"**, with a distinct section explaining the requirements for **"Official Agency Evaluation"**.

### C. CRS Guessing Eliminated
* In [`backend/app/remote_sensing/geotiff.py`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/remote_sensing/geotiff.py), completely eliminated all fallback assignments guessing `EPSG:32644` or `EPSG:4326` when GeoTIFF coordinate reference system tags are absent.
* Missing CRS now strictly returns `crs = None` and `crs_display = "CRS unavailable"`.
* Added genuine tag parsing for Tag `34737` (`GeoAsciiParamsTag`) and GDAL GeoKey tags when using PIL fallback, ensuring only authentic CRS data is exposed.
* In frontend modals ([`MetadataInspectorModal.tsx`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/frontend/src/components/MetadataInspectorModal.tsx), [`ReportPreviewModal.tsx`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/frontend/src/components/ReportPreviewModal.tsx)), removed all fallback strings displaying `EPSG:32644`.

### D. Misleading Model Names & "Active / Lazy Loaded" Status
* Refactored [`BaseModel.load()`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/models/base.py) so that it never flags weightless baselines or API clients as `_is_loaded = True`.
* All 6 system components were renamed and relabeled in [`backend/app/agent/registry.py`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/agent/registry.py):
  1. `SatQueryVQA-RSAdapter` → `GenericVLMOrchestrator` (`status: demo`, `is_trained: false`, `is_remote_sensing_adapted: false`)
  2. `SatCaptioner-ViT-RS` → `ClassicalSpectralCaptionerBaseline` (`status: baseline`, `is_trained: false`)
  3. `SatGrounder-Segmenter` → `ClassicalBaselineGrounder` (`status: baseline`, `is_trained: false`)
  4. `SatChangeDetector-BiTemporal` → `PixelDifferenceChangeBaseline` (`status: baseline`, `is_trained: false`)
  5. `SatChangeVQA-RSNet` → `EvidenceGroundedChangeVQA` (`status: baseline`, `is_trained: false`)
  6. `SatFusionNet-OpticalSAR` → `OpticalSARVisualizationBaseline` (`status: baseline`, `is_trained: false`)
* In [`ModelRegistryPage.tsx`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/frontend/src/pages/ModelRegistryPage.tsx), removed deceptive "Active / Lazy Loaded" badges. Replaced with honest status indicators: `BASELINE`, `DEMO`, `AVAILABLE`, `UNAVAILABLE`.

### E. Sample Data Generator Fixed
* Rewrote [`backend/scripts/generate_sample_geotiffs.py`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/scripts/generate_sample_geotiffs.py) using `rasterio` directly. All generated sample files in `data/samples/` are verified with `dataset.crs != None` (EPSG:32644) and valid affine transforms.
* Labeled as **"Cartosat-style synthetic optical scene"** and **"RISAT-style synthetic SAR scene"** rather than claiming to be authentic agency satellite downloads.

### F. Training Pipeline & Notebooks
* Created [`training/scripts/seed.py`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/training/scripts/seed.py) providing deterministic seed control (`random`, `numpy`, `torch`).
* Rewrote [`training/scripts/train_adapter.py`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/training/scripts/train_adapter.py) with a real PyTorch training loop that raises `FileNotFoundError` when datasets are absent, records hyperparameter manifests, and logs actual loss values. Fake simulated loss loops were eliminated.
* Cleaned all 5 Colab notebooks in [`training/notebooks/`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/training/notebooks/), removing fake output cells and adding `> **Execution State:** Not executed.` disclaimers.

---

## 3. Remaining Baselines

The following components remain as classical or heuristic baselines, preserved for functional end-to-end operation, testing, and edge deployment:

| Task | Component Name | Underlying Method |
|---|---|---|
| **Captioning** | [`ClassicalSpectralCaptionerBaseline`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/models/captioning/captioner.py) | Inspects raster band count, computes mean albedo, standard deviation, and spectral dispersion across color channels. Returns structured descriptive metadata rather than canned phrases. |
| **Grounding** | [`ClassicalBaselineGrounder`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/models/grounding/grounder.py) | Dynamic radiometric thresholding and contour component extraction. Bounding boxes are filtered by area and aspect ratio based on query keywords (e.g., water, urban, vegetation). |
| **Change Detection** | [`PixelDifferenceChangeBaseline`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/models/change_detection/change_detector.py) | Absolute grayscale difference with Otsu/adaptive thresholding, morphological opening/closing, and spatial overlap verification. |
| **Change VQA** | [`EvidenceGroundedChangeVQA`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/models/change_detection/change_vqa.py) | Consumes structured evidence from the change detection baseline (change percentage, quadrant distribution, patch counts). Explicitly states: *"Spectral change detected; semantic class attribution unavailable"* when classification weights are absent. |
| **Optical-SAR Fusion**| [`OpticalSARVisualizationBaseline`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/models/optical_sar/optical_sar_fusion.py) | Empirical linear composite (alpha blend) with radiometric backscatter thresholding (dB conversion when data is calibrated). |

---

## 4. Real Models

| Model | Task | Source / Architecture | Status |
|---|---|---|---|
| **GenericVLMOrchestrator** | VQA / Language Synthesis | Google Gemini (`gemini-2.5-flash`) with fallback to local heuristic synthesis | `demo` / `available` (API key required) |
| **IntentClassifier** | Query Routing & Modality Planning | Rule-based semantic regex matching with pluggable LLM classifier | `production_model` (deterministic rule engine active) |
| **Spectral Indices Engine** | Biogeophysical Feature Extraction | Standard mathematical definitions (NDVI, NDWI, CIR, SAR dB transformation) | `production_model` (exact arithmetic active) |

All verified external model specifications and candidate checkpoints are cataloged in [`models/MODEL_MANIFEST.json`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/models/MODEL_MANIFEST.json) and [`docs/MODEL_REGISTRY.md`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/docs/MODEL_REGISTRY.md).

---

## 5. Models Still Required

To transition from baseline status to full neural inference, the following pretrained remote sensing models should be downloaded and mounted:

1. **Remote Sensing VQA Model:**
   * *Target:* `Earth-VQA` or `RSVQA-ViT` (e.g., fine-tuned `florence-2-base-ft` on RSVQA-LR).
   * *Status:* Manifested in [`models/MODEL_MANIFEST.json`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/models/MODEL_MANIFEST.json). Requires GPU memory (approx. 4GB VRAM) and download of 1.1GB checkpoint.
2. **Vision-Language Grounding Model:**
   * *Target:* `Grounding DINO` or `SAM-Geo` (Segment Anything for Geospatial).
   * *Status:* Manifested. Requires downloading model checkpoint (`groundingdino_swint_ogc.pth`).
3. **Bi-Temporal Deep Change Detector:**
   * *Target:* `BIT-CD` (Bitemporal Image Transformer) or `ChangeFormer`.
   * *Status:* Abstract interface [`BaseChangeDetector`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/models/change_detection/change_detector.py#L21) is implemented and ready to receive weights.
4. **Deep Optical-SAR Cross-Modal Fusion:**
   * *Target:* `MCANet` or `TFNet` (Two-branch Feature Fusion Network).
   * *Status:* Abstract fusion interface [`OpticalSARFusionModel`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/models/optical_sar/optical_sar_fusion.py#L19) is implemented and ready to receive weights.

---

## 6. Training Status

* **Status:** Cleaned, reproducible, and ready for dataset execution.
* **Deterministic Seeding:** Implemented via [`training/scripts/seed.py`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/training/scripts/seed.py) (seeds `random`, `numpy`, `torch`, and sets `torch.backends.cudnn.deterministic = True`).
* **Training Script:** [`training/scripts/train_adapter.py`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/training/scripts/train_adapter.py) accepts YAML/JSON configs, sets up a real PyTorch `DataLoader`, initializes model parameters, and executes standard forward/loss/backward optimization loops.
* **Integrity Gate:** Script strictly validates dataset presence. If the specified dataset directory does not exist or contains no images, it raises `FileNotFoundError` and logs a clean diagnostic message instead of simulating progress.
* **Checkpoints:** Output checkpoints save model state dict, optimizer state, epoch index, validation metrics, Git commit hash, and RNG state.

---

## 7. Benchmark Status

* **Status:** Zero fabricated metrics.
* **Persistence Layer:** [`backend/app/evaluation/persistence.py`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/evaluation/persistence.py) manages `data/benchmark_results.json`. If no runs have been executed, status is reported as `"not_evaluated"`.
* **Dataset Adapters:** Created generic [`DatasetAdapter`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/evaluation/dataset_adapter.py) supporting RSVQA-LR, VRSBench, and CDVQA formats. Adapters only process samples when authentic dataset files are present on the filesystem.
* **Evaluation Schemas:** Results adhere to [`BenchmarkResultItem`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/evaluation/schemas.py), requiring `dataset`, `split`, `task`, `model`, `metric`, `score`, `timestamp`, `commit_hash`, `configuration`, and `evaluation_status: completed`.

---

## 8. Synthetic Validation Status

* **Endpoint:** [`POST /api/v1/evaluation/synthetic-validation`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/api/routes_evaluation.py#L35)
* **Status:** Active & verified.
* **Function:** Procedurally generates deterministic geometric test patterns (concentric circles, synthetic checkerboards, contrast ramps) and calculates real mathematical metrics:
  - Mask IoU (Intersection over Union)
  - Mask F1-Score
  - Bounding Box Mean IoU
  - Cross-Modal Normalized Cross-Correlation (NCC)
* **Integrity:** Every output explicitly flags `is_official_isro_evaluation: false` and carries an unmissable disclaimer clarifying that it is a local pipeline arithmetic test.

---

## 9. Official Evaluation Readiness

* **Readiness:** Framework ready; awaiting authorized data.
* **Workflow:** [`POST /api/v1/evaluation/official-run`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/api/routes_evaluation.py#L67) accepts an official evaluation package path and ground truth annotation files.
* **Validation Criteria:** If official test splits (e.g., ISRO SAC CartoRISAT-Fusion test set) are not mounted, the endpoint returns HTTP 404 with instructions on how to provide authorized test packages.
* **Integrity Guarantee:** The system will never populate official benchmark panels using synthetic or guessed values.

---

## 10. Geospatial Processing Status

* **CRS Handling:** Fully hardened. Missing CRS strictly maps to `None` and displays as `"CRS unavailable"`.
* **Spatial Compatibility:** [`backend/app/remote_sensing/registration.py`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/remote_sensing/registration.py) computes genuine bounding box intersections in projected coordinates, calculates overlap percentages, and checks for CRS mismatches.
* **Registration Policy:** The system refuses to silently resize unreferenced images and call it "co-registration". For non-georeferenced pairs, it transparently reports `registration_applied: "pixel_rescaling_unreferenced"` with `is_co_registered: false`.
* **Rasterio Integration:** Native GeoTIFF reading and writing via Rasterio 1.4.4. All synthetic sample scenes in `data/samples/` have valid affine transforms and explicit EPSG:32644 CRS.

---

## 11. Deployment Status

* **Render Deployment Configuration:** [`render.yaml`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/render.yaml) was updated to replace permissive `CORS_ORIGINS="*"` with an explicit environment variable specification (`CORS_ORIGINS: "https://<your-vercel-domain>.vercel.app"`).
* **Vite API Integration:** Frontend uses `VITE_API_BASE_URL` with clean fallback to `http://localhost:8000` in development. Production builds compile cleanly via `npx vite build` with 0 TypeScript or lint errors.
* **Health Endpoint:** [`GET /api/v1/health`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/api/routes_health.py) returns genuine runtime device (`cpu` / `cuda`), active models, and truthful statuses.

---

## 12. Known Limitations

1. **Hardware / Heavy Weights in Repository:** Weight files for large multimodal models (e.g., 7B-parameter VLMs) are not stored in Git due to size and licensing constraints. When offline and without GPU, the system operates in baseline mode.
2. **Cloud Free-Tier API Rate Limits:** When using Gemini as the language synthesis fallback in `GenericVLMOrchestrator`, requests are subject to Google AI Studio rate limits and network availability.
3. **Reprojection on Windows:** Full on-the-fly GDAL reprojection between differing projected coordinate systems requires native GDAL shared libraries (PROJ/GEOS), which can vary across Windows environments.

---

## 13. Recommended Next Steps

1. **Mount Benchmark Datasets:** Download the public RSVQA-LR dataset and place it in `data/benchmarks/rsvqa/`. Run the evaluation adapter to generate the first verified, non-synthetic benchmark results.
2. **Incorporate Weights for Change Detection:** Download pretrained BIT-CD weights and drop them into `models/weights/bit_cd.pth` to upgrade `PixelDifferenceChangeBaseline` to `RealRemoteSensingChangeDetector`.
3. **Formal ISRO Evaluation Pack Integration:** Coordinate with ISRO / SAC organizers to mount official test images and evaluation polygons directly into the evaluation runner.
