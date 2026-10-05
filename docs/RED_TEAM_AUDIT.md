# SatQuery AI — Scientific and Engineering Red Team Audit

**Audit Date:** 2026-09-28  
**Lead Auditor:** SatQuery AI Red Team Hardening Pass  
**Repository:** `Miruthula426/satellite-photo-explorer`  
**Classification:** Scientific Integrity, Architectural Honesty & Safety Audit

---

## Executive Summary

A comprehensive red team evaluation of the SatQuery AI system was conducted to audit scientific claims, model architectures, geospatial processing routines, evaluation benchmarks, and training pipelines.

The audit revealed severe discrepancies between the project's documented scientific claims and its actual implementation. Several components structurally presented as specialist deep learning models are in reality heuristic rule-based baselines, canned string formatters, or unadapted generic APIs. Furthermore, benchmark scores, evaluation routines, and training losses were fabricated or hardcoded.

This document details all 12 audited vulnerability categories and provides immediate remediation requirements.

---

## 1. Fake / Scaffolded Model Behavior

| Component | Purported Architecture | Actual Implementation | Severity |
| :--- | :--- | :--- | :--- |
| `RemoteSensingCaptioner`<br>([captioner.py](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/models/captioning/captioner.py#L9-L43)) | `SatCaptioner-ViT-RS`<br>(Vision Transformer text decoder adapter) | Returns a static string template: `"The image depicts prominent land cover features including agricultural fields, river/water body corridors, and built-up settlements..."`. Zero ViT or neural weights used. | **Critical (P0)** |
| `RemoteSensingGrounder`<br>([grounder.py](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/models/grounding/grounder.py#L9-L123)) | `SatGrounder-Segmenter`<br>(Specialist remote sensing segmentation) | Simple grayscale threshold heuristics: `gray < 70` for water, `(g - r) > 10` for vegetation, `80 < gray < 220` for built-up. Labeled misleadingly as specialist RS grounding. | **Critical (P0)** |
| `ChangeDetector`<br>([change_detector.py](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/models/change_detection/change_detector.py#L10-L129)) | `SatChangeDetector-BiTemporal`<br>(Specialist deep change detector) | Absolute difference of grayscale pixels with fixed cutoff `diff > 35`. | **High (P0)** |
| `ChangeVQA`<br>([change_vqa.py](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/models/change_detection/change_vqa.py)) | `SatChangeVQA-RSNet`<br>(Deep multimodal change reasoning) | Wraps difference change mask and formats template text. Makes unsupported assertions of "structural alteration". | **High (P1)** |
| `OpticalSARAnalyzer`<br>([optical_sar_fusion.py](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/models/optical_sar/optical_sar_fusion.py#L10-L105)) | `SatFusionNet-OpticalSAR`<br>(Cross-modal neural fusion adapter) | 50/50 linear RGB pixel blend `(0.5 * opt + 0.5 * sar)`. Arbitrary intensity slicing `sar < 40` (water) and `sar > 200` (urban). | **Critical (P0)** |
| `RemoteSensingVQAAdapter`<br>([vqa_model.py](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/models/vqa/vqa_model.py#L10-L75)) | `SatQueryVQA-RSAdapter`<br>(Remote sensing domain adapted VLM) | When `GEMINI_API_KEY` is present, queries generic `gemini-2.5-flash` with a system prompt; fallback is static template. No domain adapter exists. | **High (P0)** |

---

## 2. Hardcoded & Fabricated Metrics

| Endpoint / File | Hardcoded Metrics | Scientific Violation |
| :--- | :--- | :--- |
| `GET /api/v1/evaluation`<br>([routes_evaluation.py](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/api/routes_evaluation.py#L6-L44)) | RSVQA (LR): `84.6%`<br>VRSBench: `62.4%`<br>CDVQA: `79.2%`<br>ISRO CartoRISAT: `88.1%` | Completely fabricated. No evaluation pipeline was run to produce these numbers. |
| `BenchmarksPage.tsx`<br>([BenchmarksPage.tsx](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/frontend/src/pages/BenchmarksPage.tsx#L19-L52)) | Hardcoded comparison deltas (`+23.4%`, `+19.3%`, `+30.7%`, `+18.7%`) and KPI cards. | Renders false claims of benchmark superiority directly to user. |
| `frontend/src/services/api.ts`<br>([api.ts](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/frontend/src/services/api.ts#L61-L68)) | Fallback array with `84.6%`, `62.4%`, `79.2%`, `88.1%` if API fails. | Hides offline/missing evaluation status with fabricated data. |
| `README.md` & `docs/ISRO_SUBMISSION_SUMMARY.md` | Claims of `84.6%`, `62.4%`, `79.2%`, `88.1%` alongside baseline comparisons. | Formal documentation presents unverified benchmark scores as verified facts. |

---

## 3. Simulated ISRO Evaluation

* **Endpoint:** `POST /api/v1/evaluation/isro-run` ([routes_evaluation.py](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/api/routes_evaluation.py#L46-L85))
* **Implementation:** Uses `np.random.randint(50, 200, (256, 256, 3))` for optical and `np.random.randint(20, 220, (256, 256))` for SAR. Feeds hardcoded bounding box `[30, 40, 120, 140]` and synthetic rectangular mask to `ISROEvaluator`.
* **Frontend Labeling:** Button in [BenchmarksPage.tsx](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/frontend/src/pages/BenchmarksPage.tsx#L252) claims: **"Run Live ISRO Evaluation"**.
* **Integrity Assessment:** Falsely presents random array synthetic pipeline smoke tests as official ISRO evaluation on Cartosat-2S and RISAT-1A imagery.

---

## 4. Training Stubs & Fabricated Loss Logs

* **File:** `training/scripts/train_adapter.py` ([train_adapter.py](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/training/scripts/train_adapter.py#L8-L19))
* **Audited Lines:**
  ```python
  logger.info("Executing training epoch 1/10... Loss: 0.4281")
  logger.info("Executing training epoch 5/10... Loss: 0.1894")
  logger.info("Executing training epoch 10/10... Loss: 0.0921")
  logger.info("Training complete. Saved checkpoint to ./checkpoints/satquery_adapter_latest.pt")
  ```
* **Integrity Assessment:** The script executes zero forward passes, zero backward passes, zero optimizer steps, and saves zero checkpoints. It merely emits hardcoded fake loss messages.
* **Reproducibility:** No random seed management (`torch.manual_seed`, `np.random.seed`), no deterministic flag setting, and no dataset loading pipeline.
* **Notebooks:** `training/notebooks/01_*.ipynb` through `05_*.ipynb` contain bare stub cells without executable workflows or explicit execution status.

---

## 5. Geospatial Inaccuracies & CRS Guessing

* **Files:** `backend/app/remote_sensing/geotiff.py` ([geotiff.py](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/remote_sensing/geotiff.py#L90-L113)), `frontend/src/components/MetadataInspectorModal.tsx`, `frontend/src/components/ReportPreviewModal.tsx`.
* **Audited Faults:**
  ```python
  # geotiff.py line 90-93:
  if -180.0 <= left <= 180.0 and -90.0 <= bottom <= 90.0:
      metadata["crs"] = "EPSG:4326"
  else:
      metadata["crs"] = "EPSG:32644" # Standard Cartosat UTM Zone 44N
  # geotiff.py line 111-112:
  if not metadata["crs"] and metadata["is_geotiff"]:
      metadata["crs"] = "EPSG:32644"
  ```
  ```tsx
  // MetadataInspectorModal.tsx line 54:
  {metadata.crs || 'EPSG:32644 (UTM Zone 44N)'}
  // ReportPreviewModal.tsx line 96:
  {meta.crs || 'EPSG:32644 (UTM 44N)'}
  ```
* **Scientific Risk:** Automatically defaulting missing Coordinate Reference Systems to `EPSG:32644` (UTM Zone 44N) is scientifically dangerous. An image in UTM Zone 43N, or non-projected pixel coordinates, will be misprojected by hundreds of kilometers. Missing CRS must strictly be reported as `null` / `"CRS unavailable"`.

---

## 6. Registration Weaknesses

* **File:** `backend/app/remote_sensing/registration.py` ([registration.py](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/remote_sensing/registration.py#L8-L35))
* **Audited Faults:**
  ```python
  if (h_a, w_a) != (h_b, w_b):
      img_b_aligned = cv2.resize(img_b, (w_a, h_a), ...)
  registration_info = {"aligned": True, "transform": "scale_affine_matched"}
  ```
* **Scientific Risk:** Simply resizing `img_b` to match pixel dimensions of `img_a` ignores bounds, CRS, spatial extents, pixel resolutions, and physical ground footprint overlap. Reporting `"aligned": True` and `"transform": "scale_affine_matched"` for arbitrary unaligned rasters is false.

---

## 7. Routing Weaknesses

* **File:** `backend/app/agent/router.py` ([router.py](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/agent/router.py#L6-L41))
* **Audited Faults:** Single rigid static method checking primitive substrings (`"highlight"`, `"sar"`, `"change"`). Returns only a naked task string without classification confidence, explanatory reasoning, required modality contracts, or selected model manifests.

---

## 8. Deployment Weaknesses

* **File:** `render.yaml` ([render.yaml](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/render.yaml))
* **Audited Faults:** Permissive or hardcoded environment configurations.
* **Risk:** Lacks environment variable driven `CORS_ORIGINS` for authorized production frontend domains (Vercel domain integration). Potential security surface if permissive origins are used in production.

---

## 9. Frontend Fallback Data

* **File:** `frontend/src/services/api.ts` ([api.ts](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/frontend/src/services/api.ts#L61-L68))
* **Audited Faults:** Hardcoded mock array returned upon network or API error, deceiving the user into believing the backend provided verified benchmark figures.
* **File:** `frontend/src/utils/presetPhotos.ts` ([presetPhotos.ts](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/frontend/src/utils/presetPhotos.ts#L79-L96))
* **Audited Faults:** Unsplash photography labeled as "Cartosat-2S (0.6m) + RISAT-1A C-Band SAR" with synthetic EPSG:32644 metadata.

---

## 10. Misleading Model Names

The following naming conventions falsely imply neural model architectures and training histories:

| Current Misleading Name | Current Reality | Required Truthful Name |
| :--- | :--- | :--- |
| `SatGrounder-Segmenter` | Grayscale thresholding | `ClassicalBaselineGrounder` |
| `SatChangeDetector-BiTemporal` | Absolute grayscale difference | `PixelDifferenceChangeBaseline` |
| `SatFusionNet-OpticalSAR` | 50/50 RGB alpha blend | `OpticalSARVisualizationBaseline` |
| `SatCaptioner-ViT-RS` | Hardcoded text template | `TemplateBaselineCaptioner` |
| `SatQueryVQA-RSAdapter` | Gemini prompting or template | `GenericVLMOrchestrator` / `BaselineVQA` |
| `SatChangeVQA-RSNet` | Template on difference mask | `HeuristicChangeVQA` |

---

## 11. Fabricated Metadata & Lazy Loading Claims

* **File:** `backend/app/models/base.py` ([base.py](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/backend/app/models/base.py#L19-L21))
  ```python
  def load(self) -> None:
      self._is_loaded = True
  ```
* **File:** `frontend/src/pages/ModelRegistryPage.tsx` ([ModelRegistryPage.tsx](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/frontend/src/pages/ModelRegistryPage.tsx#L93-L96))
  ```tsx
  <span className="inline-flex items-center gap-1 text-emerald-400">
    <CheckCircle2 className="w-3.5 h-3.5" />
    Active / Lazy Loaded
  </span>
  ```
* **Integrity Assessment:** `BaseModel.load()` performs no weight loading or tensor initialization. The frontend displays green "Active / Lazy Loaded" badges for models that have zero weights and zero memory footprint.

---

## 12. Unsupported Scientific Claims

1. **Physical SAR Interpretation:** Asserting that `SAR < 40` physically represents water and `SAR > 200` represents urban double-bounce without speckle filtering, radiometric calibration ($\gamma^0 / \sigma^0$), decibel scaling, or incidence angle correction.
2. **Semantic Change Attribution:** Asserting in Change VQA that "structural alteration" or "built-up increase" occurred without a semantic land cover classifier.
3. **Cartosat / RISAT Provenance:** Calling synthetic demonstration imagery and Unsplash images "Cartosat-2S" and "RISAT-1A".

---

## Remediation Roadmap

1. **P0 (Immediate):**
   - Replace fabricated benchmark return in `/api/v1/evaluation` with `status: "not_evaluated"`.
   - Remove simulated ISRO evaluation `/api/v1/evaluation/isro-run` and replace with `/api/v1/evaluation/synthetic-validation`.
   - Remove all EPSG:32644 fallback guesses across backend and frontend.
   - Relabel all heuristic components to explicit `*Baseline` names.
   - Refactor `BaseModel.load()` to reflect actual model resource status (`baseline`, `loaded`, `unavailable`).
2. **P1 (Core Engineering):**
   - Build real evaluation infrastructure in `backend/app/evaluation/` (`DatasetAdapter`, metric calculations, persistence).
   - Implement real training script with seed control (`training/scripts/seed.py`, `train_adapter.py`) that fails honestly when weights/datasets are absent.
   - Implement Rasterio geospatial pairing (CRS, bounds, overlap, reprojection) in `registration.py`.
   - Implement pluggable model adapter architecture for Grounding, Change Detection, and Optical-SAR.
3. **P2 (Interface & Deployment):**
   - Update frontend benchmarks, model registry, and preset labels.
   - Add scientific integrity test suite `backend/app/tests/test_scientific_integrity.py`.
