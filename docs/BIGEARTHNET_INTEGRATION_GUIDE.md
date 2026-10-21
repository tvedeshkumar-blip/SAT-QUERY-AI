# BigEarthNetv2 Sentinel-2 ResNet-50 Integration Guide

## 1. Executive Overview & Mission
This document outlines the official integration of the **BigEarthNetv2 (reBEN)** Sentinel-2 ResNet-50 multi-label land-cover classification model into **SatQuery AI**.

The model enables automated, scientific multi-label classification of 10-band Sentinel-2 Level-2A (L2A) multispectral imagery across the 19 standard CORINE Land Cover (CLC) categories, maintaining strict adherence to remote sensing principles, authentic weight validation, and scientific honesty.

---

## 2. Checkpoint Comparison & Selection Rationale

### Candidate Models Inspected
1. **Candidate 1: `BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.1.1`**
   - Source: Hugging Face (`https://huggingface.co/BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.1.1`)
   - Architecture: ResNet-50 backbone with 10-channel `conv1` (`kernel=7, stride=2, padding=3`) and 19-class linear head (`Linear(2048, 19)`).
   - Weights: `model.safetensors` (320 tensors, ~102.5 MB).
   - Strict Loading Status: **PASS** (320 keys matched strictly with 0 missing / 0 unexpected keys).
   - Dummy Output: Shape `(1, 19)`, all values finite.
   - **Band Order**: `["B02", "B03", "B04", "B08", "B05", "B06", "B07", "B11", "B12", "B8A"]` (grouped 10m bands first).
   - **Deprecation Note**: The authors explicitly tagged this repository with `new_version: BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.2.0` and included a note stating that `v0.1.1` used a non-standard band order incompatible with subsequent releases.

2. **Candidate 2: `BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.2.0` (SELECTED DEFAULT)**
   - Source: Hugging Face (`https://huggingface.co/BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.2.0`)
   - Architecture: ResNet-50 backbone with 10-channel `conv1` (`kernel=7, stride=2, padding=3`) and 19-class linear head (`Linear(2048, 19)`).
   - Weights: `model.safetensors` (320 tensors, ~102.5 MB).
   - Strict Loading Status: **PASS** (320 keys matched strictly with 0 missing / 0 unexpected keys).
   - Dummy Output: Shape `(1, 19)`, all values finite.
   - **Band Order**: `["B02", "B03", "B04", "B05", "B06", "B07", "B08", "B8A", "B11", "B12"]` (conforms to official ESA Sentinel-2 technical documentation order).

### Final Selection Rationale
`BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.2.0` is selected as the primary and default model because:
1. It strictly conforms to the standard ESA Sentinel-2 technical documentation band order: `[B02, B03, B04, B05, B06, B07, B08, B8A, B11, B12]`.
2. It is the updated and recommended model release from BIFOLD and TU Berlin (RSiM group).
3. `v0.1.1` was officially deprecated by its creators due to its non-standard 10m-grouped band order.
4. **Dynamic Compatibility**: SatQuery AI's `BigEarthNetResNet50Classifier` dynamically detects the checkpoint version and automatically configures the appropriate band order and normalization statistics if `v0.1.1` is requested via `BIGEARTHNET_MODEL_ID`.

---

## 3. Band Order & Geospatial Preprocessing

### Band Order Resolution
| Channel Index | v0.2.0 (Official ESA Order) | v0.1.1 (10m Grouped Order) | Sentinel-2 Description | Native Resolution |
| :---: | :---: | :---: | :---: | :---: |
| 0 | **B02** | **B02** | Blue (490 nm) | 10 m |
| 1 | **B03** | **B03** | Green (560 nm) | 10 m |
| 2 | **B04** | **B04** | Red (665 nm) | 10 m |
| 3 | **B05** | **B08** | Red Edge 1 (705 nm) / NIR (842 nm) | 20 m / 10 m |
| 4 | **B06** | **B05** | Red Edge 2 (740 nm) / Red Edge 1 (705 nm) | 20 m |
| 5 | **B07** | **B06** | Red Edge 3 (783 nm) / Red Edge 2 (740 nm) | 20 m |
| 6 | **B08** | **B07** | NIR (842 nm) / Red Edge 3 (783 nm) | 10 m / 20 m |
| 7 | **B8A** | **B11** | Narrow NIR (865 nm) / SWIR-1 (1610 nm) | 20 m |
| 8 | **B11** | **B12** | SWIR-1 (1610 nm) / SWIR-2 (2190 nm) | 20 m |
| 9 | **B12** | **B8A** | SWIR-2 (2190 nm) / Narrow NIR (865 nm) | 20 m |

