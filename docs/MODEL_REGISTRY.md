# SatQuery AI — Specialist Model & Baseline Registry

This document records all active model adapters, classical baselines, and targeted open-source remote sensing backbones.
Every component truthfully declares whether it is a classical baseline, API orchestrator, or deep learning checkpoint.

---

## 1. Active In-Repository Implementations

| Component Name | Task Category | Implementation Status | Method / Backbone | Modality | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `RemoteSensingVLMProvider` (inside `GenericVLMOrchestrator`) | Single-Image VQA | `real_vlm` / `fallback` | `microsoft/Florence-2-base` (Lazy Loaded) with fallback to Gemini / `SpectralStatisticsBaseline` | Optical / Multispectral GeoTIFF | `operational` |
| `GenericVLMOrchestrator` | Single-Image VQA Orchestration | `demo` | Primary: Florence-2-base; Secondary: Gemini 2.5 Flash; Tertiary: Spectral Baseline | Optical / Multispectral | `operational` |
| `ClassicalSpectralCaptionerBaseline` | Image Captioning | `baseline` | Procedural band albedo & dynamic range dispersion | Optical / Multispectral | `baseline` |
| `GroundingProvider` (wrapping `OWLViTGroundingProvider`) | Visual Grounding | `real_model` / `fallback` | Primary: `google/owlvit-base-patch32` (Lazy Loaded); Fallback: `ClassicalBaselineGrounder` | Optical / Multispectral | `operational` |
| `ClassicalBaselineGrounder` | Visual Grounding Baseline | `baseline` | Spectral thresholding + connected component contours | Optical / Multispectral | `baseline` |
| `ChangeDetectionProvider` | Bi-Temporal Change Detection | `real_model` / `fallback` | Primary: `BIT-CD` (Bitemporal Image Transformer); Fallback: `PixelDifferenceChangeBaseline` | Bi-Temporal Optical / Multispectral | `operational` |
| `PixelDifferenceChangeBaseline` | Change Detection Baseline | `baseline` | Absolute spectral difference magnitude with spatial overlap check | Bi-Temporal Optical / SAR | `baseline` |
| `EvidenceGroundedChangeVQA` | Change VQA | `baseline` | Natural language synthesis strictly grounded in change metrics | Bi-Temporal Optical / SAR | `baseline` |
| `OpticalSARVisualizationBaseline` | Optical+SAR Fusion | `baseline` | Dual-modality linear blend + empirical backscatter thresholding | Optical + SAR | `baseline` |

---

## 2. Integrated Open-Source Vision-Language Foundation Model (Phase 2A)

