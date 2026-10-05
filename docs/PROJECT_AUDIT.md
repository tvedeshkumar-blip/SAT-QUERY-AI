# Project Audit: Satellite Photo Explorer

**Date:** September 26, 2026  
**Repository:** `Miruthula426/satellite-photo-explorer`  
**Purpose:** Initial audit of current codebase before refactoring into **SatQuery AI** for ISRO Problem Statement 26167.

---

## 1. Executive Summary

The existing repository is a single-tier Node.js/Express + React application built with TypeScript, Vite, and TailwindCSS (v4). It integrates Google Gemini via `@google/genai` to analyze planetary and astronomical satellite photos. 

While it provides basic UI components for uploading images, displaying sample presets, and rendering Q&A definitions, it is **not** currently aligned with ISRO Problem Statement 26167. Specifically:
- It relies solely on a single generic LLM (Gemini) for text generation.
- It lacks geospatial metadata processing (GeoTIFF, CRS, affine transforms, band data).
- It lacks specialist remote-sensing vision-language models, change detection engines, and SAR handling.
- It lacks an agentic workflow, execution trace, confidence calibration, evidence viewer, training pipelines, and benchmark evaluation frameworks.

---

## 2. Inventory of Existing Source Files

### Frontend & Server Files
| File Path | Description | Reusability / Migration Path |
| :--- | :--- | :--- |
| `package.json` | Node dependencies (`react`, `express`, `@google/genai`, `lucide-react`, `motion`, `tailwindcss`) | Move to `frontend/package.json`; trim Node server deps. |
| `server.ts` | Express server bridging Gemini API (`/api/analyze-satellite`, `/api/ask-question`) | Replace with Python FastAPI backend (`backend/app/main.py`). Retain Gemini helper logic in backend service for LLM synthesis. |
| `App.tsx` | Main application shell, state management, modal popups, and tab navigation | Refactor into `frontend/src/App.tsx` and modular workspace pages. |
| `Header.tsx` | App header bar | Refactor into dark space-inspired `SatQueryNav` header. |
| `ImageUploader.tsx` | Drag-and-drop file upload component | Refactor into `frontend/src/components/ImageUploader.tsx` with multi-modal (Optical, SAR, Bi-temporal) & GeoTIFF support. |
| `PhotoViewer.tsx` | Image preview panel with pan/zoom features | Enhance into multi-layer Evidence Viewer (Original, Processed, Overlay, Mask, BBoxes, Change Map). |
| `QuestionPanel.tsx` | Interactive text query box and follow-up prompts | Expand into SatQuery Agent Query Console with task indicators. |
| `DefinitionCard.tsx` | Display card for AI analysis output | Refactor into structured Analysis Result Card with Confidence & Evidence badges. |
| `RecentScansBar.tsx` | History bar showing recent scans | Refactor into workspace scan history session bar. |
| `presetPhotos.ts` | Sample images (Mars, Jupiter, Moon, Europa, Saturn, Earth Hurricane) | Replace planetary presets with Earth Observation Remote Sensing presets (Single, Bi-Temporal, Optical+SAR GeoTIFFs/PNGs). |
| `imageHelper.ts` | File to Base64 utility functions | Move to `frontend/src/utils/imageHelper.ts`. |
| `types.ts` | TypeScript interfaces for preset photos and Gemini JSON schemas | Move to `frontend/src/types/index.ts` and expand with SatQuery backend API schemas. |
| `vite.config.ts` | Vite build configuration | Move to `frontend/vite.config.ts`. |

---

## 3. Key Findings & Architectural Needs

1. **Architecture Disconnect:** Current setup is `Client -> Node/Express -> Gemini API`. Target architecture requires `Client -> FastAPI -> Agent Controller -> Model Registry (VQA, Captioning, Grounding, Change Detection, Change VQA, Optical-SAR) -> Evidence Engine -> Response Generator`.
2. **Domain Focus:** Current prompts and preset imagery focus on planetary science (Mars craters, Jupiter red spot, Saturn rings). Target focus must be Earth Remote Sensing (Agriculture, Urban, Water, Forest, Infrastructure, Land Cover, Disaster, SAR, Optical, Multispectral).
3. **Geospatial Processing:** Zero support for GeoTIFF (.tif/.tiff), multiband rasters, CRS projection systems, or spatial alignment. Rasterio and PyTorch pipeline required in Python backend.
4. **Agent & Trace:** No task routing or observable execution trace currently exists.