### Normalization Statistics (reBEN Training Split)
Computed across the official BigEarthNet v2.0 training dataset at 120 × 120 resolution:
- **v0.2.0 Channel Means**:
  `[438.3721, 614.0557, 588.4096, 942.8433, 1769.9316, 2049.5515, 2193.2920, 2235.5566, 1568.2268, 997.7325]`
- **v0.2.0 Channel Standard Deviations**:
  `[607.0269, 603.2968, 684.5688, 738.4327, 1100.4561, 1275.8054, 1369.3717, 1356.5441, 1070.1613, 813.5276]`

### Mixed Resolution & Spatial Resampling
Sentinel-2 delivers 10m bands (B02, B03, B04, B08) and 20m bands (B05, B06, B07, B8A, B11, B12). The official reBEN benchmark resamples all bands to a unified 120 × 120 spatial patch (representing approximately 1.2 km × 1.2 km on ground). SatQuery AI bilinearly interpolates any incoming multi-spectral tensor to `(120, 120)` before normalization and forward pass.

### Reflectance Scaling
If input reflectance is in float format `[0.0, 1.0]` (or `[0.0, 2.0]`), the preprocessing pipeline detects this and scales by `10,000.0` into the native Sentinel-2 Digital Number (DN) scale expected by the reBEN weights.

---

## 4. Multi-Label Classification Semantics

BigEarthNet v2.0 is a **multi-label** classification problem, NOT mutually exclusive 19-class softmax. A single satellite patch can simultaneously contain "Coniferous forest", "Inland waters", and "Transitional woodland, shrub".

- **Activation**: Element-wise Sigmoid (`torch.sigmoid(logits)`), producing 19 independent probabilities in `[0.0, 1.0]`.
- **Decision Threshold**: Configurable via `BIGEARTHNET_THRESHOLD` (default: `0.50`). Any class with $P \ge \text{threshold}$ is returned in `predicted_classes`.
- **Scientific Caveat**: Probabilities are uncalibrated sigmoid outputs. They represent relative model confidence and class presence across the patch, not frequentist ground-truth probabilities.

### 19 CORINE Land Cover (CLC) Classes
1. Agro-forestry areas
2. Arable land
3. Beaches, dunes, sands
4. Broad-leaved forest
5. Coastal wetlands
6. Complex cultivation patterns
7. Coniferous forest
8. Industrial or commercial units
9. Inland waters
10. Inland wetlands
11. Land principally occupied by agriculture, with significant areas of natural vegetation
12. Marine waters
13. Mixed forest
14. Moors, heathland and sclerophyllous vegetation
15. Natural grassland and sparsely vegetated areas
16. Pastures
17. Permanent crops
18. Transitional woodland, shrub
19. Urban fabric

---

## 5. Input Requirements & Strict Screenshot Rejection

Copernicus Browser screenshots (True Color, False Color CIR, SWIR, NDVI visualizations) are 3-channel RGB renderings, not 10-band multispectral data.

- **Rejection Policy**:
  - Inputs with fewer than 10 channels or identified as `visual_preview` are rejected for BigEarthNetv2.
  - The system will **never** duplicate RGB channels, synthesize fake spectral bands, or hallucinate classifications from visual screenshots.
- **Graceful Error Handling**:
  - In `InputValidator` and `AgentController`: Unsuitable screenshots return a 200 response with `model_status: "invalid_input"`, `is_clarification_required: true`, and a clear explanation directing the user to supply raw 10-band GeoTIFF data or use Single-Image VQA for visual images.
  - In `BigEarthNetResNet50Classifier.preprocess()`: Directly raises a detailed `ValueError` if an invalid tensor is supplied.

---

## 6. Architecture & Integration Points

### Backend Components
1. **Model Adapter** (`backend/app/models/classification/bigearthnet_classifier.py`):
   - Subclasses `BaseModel`.
   - Lazy loading with authentic weight validation.
   - Separate `preprocess()` and `predict()` methods.
