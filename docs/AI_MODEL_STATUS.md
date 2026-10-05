# SatQuery AI — AI Model Status Document

**Date:** 2026-09-28  
**Scope:** Status, Provider Architecture, Provenance, and Fallbacks for All Models in SatQuery AI  
**Repository:** [Miruthula426/satellite-photo-explorer](https://github.com/Miruthula426/satellite-photo-explorer)

---

## 1. Model Status Summary

| Model Identifier | Task | Provider Type | Implementation Status | RS Adapted | License | Fallback Mechanism |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **GenericVLMOrchestrator** | Visual Question Answering | Hosted API / Multi-Provider | `demo` / `available` | No | API Terms / Apache-2.0 | Falls back to local `SpectralStatisticsBaseline` if API key or network is absent. |
| **RemoteSensingVLMAdapter** | RS Visual Question Answering | HuggingFace Pretrained / LoRA | `unavailable` (checkpoint pluggable) | Yes | Apache-2.0 / MIT | Falls back to `GenericVLMOrchestrator` or `SpectralStatisticsBaseline`. |
| **ClassicalSpectralCaptionerBaseline** | Scene Captioning | Local Procedural Baseline | `baseline` | No | Apache-2.0 | Active in-memory baseline; computes physical channel dynamic range and albedo dispersion. |
| **ClassicalBaselineGrounder** | Visual Grounding | Connected Component Contour Baseline | `baseline` | No | Apache-2.0 | Active in-memory baseline; extracts bounding boxes via dynamic spectral thresholding. |
| **PixelDifferenceChangeBaseline** | Bi-Temporal Change Detection | Spectral Difference Magnitude Baseline | `baseline` | No | Apache-2.0 | Active in-memory baseline; computes pixel change ratio, change mask, and cluster bounding boxes. |
| **SiameseRSChangeDetector** | Deep Bi-Temporal Change Detection | Siamese Feature Difference Network | `unavailable` (checkpoint pluggable) | Yes | MIT / Apache-2.0 | Falls back to `PixelDifferenceChangeBaseline`. |
| **EvidenceGroundedChangeVQA** | Bi-Temporal Change Explanation | Structured Evidence Synthesizer | `baseline` | No | Apache-2.0 | Active in-memory baseline; consumes difference evidence without fabricating semantic classes. |
| **OpticalSARVisualizationBaseline** | Optical-SAR Visualization | Linear 50/50 Dual-Modality Blend | `baseline` | No | Apache-2.0 | Active in-memory baseline; empirical backscatter slicing. |
| **OpticalSARJointAnalysisProvider** | Optical-SAR Multimodal Analysis | Cross-Modal Calibrated Joint Analyzer | `baseline` (empirical physics) | Yes | Apache-2.0 | Generates separate Optical, SAR (dB), and cross-modal false color composite with joint interpretation. |

---

## 2. Operational Categories

### A. CURRENTLY OPERATIONAL
The following models/adapters are fully functional, load without errors, and are tested under automated unit tests:
1. `ClassicalSpectralCaptionerBaseline`
2. `ClassicalBaselineGrounder`
3. `PixelDifferenceChangeBaseline`
4. `EvidenceGroundedChangeVQA`
5. `OpticalSARVisualizationBaseline`
6. `OpticalSARJointAnalysisProvider`
7. `SpectralStatisticsBaseline`
8. `IntentClassifier` (Agent Router)

### B. DEMO / HOSTED FOUNDATION
1. `GenericVLMOrchestrator` (utilizes Google Gemini API when `GEMINI_API_KEY` is provided; explicitly labeled as generic vision-language synthesis, never claimed as fine-tuned on remote sensing imagery).

### C. PRETRAINED / PLUGGABLE ADAPTERS
The architecture provides verified adapters ready to receive PyTorch model weights when mounted:
1. `RemoteSensingVLMAdapter` (HuggingFace vision-language interface for RSVQA-adapted checkpoints).
2. `SiameseRSChangeDetector` (Siamese difference architecture for BIT-CD / ChangeFormer weights).
3. `OpticalSARNeuralFusion` (Feature-level dual-encoder network).

### D. DEFERRED CAPABILITIES
1. **Full ISRO/SAC Official Evaluation:** Awaiting delivery of authorized ground-truth evaluation packages from ISRO/SAC.
2. **Multi-Terabyte Earth Context Vector Store:** Architecture POC implemented in `backend/app/rag/`; full planetary ingestion deferred.