### Single-Image VLM Backbone: `microsoft/Florence-2-base`
* **Model Identifier:** `microsoft/Florence-2-base`
* **Source / HuggingFace Repository:** [https://huggingface.co/microsoft/Florence-2-base](https://huggingface.co/microsoft/Florence-2-base)
* **License:** MIT License
* **Task:** Visual Question Answering (VQA) using task token `<VQA>`
* **Provider:** `RemoteSensingVLMProvider` (lazy loaded in `backend/app/models/vqa/vqa_model.py`)
* **Remote-Sensing Adapted:** **NO** (`is_remote_sensing_adapted = false`, `adaptation_status = "pretrained_general_vlm"`). General-purpose vision foundation model; zero false domain adaptation claims.
* **Weights Required:** Yes (~230M parameters, ~0.9 GB). Weights are loaded lazily on demand, never during request handling or app boot.
* **GPU Requirements:** Optional. Runs on CPU (RAM ≥ 4 GB, PyTorch float32) or NVIDIA CUDA GPU (VRAM ≥ 2 GB, PyTorch float16/bfloat16).
* **Environment Configuration:**
  - `RS_VLM_MODEL_ID`: Default `"microsoft/Florence-2-base"`
  - `RS_VLM_CHECKPOINT_PATH`: Local directory containing checkpoint weights (or empty to resolve via HuggingFace cache)
  - `RS_VLM_DEVICE`: `"auto"`, `"cuda"`, or `"cpu"`
  - `RS_VLM_DTYPE`: `"float32"`, `"float16"`, or `"bfloat16"`
* **Fallback Behavior:**
  1. `RemoteSensingVLMProvider` attempts local checkpoint loading.
  2. If checkpoint is unavailable or fails, returns `is_available: false`, `implementation_status: "unavailable"`, and yields to the fallback chain.
  3. Secondary fallback: Configured hosted API (Google Gemini 2.5 Flash if `GEMINI_API_KEY` present).
  4. Tertiary fallback: Factual classical remote sensing baseline (`SpectralStatisticsBaseline`).
  5. The API response explicitly states:
     ```json
     {
       "primary_model": "Florence-2-base",
       "actual_model_used": "SpectralStatisticsBaseline",
       "fallback_used": true,
       "implementation_status": "spectral_baseline"
     }
     ```
* **How to Obtain Weights & Run Local Inference:**
  ```bash
  # Pre-download weights into the local models directory:
  python -c "from transformers import AutoModelForCausalLM, AutoProcessor; AutoModelForCausalLM.from_pretrained('microsoft/Florence-2-base', trust_remote_code=True); AutoProcessor.from_pretrained('microsoft/Florence-2-base', trust_remote_code=True)"

  # Configure .env or environment:
  export RS_VLM_MODEL_ID="microsoft/Florence-2-base"
  export RS_VLM_DEVICE="cpu"
  export RS_VLM_DTYPE="float32"
  ```

---

## 3. Integrated Bi-Temporal Change Detection Architecture (Phase 2B: `BIT-CD`)

### Bi-Temporal Change Model Backbone: Bitemporal Image Transformer (`BIT-CD`)
* **Model Identifier:** `BIT-CD`
* **Source / Official Repository:** [https://github.com/justchenhao/BIT_CD](https://github.com/justchenhao/BIT_CD)
* **Citation:** Hao Chen and Zhenwei Shi, *"A Spatial-Temporal Attention-Based Method and a New Dataset for Remote Sensing Image Change Detection"*, IEEE Transactions on Geoscience and Remote Sensing (TGRS), 2021.
* **License:** MIT License
* **Task:** Bi-Temporal Surface Change Detection (Binary pixel change prediction)
* **Provider:** `SiameseRSChangeDetector` inside `ChangeDetectionProvider` (`backend/app/models/change_detection/change_detector.py`)
* **Remote-Sensing Adapted:** **YES** (`is_remote_sensing_adapted = true`, `adaptation_status = "remote_sensing_change_transformer"`). Specifically designed and pretrained for bi-temporal optical satellite change detection (LEVIR-CD, WHU-CD, DSIFN-CD).
* **Architecture:** ResNet-18 Siamese CNN backbone for feature extraction + Spatial Attention Tokenizer + Transformer Decoder for temporal interaction + Difference Projection prediction head.
* **Weights Required:** `bit_18.pth` or `bit_cd.pth` (~45 MB, ~11.5M parameters).
* **Current Weight Status:** Physical weights are not checked into the repository. The lazy loader detects presence/absence honestly:
  - If checkpoint is mounted: executes genuine PyTorch neural tensor inference.
  - If checkpoint is absent: returns `model_status: "checkpoint_not_found"` and triggers the verified `PixelDifferenceChangeBaseline` fallback.
* **Hardware Requirements:**
  - **CPU:** PyTorch `float32`, ~2 GB RAM. Inference latency ~150–300ms per 256×256 pair.
  - **GPU:** CUDA `float16` or `float32`, ~1 GB VRAM. Latency ~20–50ms.
* **Input Specifications & Preprocessing:**
  - **Inputs:** Dual rasters $T_1$ (Earlier) and $T_2$ (Later).
  - **Channels:** 3 channels per temporal scene (RGB). If multispectral GeoTIFF has >3 bands, uses configured RGB band mapping and records it in evidence.
  - **Normalization:** Min-max percentile dynamic range normalization followed by ImageNet RGB standardization (`mean=[0.485, 0.456, 0.406]`, `std=[0.229, 0.224, 0.225]`).
* **Outputs Generated:**
  1. `ev_t1_before`: Preprocessed $T_1$ baseline visualization.
  2. `ev_t2_after`: Preprocessed $T_2$ baseline visualization.
  3. `ev_change_map`: Predicted change probability map thresholded at $p > 0.50$.
  4. `ev_change_overlay`: Spatial overlay highlighting change clusters with bounding boxes on the $T_2$ scene.
* **Confidence Policy:** Raw neural change logits are uncalibrated; `confidence` is returned as `null` with label `"Not available (uncalibrated neural change logits)"`.
* **Environment Configuration:**
  - `CHANGE_MODEL_ID`: Default `"BIT-CD"`
  - `CHANGE_MODEL_CHECKPOINT_PATH`: Checkpoint file path (e.g. `models/weights/bit_cd.pth`)
  - `CHANGE_MODEL_DEVICE`: `"cpu"`, `"cuda"`, or `"auto"`
  - `CHANGE_MODEL_DTYPE`: `"float32"` or `"float16"`
* **How to Obtain Weights & Run Local Inference:**
  ```bash
  # Pre-download the official pretrained BIT-CD checkpoint:
  mkdir -p models/weights
  # Download bit_18.pth from official releases or repository into models/weights/bit_cd.pth
  
  # Configure .env or shell:
  export CHANGE_MODEL_ID="BIT-CD"
  export CHANGE_MODEL_CHECKPOINT_PATH="models/weights/bit_cd.pth"
  export CHANGE_MODEL_DEVICE="cpu"
  ```

---

## 4. Integrated Open-Source Visual Grounding Architecture (Phase 2C: `google/owlvit-base-patch32`)

### Visual Grounding Model Backbone: Open-World Localization Vision Transformer (`OWL-ViT`)
* **Model Identifier:** `google/owlvit-base-patch32`
* **Source / HuggingFace Repository:** [https://huggingface.co/google/owlvit-base-patch32](https://huggingface.co/google/owlvit-base-patch32)
* **Citation:** Matthias Minderer et al., *"Simple Open-Vocabulary Object Detection with Vision Transformers"*, ECCV 2022.
* **License:** Apache 2.0
* **Task:** Open-Vocabulary Text-Guided Visual Grounding / Object Localization (Predicts bounding boxes `[xmin, ymin, xmax, ymax]` from natural language queries)
* **Provider:** `OWLViTGroundingProvider` inside `GroundingProvider` (`backend/app/models/grounding/grounder.py`)
* **Remote-Sensing Adapted:** **NO** (`is_remote_sensing_adapted = false`, `adaptation_status = "pretrained_general_grounding"`). The model is a general vision foundation model for open-vocabulary detection; zero false domain adaptation claims.
* **Architecture:** Vision Transformer (ViT-B/32) image encoder + Contrastive text encoder + Class-agnostic box prediction head + Text-guided classification projection.
* **Weights Required:** ~150M parameters (~600 MB weights).
* **Current Weight Status:** Physical weights are not pre-bundled in the git repository. The lazy loader detects presence/absence honestly:
  - If checkpoint is mounted: executes genuine PyTorch neural tensor inference with `OwlViTProcessor` and `OwlViTForObjectDetection`.
  - If checkpoint is absent: returns `checkpoint_status: "checkpoint_not_found"` and triggers the verified `ClassicalBaselineGrounder` fallback.
* **Hardware Requirements:**
  - **CPU:** PyTorch `float32`, ~3 GB RAM. Inference latency ~300–600ms per 256×256 scene.
  - **GPU:** CUDA `float16` or `float32`, ~2 GB VRAM. Latency ~40–80ms.
* **Input Specifications & Preprocessing:**
  - **Inputs:** Single satellite raster scene (GeoTIFF, PNG, JPEG).
  - **Channels:** 3 channels (RGB). For multispectral imagery (>3 bands), min-max dynamic range normalization is applied across bands [1, 2, 3] to form an RGB composite.
  - **Text Targets:** Natural-language target phrases are extracted directly from user queries (e.g. "Find the water body" -> "water body"; "Locate buildings" -> "buildings").
* **Outputs Generated:**
  1. `ev_grounding_overlay`: Spatial overlay displaying predicted bounding boxes with target label annotations.
  2. `ev_grounding_mask`: Spatial candidate mask with pixel area statistics.
  3. `detections`: Array of detection objects containing `label`, `box` `[xmin, ymin, xmax, ymax]`, and raw model `score`.
* **Confidence Policy:** Raw neural detector logits are uncalibrated; `confidence` is returned as `null` with label `"Not available (uncalibrated detector logits)"` to prevent hallucinating calibrated probabilities.
* **Environment Configuration:**
  - `GROUNDING_MODEL_ID`: Default `"google/owlvit-base-patch32"`
  - `GROUNDING_MODEL_CHECKPOINT_PATH`: Checkpoint directory or file path
  - `GROUNDING_MODEL_DEVICE`: `"cpu"`, `"cuda"`, or `"auto"`
  - `GROUNDING_MODEL_DTYPE`: `"float32"` or `"float16"`
* **How to Obtain Weights & Run Local Inference:**
  ```bash
  # Pre-download the official pretrained OWL-ViT checkpoint:
  python -c "from transformers import OwlViTProcessor, OwlViTForObjectDetection; OwlViTProcessor.from_pretrained('google/owlvit-base-patch32'); OwlViTForObjectDetection.from_pretrained('google/owlvit-base-patch32')"

  # Configure .env or shell:
  export GROUNDING_MODEL_ID="google/owlvit-base-patch32"
  export GROUNDING_MODEL_DEVICE="cpu"
  export GROUNDING_MODEL_DTYPE="float32"
  ```

---

## 5. Targeted Future Models for Multi-Task Expansion

The following publicly available foundation models have been audited for future weights integration:

### A. Single-Image Remote Sensing VLM
* **Target Model Identifier:** `OpenGVLab/InternVL2-8B` / `Qwen/Qwen2-VL-7B-Instruct`
* **HuggingFace Repository:** `https://huggingface.co/Qwen/Qwen2-VL-7B-Instruct`
* **License:** Apache 2.0
* **Input Modality:** Multi-band RGB / GeoTIFF normalized rasters
* **Hardware Requirements:** Minimum 16GB VRAM (FP16 / Int4 quantization)

### B. Remote Sensing Visual Grounding & Segmentation
* **Target Model Identifier:** `google/owlvit-base-patch32` / `facebook/sam-vit-base`
* **HuggingFace Repository:** `https://huggingface.co/google/owlvit-base-patch32`
* **License:** Apache 2.0
* **Input Modality:** Optical RGB raster scenes
* **Hardware Requirements:** 8GB VRAM (or CPU inference)

### C. Bi-Temporal Change Detection
* **Target Model Architecture:** Bitemporal Image Transformer (`BIT`) / `ChangeFormer`
* **Repository:** `https://github.com/justchenhao/BIT_CD`
* **License:** MIT License
* **Input Modality:** Dual co-registered optical rasters (T1, T2)
* **Hardware Requirements:** 4GB VRAM

### D. Optical + SAR Cross-Modal Representation
* **Target Model Architecture:** `BigEarthNet-MM` multi-modal contrastive encoder
* **License:** CDLA-Permissive-1.0
* **Input Modality:** Sentinel-2 (B2-B8) + Sentinel-1 (VV, VH)
* **Hardware Requirements:** 8GB VRAM