2. **Model Registry** (`backend/app/agent/registry.py`):
   - Registers `classification` and `land_cover_classification`.
   - Discloses model source, 10-band requirements, MIT license, and version.
3. **Task Routing** (`backend/app/agent/router.py` & `backend/app/agent/planner.py`):
   - Natural language queries containing `["land cover", "classify", "corine", "bigearthnet", "land use"]` or explicit mode `classification` route directly to `land_cover_classification`.
4. **Agent Controller** (`backend/app/agent/controller.py`):
   - Validates input raster channels before inference.
   - Logs `CLASSIFICATION_INFERENCE` and `LAND_COVER_PREDICTED` trace steps.
   - Emits structured `classification_result` and `VisualEvidence` artifact `ev_bigearthnet_classification`.
5. **FastAPI Endpoints** (`backend/app/api/routes_analysis.py`):
   - `@router.post("/analyze/classify", response_model=AnalysisResponseSchema)`
   - Full compatibility with existing `@router.post("/analyze")` and `@router.post("/query")`.

### Frontend Components
1. **TypeScript Contracts** (`frontend/src/types/index.ts`):
   - `AnalysisMode` includes `'classification'`.
   - `TaskType` includes `'classification' | 'land_cover_classification'`.
   - Adds `ClassificationResult` and `ClassificationPredictionItem` schemas.
2. **Analysis Result Card** (`frontend/src/components/AnalysisResultCard.tsx`):
   - High-fidelity telemetry card with 19 CORINE progress bars and probability badges.
   - Green chip indicators for predicted classes exceeding threshold.
   - Warning banner if input is an RGB screenshot.
3. **API Client** (`frontend/src/services/api.ts`):
   - `submitClassifyAnalysis(payload)` calling `/api/v1/analyze/classify`.
4. **Demo Presets** (`frontend/src/utils/demoPresets.ts`):
   - Added **Demo 6: BigEarthNet Land Cover** with 10-band multispectral test scene.
5. **Model Registry UI** (`frontend/src/pages/ModelRegistryPage.tsx`):
   - Lists BigEarthNetv2 ResNet-50 with authentic specs and MIT license.

---

## 7. Benchmarking & Evaluation Harness

The dataset adapter (`backend/app/evaluation/dataset_adapter.py`) implements a multi-label evaluation suite for BigEarthNet:
- **Per-Class Metrics**: Precision, Recall, F1-Score, Support, TP, FP, FN.
- **Aggregate Metrics**: Macro F1, Micro F1, Mean Average Precision (mAP).
- **Scientific Honesty**: If the 59 GiB dataset is not mounted locally, the adapter reports:
  ```json
  {
    "dataset": "BigEarthNet-MM",
    "status": "not_evaluated",
    "message": "BigEarthNet dataset files not mounted at configured path. SatQuery AI enforces scientific integrity and will never fabricate benchmark metrics without genuine physical test data.",
    "evaluation_pending": true
  }
  ```

---

## 8. Configuration & Environment Variables

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `BIGEARTHNET_MODEL_ID` | `BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.2.0` | Hugging Face repository ID (or `...v0.1.1`) |
| `BIGEARTHNET_MODEL_REVISION` | `main` | Git commit or branch revision |
| `BIGEARTHNET_CACHE_DIR` | `None` (default HF cache) | Directory for cached model weights |
| `BIGEARTHNET_DEVICE` | `cuda` (if available) else `cpu` | PyTorch execution device |
| `BIGEARTHNET_THRESHOLD` | `0.5` | Multi-label sigmoid decision threshold |
| `BIGEARTHNET_CHECKPOINT_PATH` | `None` | Optional local filepath to `model.safetensors` |

---

## 9. Verification & Execution Commands

### Run Backend Unit & Integration Tests
```powershell
.\.venv\Scripts\python.exe -m pytest backend/app/tests/test_bigearthnet_model.py -v
```

### Run Full Test Suite
```powershell
.\.venv\Scripts\python.exe -m pytest backend/app/tests -v
```

### Run Frontend Unit Tests
```powershell
cd frontend
npm test -- --run
```

### Build Frontend Production Bundle
```powershell
cd frontend
npm run build
```

### Launch Application
```powershell
# Backend (FastAPI on http://127.0.0.1:8000)
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Frontend (Vite on http://127.0.0.1:5173)
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
```
