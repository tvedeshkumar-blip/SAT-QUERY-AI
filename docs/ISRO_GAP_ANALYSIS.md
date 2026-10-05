# ISRO Problem Statement 26167 Gap Analysis

**Project:** SatQuery AI — Vision-Language Assistant for Multimodal Remote Sensing Image Analysis  
**Benchmark Target:** ISRO / SAC Evaluation & Remote Sensing VQA / Change Detection Datasets (VRSBench, RSVQA, CDVQA)

---

## 1. Requirement vs. Existing State Matrix

| Requirement Domain | ISRO PS 26167 Specification | Existing State | Gap / Action Plan |
| :--- | :--- | :--- | :--- |
| **System Identity & Purpose** | Agentic multimodal RS assistant for single-image, bi-temporal, & optical-SAR satellite imagery analysis. | Generic planetary/astronomical image viewer powered by Gemini. | Complete architectural transformation into **SatQuery AI** workspace. |
| **Architecture** | React Frontend + Python FastAPI Backend + Agent Controller + Specialist Model Adapters + Evidence Engine + Confidence Calibration. | Express.js monolith calling Gemini API directly. | Modular decoupled structure with `frontend/` (Vite+React) and `backend/` (FastAPI). |
| **Input Modalities** | Optical, Multispectral, SAR (Synthetic Aperture Radar), GeoTIFF rasters with CRS, transform, & band metadata. | Standard web images (JPEG/PNG) with no geospatial metadata handling. | Integrate `Rasterio`, OpenCV, NumPy, and PIL for GeoTIFF parsing, CRS extraction, and multi-band handling. |
| **Analysis Modes** | 1. Single Image VQA / Captioning / Grounding<br>2. Bi-Temporal Change Detection & Change VQA<br>3. Optical + SAR Cross-Modal Fusion | Single image basic generic Q&A. | Implement 3 explicit operational workspace modes with dedicated backend tool handlers. |
| **Agent Controller & Routing** | Query intent classification, task routing, specialist tool selection, and observable execution trace log. | No agent controller or task routing logic. | Build `AgentController`, `TaskRouter`, `Planner`, and real-time execution trace tracking. |
| **Specialist Models** | RS-VQA, Captioner, Grounder/Segmenter, Bi-Temporal Change Detector, and Optical-SAR Fusion models. | Single LLM (Gemini) prompt call. | Model Registry abstraction (`BaseModel`, `RemoteSensingVQAAdapter`, `ChangeDetectorAdapter`, `GroundingAdapter`). |
| **Visual Evidence Engine** | Overlay generation, segmentation masks, bounding box rendering, change maps, and change statistics. | Textual responses only; no visual overlays or bounding boxes. | Implement Evidence Engine generating interactive layer overlays (Original, Processed, Mask, Boxes, Change Maps). |
| **Confidence & Metrics** | Calibrated confidence score or explicit `Not available` / `Demo mode`. No fake numbers. | No confidence indicator. | Expose model-based confidence when calibrated; return `null` or `Not available` otherwise. |
| **Training & Fine-Tuning** | Colab-compatible training pipeline adapted on remote-sensing data (BigEarthNet / RSVQA / CDVQA). | No training pipeline or adaptation scripts. | Create `training/` with Jupyter notebooks and LoRA/adapter scripts for RS VLM fine-tuning. |
| **Evaluation Framework** | Standard evaluation scripts for VRSBench, RSVQA, and CDVQA with benchmark dashboard. | No benchmark framework. | Create `backend/app/evaluation/` and `/benchmarks` dashboard route. |
| **Report Generation** | Downloadable summary reports in PDF and JSON formats. | No export functionality. | Implement Report Generator service with PDF and JSON export APIs. |

---

## 2. Mandatory Verification Checklists

1. **No Fake AI / Metrics:** Ensure confidence, masks, bounding boxes, and percentages are strictly derived from real specialist model outputs or clearly designated as `Demo mode`.
2. **Preserve Geospatial Metadata:** GeoTIFF uploads must preserve nodata values, spatial bounds, band counts, and coordinate reference systems (CRS).
3. **ISRO/SAC Co-registration:** Ensure readiness for Cartosat-2S (optical) + RISAT (SAR) pair inputs.
