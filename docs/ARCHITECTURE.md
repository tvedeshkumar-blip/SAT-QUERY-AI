# SatQuery AI — System Architecture Specification

**ISRO Problem Statement 26167:** SatQuery AI — Interactive Vision-Language Assistant for Multimodal Remote Sensing Image Analysis  
**Repository:** `Miruthula426/satellite-photo-explorer`

---

## 1. End-to-End Multimodal Pipeline

SatQuery AI is designed as a decoupled, multi-tier agentic architecture:

```
SATQUERY AI
│
├── Frontend (React + Vite + TypeScript) -> Vercel Deployment
│   ├── Workspaces (Single, Bi-Temporal, Optical+SAR)
│   ├── Visual Evidence Viewer (Overlays, Masks, Boxes, Change Maps)
│   ├── Agent Execution Trace Panel
│   └── Benchmark Dashboard
│
├── FastAPI Backend (Python 3.11 + Uvicorn) -> Render Deployment
│   ├── Geospatial Engine (Rasterio, GeoTIFF, CRS, Band Scaling)
│   ├── Task Router & Intent Classifier
│   ├── Agent Controller & Trace Tracker
│   ├── Specialist Model Registry
│   └── Evidence Generator & Report Exporter (PDF/JSON)
```

---

## 2. Agent Controller & Task Routing Rules

The `AgentController` inspects query text, image count, and detected sensor modalities (`OPTICAL`, `SAR`, `MULTISPECTRAL`). Tasks are routed according to:

| Query Intent Keywords | Input Count / Modalities | Classified Task | Specialist Model Adapter / Baseline |
| :--- | :--- | :--- | :--- |
| "describe", "caption", "summary" | 1 Image | `captioning` | `ClassicalSpectralCaptionerBaseline` |
| "highlight", "detect", "water", "crop", "find", "locate", "where is", "where are", "show me", "pinpoint" | 1 Image | `grounding` | `GroundingProvider` (`google/owlvit-base-patch32` neural / `ClassicalBaselineGrounder` fallback) |
| "land cover", "what is shown" | 1 Image | `vqa` | `GenericVLMOrchestrator` (`Florence-2-base` / Gemini / Spectral Baseline) |
| "map", "detect change", "difference", "mask" | 2 Images (T1 & T2) | `change_detection` | `ChangeDetectionProvider` (`BIT-CD` neural / `PixelDifferenceChangeBaseline` fallback) |
| "what changed", "increase", "decrease" | 2 Images (T1 & T2) | `change_vqa` | `EvidenceGroundedChangeVQA` + `PixelDifferenceChangeBaseline` |
| "optical and SAR", "fusion", "SAR" | 2 Images (Opt + SAR) | `optical_sar` | `OpticalSARVisualizationBaseline` |

---

## 2.1 Bi-Temporal Change Detection Architecture (Phase 2B)

```
       T1 GeoTIFF (Earlier)                  T2 GeoTIFF (Later)
                │                                     │
                ▼                                     ▼
        GeoTIFF Parser                        GeoTIFF Parser
  (CRS, Bounds, NaN Masking)            (CRS, Bounds, NaN Masking)
                │                                     │
                └──────────────┬──────────────────────┘
                               ▼
                   Spatial Compatibility Check
             (CRS alignment, geographic overlap)
                               │
                               ▼
                     Multiband Preprocessing
             (Min-max normalization, ImageNet std)
                               │
                               ▼
                SiameseRSChangeDetector (BIT-CD)
          ┌────────────────────┴────────────────────┐
          ▼ (Checkpoint Available)                  ▼ (Checkpoint Missing / Fallback)
    BIT-CD Neural Pass                     PixelDifferenceChangeBaseline
  (ResNet-18 + Transformer Decoder)        (Spectral difference thresholding)
          │                                         │
          └────────────────────┬────────────────────┘
                               ▼
                   Change Probability / Mask
             (Thresholded binary map at p > 0.50)
                               │
                               ▼
                   Spatial Evidence & Overlay
             (4 Artifacts: T1, T2, Change Map, Overlay)
                               │
                               ▼
                    Observable Execution Trace
       (MODEL_SELECTED → CHANGE_INFERENCE/FALLBACK → EVIDENCE)
```

---

## 2.2 Visual Grounding & Object Localization Architecture (Phase 2C)

```
                       User Natural-Language Query
                   ("Find the water body", "Locate buildings")
                                │
                                ▼
                       Target Phrase Extractor
                  (Strips prompt prefixes, extracts target)
                                │
                                ▼
                       Single Satellite Raster
                       (GeoTIFF / PNG / JPEG)
                                │
                                ▼
                      Multiband Preprocessor
               (Dynamic range normalization, RGB composite)
                                │
                                ▼
                       GroundingProvider
         ┌──────────────────────┴──────────────────────┐
         ▼ (Checkpoint Available)                      ▼ (Checkpoint Missing / Fallback)
   OWL-ViT Neural Pass                       ClassicalBaselineGrounder
 (Vision Transformer ViT-B/32                (Spectral thresholding &
  + Text Projection & Box Heads)              contour component analysis)
         │                                             │
         └──────────────────────┬──────────────────────┘
                                ▼
                   Spatial Bounding Boxes
                 [xmin, ymin, xmax, ymax]
                                │
                                ▼
                    Evidence Generation Engine
             (ev_grounding_overlay, ev_grounding_mask)
                                │
                                ▼
                    Observable Execution Trace
  (MODEL_SELECTED → GROUNDING_INFERENCE/FALLBACK → BOUNDING_BOXES_GENERATED)
```

---

## 3. Geospatial Metadata & Raster Pipeline

- **GeoTIFF Support:** Utilizes `Rasterio` to parse `.tif`, `.tiff`, and `.geotiff` byte arrays.
- **Metadata Extraction:** Extracts spatial extent (bounds), Coordinate Reference System (`EPSG:4326`, `EPSG:32644`), affine transformation matrix, band counts, and nodata values.
- **Multi-bit Normalization:** Percentile clipping (2-98%) scales 16-bit uint16 / float32 satellite bands into 8-bit dynamic range without saturation.
- **Spatial Alignment:** Resizes and aligns bi-temporal or optical-SAR image pairs using affine scaling.
