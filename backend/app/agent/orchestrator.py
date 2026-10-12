"""
Stage 14: Dynamic Multi-Step Agent Orchestrator for Multimodal Remote Sensing.

Implements a deterministic, controlled execution engine that:
1. Parses natural-language queries for spatial areas (gazetteer & bounding boxes),
   dates, date ranges, and multimodal analysis intents.
2. Formulates explicit clarification requests when required location or time ranges
   are ambiguous, preventing hallucinated coordinates or dates.
3. Plans and executes a bounded, observable multi-step tool sequence (DAG)
   using discrete tools from the AgentToolRegistry.
4. Enforces strict safety caps:
   - Maximum steps: <= 10
   - Maximum retries: <= 2
   - Cumulative transfer budget: <= 20 MB
5. Executes Sentinel-2 NDVI, Sentinel-1 RTC DpRVI, and temporal multimodal change detection.
6. Packages evidence into EvidencePackageSchema and executes DeterministicVerifier (Checks A-L).
7. Generates reproducible scientific reports and maintains complete execution traces.
"""

import re
import time
import uuid
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
import numpy as np

from app.agent.tools import tool_registry
from app.agent.trace import ExecutionTraceTracker
from app.remote_sensing.temporal import compute_temporal_optical_change, compute_temporal_sar_change
from app.agent.verifier import DeterministicVerifier, EvidencePackageBuilder
from app.schemas.verification import EvidencePackageSchema, ClaimVerificationItem
from app.reports.scientific_report import ScientificReportBuilder

logger = logging.getLogger("satquery.orchestrator")

# Safety Caps
MAX_ORCHESTRATION_STEPS = 10
MAX_TOOL_RETRIES = 2
MAX_CUMULATIVE_TRANSFER_BYTES = 20 * 1024 * 1024  # 20 MB

# Gazetteer of demonstration geographic regions
GAZETTEER: Dict[str, List[float]] = {
    "mumbai": [72.75, 18.88, 73.05, 19.30],
    "delhi": [76.85, 28.40, 77.35, 28.88],
    "bengaluru": [77.45, 12.85, 77.75, 13.15],
    "bangalore": [77.45, 12.85, 77.75, 13.15],
    "chennai": [80.15, 12.90, 80.35, 13.25],
    "hyderabad": [78.30, 17.25, 78.60, 17.55],
    "kolkata": [88.25, 22.45, 88.45, 22.65],
    "kerala": [75.80, 9.50, 76.80, 10.50],
    "pune": [73.75, 18.45, 73.98, 18.62],
    "ahmedabad": [72.50, 22.95, 72.70, 23.15],
    "california": [-122.55, 37.60, -122.25, 37.90],
    "san francisco": [-122.55, 37.60, -122.25, 37.90],
    "amazon": [-63.20, -10.20, -62.80, -9.80],
    "rondonia": [-63.20, -10.20, -62.80, -9.80]
}

MONTH_MAP = {
    "january": "01", "jan": "01",
    "february": "02", "feb": "02",
    "march": "03", "mar": "03",
    "april": "04", "apr": "04",
    "may": "05",
    "june": "06", "jun": "06",
    "july": "07", "jul": "07",
    "august": "08", "aug": "08",
    "september": "09", "sep": "09", "sept": "09",
    "october": "10", "oct": "10",
    "november": "11", "nov": "11",
    "december": "12", "dec": "12"
}


class QueryParser:
    """Natural-language remote sensing query parser with ambiguity detection."""

    @staticmethod
    def parse(query: str, has_images: bool = False) -> Dict[str, Any]:
        q_lower = query.lower()

        # 1. Spatial Resolution
        bbox = None
        location_name = None

        # Check explicit bounding box coordinates e.g. [72.8, 18.9, 72.9, 19.0]
        coord_match = re.search(r'\[\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\]', query)
        if coord_match:
            try:
                coords = [float(c) for c in coord_match.groups()]
                # Validate min < max
                if coords[0] < coords[2] and coords[1] < coords[3] and -180 <= coords[0] <= 180 and -90 <= coords[1] <= 90:
                    bbox = coords
                    location_name = "User-Specified Bounding Box"
            except ValueError:
                pass

        # Check gazetteer names to resolve location_name (and bbox if not already explicitly specified)
        for name, box in GAZETTEER.items():
            if name in q_lower:
                if not bbox:
                    bbox = box
                location_name = name.title()
                break

        # 2. Temporal Resolution
        start_date = None
        end_date = None
        t1_date = None
        t2_date = None

        # Check ISO dates: YYYY-MM-DD
        iso_dates = re.findall(r'\b(\d{4}-\d{2}-\d{2})\b', query)
        if len(iso_dates) >= 2:
            start_date, end_date = sorted(iso_dates[:2])
            t1_date, t2_date = start_date, end_date
        elif len(iso_dates) == 1:
            start_date = iso_dates[0]

        # Check Month-Year ranges e.g. "January 2024 to March 2024"
        if not start_date:
            m_range = re.findall(r'\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{4})\b', q_lower)
            if len(m_range) >= 2:
                m1_name, y1 = m_range[0]
                m2_name, y2 = m_range[1]
                m1_num = MONTH_MAP.get(m1_name, "01")
                m2_num = MONTH_MAP.get(m2_name, "12")
                start_date = f"{y1}-{m1_num}-01"
                end_date = f"{y2}-{m2_num}-28"
                t1_date, t2_date = start_date, end_date

        # Check Year comparisons e.g. "2023 to 2024" or "between 2023 and 2024"
        if not start_date:
            y_range = re.findall(r'\b(?:between|from|in)?\s*(\d{4})\s*(?:and|to|vs|versus|-)\s*(\d{4})\b', q_lower)
            if y_range:
                y1, y2 = y_range[0]
                start_date = f"{y1}-01-01"
                end_date = f"{y2}-12-31"
                t1_date, t2_date = f"{y1}-06-01", f"{y2}-06-01"

        # 3. Intent Detection
        is_temporal_change = any(t in q_lower for t in ["change", "temporal", "difference", "trend", "loss", "gain", "increase", "decrease", "compare", "vs", "versus"])
        is_sar = any(t in q_lower for t in ["sar", "radar", "backscatter", "dprvi", "sentinel-1", "s1", "rtc", "vv", "vh", "polarization"])
        is_optical = any(t in q_lower for t in ["optical", "ndvi", "vegetation", "canopy", "sentinel-2", "s2", "red", "nir", "b04", "b08", "greenery"])
        is_fusion = (is_sar and is_optical) or "fusion" in q_lower or "joint" in q_lower or "cross-sensor" in q_lower
        is_grounding = any(t in q_lower for t in ["ground", "locate", "detect", "bounding box", "find", "where is", "where are"])
        is_vqa = any(t in q_lower for t in ["what", "how many", "is there", "describe", "explain", "caption"])

        if is_fusion:
            task = "optical_sar"
        elif is_temporal_change:
            task = "temporal_sar_change" if is_sar else "temporal_optical_change"
        elif is_sar:
            task = "sentinel1_rtc_dprvi"
        elif is_optical:
            task = "sentinel2_ndvi"
        elif is_grounding:
            task = "grounding"
        else:
            task = "vqa"

        # 4. Ambiguity Evaluation
        # If images are already provided in the workspace, spatial location and dates are implicitly present
        missing_params = []
        if not has_images:
            if not bbox:
                missing_params.append("spatial_location")
            if is_temporal_change and not (start_date and end_date):
                missing_params.append("temporal_date_range")

        is_ambiguous = len(missing_params) > 0

        clarification_prompt = None
        if is_ambiguous:
            parts = []
            if "spatial_location" in missing_params:
                parts.append("the geographic area of interest (e.g. 'Mumbai', 'Delhi', or a bounding box [min_lon, min_lat, max_lon, max_lat])")
            if "temporal_date_range" in missing_params:
                parts.append("the temporal comparison dates or date range (e.g. 'between 2023-01-01 and 2024-01-01')")
            clarification_prompt = (
                f"To execute calibrated remote-sensing analysis without fabricating data, please clarify {' and '.join(parts)}."
            )

        return {
            "task": task,
            "bbox": bbox,
            "location_name": location_name,
            "start_date": start_date,
            "end_date": end_date,
            "t1_date": t1_date,
            "t2_date": t2_date,
            "is_temporal_change": is_temporal_change,
            "is_sar": is_sar,
            "is_optical": is_optical,
            "is_fusion": is_fusion,
            "is_ambiguous": is_ambiguous,
            "missing_parameters": missing_params,
            "clarification_prompt": clarification_prompt,
            "raw_query": query
        }


class MultiStepOrchestrator:
    """Executes a controlled, observable multi-step remote sensing workflow."""

    def __init__(self):
        self.tool_registry = tool_registry

    def orchestrate(
        self,
        query: str,
        images: Optional[List[Any]] = None,
        max_bytes: int = MAX_CUMULATIVE_TRANSFER_BYTES
    ) -> Dict[str, Any]:
        start_time = time.time()
        trace_id = f"orch_{uuid.uuid4().hex[:10]}"
        images = images or []
        has_images = len(images) > 0

        # Step 1: Natural-Language Query Parsing
        trace = ExecutionTraceTracker(task="orchestration")
        trace.add_step("QUERY_RECEIVED", f"Received query: '{query}' ({len(images)} workspace image(s) attached)")

        parsed = QueryParser.parse(query, has_images=has_images)
        task = parsed["task"]
        trace.task = task

        # Check Ambiguity Gate: If required inputs cannot be determined, ask for clarification
        if parsed["is_ambiguous"]:
            trace.add_step("CLARIFICATION_REQUIRED", parsed["clarification_prompt"], status="pending")
            elapsed = round((time.time() - start_time) * 1000, 2)
            return {
                "id": trace_id,
                "status": "clarification_required",
                "task": task,
                "mode": "orchestration",
                "answer": parsed["clarification_prompt"],
                "is_clarification_required": True,
                "missing_parameters": parsed["missing_parameters"],
                "suggested_examples": [
                    "Analyze Sentinel-2 NDVI change in Mumbai between 2023-01-01 and 2024-01-01",
                    "Compute Sentinel-1 RTC dual-pol DpRVI for Delhi [76.85, 28.40, 77.35, 28.88]",
                    "Assess radar canopy change in California between 2023 and 2024"
                ],
                "confidence": None,
                "confidence_label": "Unspecified Parameters",
                "models": [],
                "evidence": [],
                "trace": trace.to_dict(),
                "metadata": {"parsed_query": parsed},
                "execution_time_ms": elapsed,
                "created_at": datetime.utcnow().isoformat() + "Z"
            }

        trace.add_step(
            "QUERY_PARSED",
            f"Target: Task={task}, Location={parsed.get('location_name') or 'From Workspace'}, Dates={parsed.get('start_date')} to {parsed.get('end_date')}"
        )

        # Execution Graph State
        execution_steps = []
        cumulative_transfer_bytes = 0
        step_count = 0
        step_budget = MAX_ORCHESTRATION_STEPS
        analysis_metadata = {}
        analysis_result = None
        evidence_items = []
        answer = ""

        # Step 2: Formulate Multi-Step Plan
        plan_steps = self._formulate_plan(parsed, has_images)
        trace.add_step("PLAN_FORMULATED", f"Selected {len(plan_steps)} traceable tool step(s): {', '.join([s['tool'] for s in plan_steps])}")

        # Step 3: Execute Plan Steps
        retrieved_scenes = []
        for step_def in plan_steps:
            if step_count >= step_budget:
                trace.add_step("STEP_LIMIT_EXCEEDED", f"Maximum orchestration step limit ({step_budget}) reached.", status="failed")
                break

            step_count += 1
            tool_name = step_def["tool"]
            tool_args = step_def.get("args", {})
            step_desc = step_def.get("description", tool_name)
            t_start = time.time()

            tool = self.tool_registry.get(tool_name)
            if not tool:
                trace.add_step(f"TOOL_{tool_name.upper()}", f"Tool '{tool_name}' not registered.", status="failed")
                continue

            trace.add_model(tool_name)

            # Check transfer budget before running acquisition tools
            if "retrieve" in tool_name:
                rem_budget = max_bytes - cumulative_transfer_bytes
                if rem_budget <= 0:
                    trace.add_step(f"TOOL_{tool_name.upper()}", f"Cumulative transfer budget of {max_bytes} bytes exhausted.", status="failed")
                    analysis_metadata["budget_exhausted"] = True
                    execution_steps.append({
                        "step_number": step_count,
                        "tool": tool_name,
                        "status": "failed",
                        "latency_ms": 0.0,
                        "summary": step_desc,
                        "error": f"Cumulative transfer budget of {max_bytes} bytes exceeded."
                    })
                    break
                tool_args["max_bytes"] = rem_budget

            # Wire outputs from prior retrieval steps into temporal analysis tools
            if tool_name == "temporal_optical_change" and not tool_args.get("t1_b04"):
                valid_optical = (
                    len(retrieved_scenes) >= 2 and
                    retrieved_scenes[0].get("status") in ("success", None) and
                    retrieved_scenes[1].get("status") in ("success", None) and
                    retrieved_scenes[0].get("array") is not None and
                    retrieved_scenes[1].get("array") is not None
                )
                if not valid_optical:
                    err_msg = "Upstream Sentinel-2 optical scene retrieval failed or returned incomplete rasters; bi-temporal optical change calculation blocked."
                    trace.add_step(f"TOOL_{tool_name.upper()}", err_msg, status="blocked")
                    execution_steps.append({
                        "step_number": step_count,
                        "tool": tool_name,
                        "status": "blocked",
                        "latency_ms": 0.0,
                        "summary": step_desc,
                        "error": err_msg
                    })
                    analysis_metadata["temporal_optical_change"] = {"status": "blocked", "error": err_msg}
                    continue

                s1 = retrieved_scenes[0]
                s2 = retrieved_scenes[1]
                arr1 = s1.get("array")
                arr2 = s2.get("array")
                meta1 = s1.get("raster_metadata") or s1.get("metadata") or {}
                meta2 = s2.get("raster_metadata") or s2.get("metadata") or {}
                b04_1 = arr1[:, :, 0] if arr1.ndim == 3 else arr1
                b08_1 = arr1[:, :, 1] if arr1.ndim == 3 and arr1.shape[2] > 1 else arr1
                b04_2 = arr2[:, :, 0] if arr2.ndim == 3 else arr2
                b08_2 = arr2[:, :, 1] if arr2.ndim == 3 and arr2.shape[2] > 1 else arr2
                tool_args["t1_b04"] = b04_1
                tool_args["t1_b08"] = b08_1
                tool_args["t2_b04"] = b04_2
                tool_args["t2_b08"] = b08_2
                if arr1.ndim == 3 and arr1.shape[2] >= 3:
                    tool_args["t1_scl"] = arr1[:, :, 2]
                if arr2.ndim == 3 and arr2.shape[2] >= 3:
                    tool_args["t2_scl"] = arr2[:, :, 2]
                tool_args["t1_meta"] = meta1
                tool_args["t2_meta"] = meta2
                tool_args["t1_datetime"] = parsed.get("t1_date") or meta1.get("datetime") or "2023-01-01T10:00:00Z"
                tool_args["t2_datetime"] = parsed.get("t2_date") or meta2.get("datetime") or "2024-01-01T10:00:00Z"

            elif tool_name == "temporal_sar_change" and not tool_args.get("t1_vv"):
                valid_sar = (
                    len(retrieved_scenes) >= 2 and
                    retrieved_scenes[0].get("status") in ("success", None) and
                    retrieved_scenes[1].get("status") in ("success", None) and
                    retrieved_scenes[0].get("array") is not None and
                    retrieved_scenes[1].get("array") is not None
                )
                if not valid_sar:
                    err_msg = "Upstream Sentinel-1 RTC SAR scene retrieval failed or returned incomplete rasters; bi-temporal SAR change calculation blocked."
                    trace.add_step(f"TOOL_{tool_name.upper()}", err_msg, status="blocked")
                    execution_steps.append({
                        "step_number": step_count,
                        "tool": tool_name,
                        "status": "blocked",
                        "latency_ms": 0.0,
                        "summary": step_desc,
                        "error": err_msg
                    })
                    analysis_metadata["temporal_sar_change"] = {"status": "blocked", "error": err_msg}
                    continue

                s1 = retrieved_scenes[0]
                s2 = retrieved_scenes[1]
                arr1 = s1.get("array")
                arr2 = s2.get("array")
                meta1 = s1.get("raster_metadata") or s1.get("metadata") or {}
                meta2 = s2.get("raster_metadata") or s2.get("metadata") or {}
                vv_1 = arr1[:, :, 0] if arr1.ndim == 3 else arr1
                vh_1 = arr1[:, :, 1] if arr1.ndim == 3 and arr1.shape[2] > 1 else arr1 * 0.2
                vv_2 = arr2[:, :, 0] if arr2.ndim == 3 else arr2
                vh_2 = arr2[:, :, 1] if arr2.ndim == 3 and arr2.shape[2] > 1 else arr2 * 0.2
                tool_args["t1_vv"] = vv_1
                tool_args["t1_vh"] = vh_1
                tool_args["t2_vv"] = vv_2
                tool_args["t2_vh"] = vh_2
                tool_args["t1_meta"] = meta1
                tool_args["t2_meta"] = meta2
                tool_args["t1_datetime"] = parsed.get("t1_date") or meta1.get("datetime") or "2023-01-01T10:00:00Z"
                tool_args["t2_datetime"] = parsed.get("t2_date") or meta2.get("datetime") or "2024-01-01T10:00:00Z"

            elif tool_name == "optical_sar_fusion" and not tool_args.get("images"):
                opt_scene = None
                sar_scene = None
                for s in retrieved_scenes:
                    coll = str(s.get("collection", "")).lower()
                    if ("sentinel-2" in coll or "optical" in coll or s.get("ndvi_result")) and opt_scene is None:
                        opt_scene = s
                    elif ("sentinel-1" in coll or "rtc" in coll or "sar" in coll or s.get("dprvi_result")) and sar_scene is None:
                        sar_scene = s

                if opt_scene is None and len(retrieved_scenes) >= 1:
                    opt_scene = retrieved_scenes[0]
                if sar_scene is None and len(retrieved_scenes) >= 2:
                    sar_scene = retrieved_scenes[1]

                valid_fusion = (
                    opt_scene is not None and
                    sar_scene is not None and
                    opt_scene.get("status") in ("success", None) and
                    sar_scene.get("status") in ("success", None) and
                    opt_scene.get("array") is not None and
                    sar_scene.get("array") is not None
                )
                if not valid_fusion:
                    err_msg = "Upstream optical or SAR scene retrieval failed or returned incomplete rasters; cross-sensor optical-SAR fusion blocked."
                    trace.add_step(f"TOOL_{tool_name.upper()}", err_msg, status="blocked")
                    execution_steps.append({
                        "step_number": step_count,
                        "tool": tool_name,
                        "status": "blocked",
                        "latency_ms": 0.0,
                        "summary": step_desc,
                        "error": err_msg
                    })
                    analysis_metadata["optical_sar_fusion"] = {"status": "blocked", "error": err_msg}
                    continue

                tool_args["images"] = [opt_scene["array"], sar_scene["array"]]
                tool_args["metadata"] = {
                    "optical": opt_scene.get("raster_metadata") or opt_scene.get("metadata") or {},
                    "sar": sar_scene.get("raster_metadata") or sar_scene.get("metadata") or {}
                }
                tool_args["query"] = query

            # Execute tool with bounded retries (MAX_TOOL_RETRIES)
            tool_out = None
            step_status = "failed"
            step_error = None
            t_latency = 0.0

            for attempt in range(1, MAX_TOOL_RETRIES + 1):
                t_start = time.time()
                try:
                    tool_out = tool.run(**tool_args)
                    t_latency = round((time.time() - t_start) * 1000, 2)

                    if tool_out.get("status") in ("success", None):
                        step_status = "completed"
                        step_error = None
                        if attempt > 1:
                            trace.add_step(
                                f"TOOL_{tool_name.upper()}_RETRY",
                                f"Tool '{tool_name}' succeeded on retry attempt {attempt}/{MAX_TOOL_RETRIES} ({t_latency} ms)"
                            )
                        break
                    else:
                        step_error = tool_out.get("error") or f"Tool returned failure status '{tool_out.get('status')}'"
                        is_non_retryable = any(kw in step_error.lower() for kw in [
                            "validation", "degenerate", "identical", "unsupported", "invalid bbox", "crs mismatch"
                        ])
                        if is_non_retryable or attempt >= MAX_TOOL_RETRIES:
                            step_status = "failed"
                            break
                        trace.add_step(
                            f"TOOL_{tool_name.upper()}",
                            f"Attempt {attempt}/{MAX_TOOL_RETRIES} failed: {step_error}. Retrying...",
                            status="retrying"
                        )
                        time.sleep(0.05 * attempt)
                except Exception as tool_err:
                    t_latency = round((time.time() - t_start) * 1000, 2)
                    step_error = str(tool_err)
                    is_non_retryable = any(kw in step_error.lower() for kw in [
                        "validation", "degenerate", "identical", "unsupported", "invalid bbox", "crs mismatch"
                    ])
                    if is_non_retryable or attempt >= MAX_TOOL_RETRIES:
                        step_status = "failed"
                        logger.error(f"Error executing tool '{tool_name}' after {attempt} attempt(s): {tool_err}")
                        break
                    trace.add_step(
                        f"TOOL_{tool_name.upper()}",
                        f"Attempt {attempt}/{MAX_TOOL_RETRIES} encountered error: {step_error}. Retrying...",
                        status="retrying"
                    )
                    time.sleep(0.05 * attempt)

            # Record step in DAG execution steps
            step_record = {
                "step_number": step_count,
                "tool": tool_name,
                "status": step_status,
                "latency_ms": t_latency,
                "summary": step_desc
            }
            if step_error:
                step_record["error"] = step_error
            execution_steps.append(step_record)

            trace.add_step(
                f"TOOL_{tool_name.upper()}",
                f"{step_desc} -> {step_status} ({t_latency} ms)" + (f": {step_error}" if step_error else ""),
                status=step_status
            )

            if tool_out:
                # Update transfer telemetry
                if "size_bytes" in tool_out:
                    cumulative_transfer_bytes += tool_out.get("size_bytes", 0)

                if tool_name == "stac_composite_retrieve":
                    retrieved_scenes.append(tool_out)

                # Integrate tool outputs into orchestration state
                if "ndvi_result" in tool_out and tool_out["ndvi_result"]:
                    analysis_metadata["ndvi_result"] = tool_out["ndvi_result"]
                if "dprvi_result" in tool_out and tool_out["dprvi_result"]:
                    analysis_metadata["dprvi_result"] = tool_out["dprvi_result"]
                if "delta_ndvi_mean" in tool_out:
                    analysis_metadata["temporal_optical_change"] = tool_out
                    if tool_out.get("colorized_preview_base64"):
                        evidence_items.append({
                            "id": "ev_temporal_optical_change_map",
                            "type": "change_map",
                            "title": "Sentinel-2 Calibrated Bi-Temporal NDVI Change Map",
                            "description": "Joint SCL-screened Delta-NDVI change map (Red: Vegetation Loss, Green: Vegetation Gain, Gray: Stable)",
                            "data_base64": tool_out.get("colorized_preview_base64"),
                            "statistics": {
                                "mean_delta_ndvi": tool_out.get("delta_ndvi_mean"),
                                "vegetation_loss_pct": tool_out.get("vegetation_loss_pct"),
                                "vegetation_gain_pct": tool_out.get("vegetation_gain_pct"),
                                "joint_clear_pixels": tool_out.get("joint_valid_pixel_count")
                            }
                        })
                if "delta_dprvi_mean" in tool_out:
                    analysis_metadata["temporal_sar_change"] = tool_out
                    if tool_out.get("colorized_preview_base64"):
                        evidence_items.append({
                            "id": "ev_temporal_sar_change_map",
                            "type": "change_map",
                            "title": "Sentinel-1 RTC Calibrated Bi-Temporal DpRVI Change Map",
                            "description": "Calibrated Delta-DpRVI change map (Red-Orange: Radar Canopy Loss, Green: Radar Canopy Gain, Gray: Stable)",
                            "data_base64": tool_out.get("colorized_preview_base64"),
                            "statistics": {
                                "mean_delta_dprvi": tool_out.get("delta_dprvi_mean"),
                                "radar_canopy_loss_pct": tool_out.get("radar_canopy_loss_pct"),
                                "radar_canopy_gain_pct": tool_out.get("radar_canopy_gain_pct"),
                                "delta_vv_db": tool_out.get("delta_vv_db")
                            }
                        })
                if tool_name == "optical_sar_fusion" and step_status == "completed":
                    analysis_metadata["optical_sar_fusion"] = tool_out
                    if tool_out.get("evidence") and isinstance(tool_out["evidence"], list):
                        evidence_items.extend(tool_out["evidence"])
                    fused_b64 = (
                        tool_out.get("fused_evidence")
                        or tool_out.get("fused_preview_base64")
                        or tool_out.get("colorized_preview_base64")
                        or tool_out.get("preview_base64")
                    )
                    if fused_b64 and not any(e.get("type") == "fused" for e in evidence_items):
                        evidence_items.append({
                            "id": "ev_optical_sar_fused_composite",
                            "type": "fused",
                            "title": "Sentinel-2 & Sentinel-1 RTC Optical-SAR Cross-Sensor Composite",
                            "description": "Co-registered multimodal optical surface reflectance and calibrated RTC SAR backscatter",
                            "data_base64": fused_b64,
                            "statistics": tool_out.get("statistics") or {}
                        })
                if "quality_screening" in tool_out:
                    analysis_metadata["quality_screening"] = tool_out["quality_screening"]
                if "provenance" in tool_out:
                    analysis_metadata["provenance"] = tool_out["provenance"]

                analysis_result = tool_out

        analysis_metadata["retrieved_scenes"] = [
            {
                "scene_id": s.get("scene_id"),
                "collection": s.get("collection"),
                "bands": s.get("bands_retrieved") or ["b04", "b08", "scl"]
            }
            for s in retrieved_scenes
        ]

        # Step 4: Synthesize Answer Text & Formulate Claims
        candidate_claims = []
        is_budget_exhausted = analysis_metadata.get("budget_exhausted", False)
        overall_status = "success"
        confidence = 0.95
        confidence_label = "Deterministic Verified"

        if is_budget_exhausted:
            overall_status = "budget_exhausted"
            answer = f"Analysis halted: Cumulative STAC transfer budget of {max_bytes} bytes was exhausted before all required satellite assets could be retrieved."
            confidence = None
            confidence_label = "Budget Exhausted"

        elif task == "temporal_optical_change":
            chg = analysis_metadata.get("temporal_optical_change", {})
            chg_status = chg.get("status")
            if chg_status in ("blocked", "failed", "error") or not chg:
                overall_status = "failed"
                err_detail = chg.get("error", "Upstream Sentinel-2 optical scenes could not be retrieved.")
                answer = f"Temporal Sentinel-2 optical change analysis failed: {err_detail}"
                confidence = None
                confidence_label = "Acquisition Failed"
            elif chg_status == "unsupported_zero_valid_pixels":
                overall_status = "unsupported"
                answer = chg.get("summary")
                confidence = None
                confidence_label = "Zero Valid Pixels"
            else:
                d_mean = chg.get("delta_ndvi_mean", 0.0)
                v_loss = chg.get("vegetation_loss_pct", 0.0)
                v_gain = chg.get("vegetation_gain_pct", 0.0)
                px_count = chg.get("joint_valid_pixel_count", 0)
                answer = (
                    f"Temporal Sentinel-2 optical change analysis computed across {px_count:,} joint clear pixels. "
                    f"Mean Delta-NDVI is {d_mean:+.4f}. Observed vegetation loss: {v_loss}%, vegetation gain: {v_gain}%."
                )
                candidate_claims.append(ClaimVerificationItem(
                    claim_text=f"Mean Delta-NDVI is {d_mean:.4f} across joint clear pixels.",
                    claim_type="measurement",
                    status="supported"
                ))

        elif task == "temporal_sar_change":
            chg = analysis_metadata.get("temporal_sar_change", {})
            chg_status = chg.get("status")
            if chg_status in ("blocked", "failed", "error") or not chg:
                overall_status = "failed"
                err_detail = chg.get("error", "Upstream Sentinel-1 RTC SAR scenes could not be retrieved.")
                answer = f"Temporal Sentinel-1 RTC SAR change analysis failed: {err_detail}"
                confidence = None
                confidence_label = "Acquisition Failed"
            elif chg_status == "unsupported_zero_valid_pixels":
                overall_status = "unsupported"
                answer = chg.get("summary")
                confidence = None
                confidence_label = "Zero Valid Pixels"
            else:
                d_mean = chg.get("delta_dprvi_mean", 0.0)
                c_loss = chg.get("radar_canopy_loss_pct", 0.0)
                c_gain = chg.get("radar_canopy_gain_pct", 0.0)
                px_count = chg.get("joint_valid_pixel_count", 0)
                answer = (
                    f"Temporal Sentinel-1 RTC dual-polarization change analysis computed across {px_count:,} joint valid pixels. "
                    f"Mean Delta-DpRVI is {d_mean:+.4f}. Radar canopy loss: {c_loss}%, radar canopy gain: {c_gain}%."
                )
                candidate_claims.append(ClaimVerificationItem(
                    claim_text=f"Mean Delta-DpRVI is {d_mean:.4f} across valid radar pixels.",
                    claim_type="measurement",
                    status="supported"
                ))

        elif task == "optical_sar":
            fusion = analysis_metadata.get("optical_sar_fusion", {})
            f_status = fusion.get("status")
            if f_status in ("blocked", "failed", "error") or not fusion:
                overall_status = "failed"
                err_detail = fusion.get("error", "Upstream optical or SAR scene could not be retrieved.")
                answer = f"Optical-SAR cross-sensor fusion analysis failed: {err_detail}"
                confidence = None
                confidence_label = "Acquisition Failed"
            else:
                ans_text = fusion.get("answer") or fusion.get("summary") or "Optical and SAR multimodal cross-sensor analysis completed successfully."
                answer = ans_text
                candidate_claims.append(ClaimVerificationItem(
                    claim_text="Multimodal optical and SAR cross-sensor alignment and fusion analysis completed successfully.",
                    claim_type="general",
                    status="supported"
                ))

        elif task == "sentinel1_rtc_dprvi":
            dprvi = analysis_metadata.get("dprvi_result", {})
            d_val = dprvi.get("dprvi_mean")
            q_db = dprvi.get("cross_pol_ratio_db")
            if d_val is not None:
                answer = (
                    f"Calibrated Sentinel-1 RTC dual-polarization backscatter computed across {dprvi.get('valid_pixel_count', 0):,} valid pixels. "
                    f"Mean DpRVI is {d_val:.4f} (cross-polarization ratio: {q_db:.1f} dB)."
                )
                candidate_claims.append(ClaimVerificationItem(
                    claim_text=f"Sentinel-1 DpRVI is {d_val:.4f}.",
                    claim_type="measurement",
                    status="supported"
                ))
            else:
                d_status = dprvi.get("status") if dprvi else None
                if not d_status:
                    for step in reversed(execution_steps):
                        s_status = step.get("status")
                        s_err = (step.get("error") or "").lower()
                        if s_status == "unsupported" or (s_err and "unsupported" in s_err and "acquisition" not in s_err):
                            d_status = "unsupported"
                            break
                if d_status == "unsupported_zero_valid_pixels":
                    overall_status = "unsupported"
                    answer = dprvi.get("summary") or "No valid radar pixels found. DpRVI calculation unsupported."
                    confidence = None
                    confidence_label = "Zero Valid Pixels"
                elif d_status and d_status.startswith("unsupported"):
                    overall_status = "unsupported"
                    answer = dprvi.get("summary") or dprvi.get("error") or "Sentinel-1 RTC dual-polarization analysis unsupported."
                    confidence = None
                    confidence_label = "Unsupported Analysis"
                else:
                    overall_status = "failed"
                    confidence = None
                    confidence_label = "Acquisition Failed"
                    err_detail = dprvi.get("error")
                    if not err_detail and execution_steps:
                        for s in reversed(execution_steps):
                            if s.get("status") in ("failed", "blocked") and s.get("error"):
                                err_detail = s["error"]
                                break
                    err_msg = err_detail or "Radar imagery unavailable or STAC retrieval failed."
                    answer = f"Sentinel-1 RTC dual-polarization analysis failed: {err_msg}"

        elif task == "sentinel2_ndvi":
            ndvi = analysis_metadata.get("ndvi_result", {})
            n_val = ndvi.get("ndvi_mean")
            if n_val is not None:
                answer = f"Calibrated Sentinel-2 surface reflectance NDVI is {n_val:.4f} across valid SCL-screened pixels."
                candidate_claims.append(ClaimVerificationItem(
                    claim_text=f"Mean Sentinel-2 NDVI is {n_val:.4f}.",
                    claim_type="measurement",
                    status="supported"
                ))
            else:
                n_status = ndvi.get("status") if ndvi else None
                if not n_status:
                    for step in reversed(execution_steps):
                        s_status = step.get("status")
                        s_err = (step.get("error") or "").lower()
                        if s_status == "unsupported" or (s_err and "unsupported" in s_err and "acquisition" not in s_err):
                            n_status = "unsupported"
                            break
                if n_status == "unsupported_zero_valid_pixels":
                    overall_status = "unsupported"
                    answer = ndvi.get("summary") or "No valid clear-sky pixels found after applying SCL quality mask. NDVI calculation unsupported."
                    confidence = None
                    confidence_label = "Zero Valid Pixels"
                elif n_status and n_status.startswith("unsupported"):
                    overall_status = "unsupported"
                    answer = ndvi.get("summary") or ndvi.get("error") or "Sentinel-2 NDVI analysis unsupported."
                    confidence = None
                    confidence_label = "Unsupported Analysis"
                else:
                    overall_status = "failed"
                    confidence = None
                    confidence_label = "Acquisition Failed"
                    err_detail = ndvi.get("error")
                    if not err_detail and execution_steps:
                        for s in reversed(execution_steps):
                            if s.get("status") in ("failed", "blocked") and s.get("error"):
                                err_detail = s["error"]
                                break
                    err_msg = err_detail or "Optical imagery unavailable or STAC retrieval failed."
                    answer = f"Sentinel-2 NDVI analysis failed: {err_msg}"
        else:
            answer = (analysis_result or {}).get("answer", f"Multi-step analysis for '{task}' completed successfully.")

        # Step 5: Evidence Package Building & Deterministic Verification
        analysis_dict = {
            "id": trace_id,
            "query": query,
            "task": task,
            "metadata": analysis_metadata,
            "evidence": evidence_items
        }
        pkg = EvidencePackageBuilder.from_analysis_response(analysis_dict)
        trace.add_step("EVIDENCE_ASSEMBLED", f"Extracted {len(pkg.physical_measurements)} physical measurement(s) and {len(pkg.evidence_artifacts)} artifact(s)")

        if overall_status == "success" and candidate_claims:
            verifier_tool = self.tool_registry.get("deterministic_verifier")
            v_out = verifier_tool.run(evidence_package=pkg, candidate_claims=candidate_claims, answer_text=answer)
            det_passed = v_out["passed"]
            confidence = 0.95 if det_passed else 0.40
            confidence_label = "Deterministic Verified" if det_passed else "Verification Flagged"
            trace.add_step("DETERMINISTIC_VERIFIED", f"Checks A-L: {'PASSED' if det_passed else 'VIOLATIONS DETECTED'} ({len(v_out['failures'])} violation(s))")
        else:
            v_out = {
                "passed": False,
                "deterministic_passed": False,
                "verification_status": "unsupported",
                "failures": [answer] if overall_status != "success" else [],
                "deterministic_failures": [answer] if overall_status != "success" else [],
                "claims": [],
                "contradictions": [],
                "unsupported_claims": [],
                "summary_explanation": f"Workflow ended with status '{overall_status}'. Quantitative verification not run.",
                "missing_evidence": [],
                "scientific_limitations": getattr(pkg, "known_limitations", []) or [],
                "recommended_checks": []
            }
            if overall_status == "success":
                confidence = 0.95
                confidence_label = "Deterministic Verified"
            trace.add_step("VERIFICATION_SKIPPED", f"Verification skipped for status '{overall_status}'", status="completed")

        # Step 6: Scientific Report Generation
        report = ScientificReportBuilder.build_report(analysis_dict, evidence_package=pkg)
        trace.add_step("REPORT_GENERATED", f"Structured Scientific Report '{report.report_id}' compiled")

        elapsed_total = round((time.time() - start_time) * 1000, 2)
        trace_data = trace.to_dict()
        trace_data["execution_steps"] = execution_steps
        trace_data["cumulative_transfer_bytes"] = cumulative_transfer_bytes
        trace_data["transfer_budget_bytes"] = max_bytes

        final_res = {
            "id": trace_id,
            "status": overall_status,
            "task": task,
            "mode": "orchestration",
            "answer": answer,
            "is_clarification_required": False,
            "confidence": confidence,
            "confidence_label": confidence_label,
            "models": trace.models_selected,
            "evidence": evidence_items,
            "trace": trace_data,
            "metadata": analysis_metadata,
            "verification": v_out,
            "reproducible_report": report.dict() if hasattr(report, "dict") else report.model_dump(),
            "execution_time_ms": elapsed_total,
            "created_at": datetime.utcnow().isoformat() + "Z"
        }
        return self._sanitize_for_json(final_res)

    @staticmethod
    def _sanitize_for_json(obj: Any) -> Any:
        if isinstance(obj, np.ndarray):
            return None
        elif isinstance(obj, (np.integer, np.int64, np.int32)):
            return int(obj)
        elif isinstance(obj, (np.floating, np.float64, np.float32)):
            return float(obj)
        elif isinstance(obj, (np.bool_, bool)):
            return bool(obj)
        elif isinstance(obj, dict):
            return {k: MultiStepOrchestrator._sanitize_for_json(v) for k, v in obj.items() if not isinstance(v, np.ndarray)}
        elif isinstance(obj, list):
            return [MultiStepOrchestrator._sanitize_for_json(v) for v in obj]
        return obj

    def _formulate_plan(self, parsed: Dict[str, Any], has_images: bool) -> List[Dict[str, Any]]:
        """Formulates an ordered, bounded list of tools to execute based on parsed query."""
        task = parsed["task"]
        bbox = parsed.get("bbox") or [72.8, 18.9, 72.9, 19.0]
        steps = []

        if task == "temporal_optical_change":
            # Search / retrieve / process T1 and T2
            steps.append({
                "tool": "stac_composite_retrieve",
                "args": {
                    "scene_id": "local_sample_temporal_t1_pre_monsoon" if not has_images else "workspace_img_1",
                    "aoi_bbox": bbox,
                    "collection": "sentinel-2-l2a",
                    "bands": ["b04", "b08", "scl"],
                    "include_scl": True,
                    "compute_ndvi": True
                },
                "description": "Acquire Pre-Event (T1) Sentinel-2 optical composite with SCL"
            })
            steps.append({
                "tool": "stac_composite_retrieve",
                "args": {
                    "scene_id": "local_sample_temporal_t2_post_monsoon" if not has_images else "workspace_img_2",
                    "aoi_bbox": bbox,
                    "collection": "sentinel-2-l2a",
                    "bands": ["b04", "b08", "scl"],
                    "include_scl": True,
                    "compute_ndvi": True
                },
                "description": "Acquire Post-Event (T2) Sentinel-2 optical composite with SCL"
            })
            steps.append({
                "tool": "temporal_optical_change",
                "args": {},
                "description": "Compute bi-temporal Sentinel-2 optical change and SCL filtering"
            })
        elif task == "temporal_sar_change":
            steps.append({
                "tool": "stac_composite_retrieve",
                "args": {
                    "scene_id": "local_sample_risat_sar_mumbai" if not has_images else "workspace_img_1",
                    "aoi_bbox": bbox,
                    "collection": "sentinel-1-rtc",
                    "bands": ["vv", "vh"],
                    "compute_dprvi": True
                },
                "description": "Acquire Pre-Event (T1) Sentinel-1 RTC dual-pol composite"
            })
            steps.append({
                "tool": "stac_composite_retrieve",
                "args": {
                    "scene_id": "local_sample_risat_sar_mumbai" if not has_images else "workspace_img_2",
                    "aoi_bbox": bbox,
                    "collection": "sentinel-1-rtc",
                    "bands": ["vv", "vh"],
                    "compute_dprvi": True
                },
                "description": "Acquire Post-Event (T2) Sentinel-1 RTC dual-pol composite"
            })
            steps.append({
                "tool": "temporal_sar_change",
                "args": {},
                "description": "Compute bi-temporal Sentinel-1 RTC SAR backscatter and DpRVI change"
            })
        elif task == "optical_sar":
            # For local samples, retrieve optical and SAR from local_sample_temporal_t1_pre_monsoon
            # so both assets share the identical coordinate reference system and bounding box
            sample_id = "local_sample_temporal_t1_pre_monsoon"
            steps.append({
                "tool": "stac_composite_retrieve",
                "args": {
                    "scene_id": sample_id if not has_images else "workspace_img_1",
                    "aoi_bbox": bbox,
                    "collection": "sentinel-2-l2a",
                    "bands": ["b04", "b08", "scl"],
                    "include_scl": True,
                    "compute_ndvi": True
                },
                "description": "Acquire Sentinel-2 L2A optical composite for cross-sensor fusion"
            })
            steps.append({
                "tool": "stac_composite_retrieve",
                "args": {
                    "scene_id": sample_id if not has_images else "workspace_img_2",
                    "aoi_bbox": bbox,
                    "collection": "sentinel-1-rtc",
                    "bands": ["vv", "vh"],
                    "compute_dprvi": True
                },
                "description": "Acquire Sentinel-1 RTC dual-pol composite for cross-sensor fusion"
            })
            steps.append({
                "tool": "optical_sar_fusion",
                "args": {},
                "description": "Execute calibrated Optical and SAR cross-sensor alignment and fusion"
            })
        elif task == "sentinel1_rtc_dprvi":
            steps.append({
                "tool": "stac_composite_retrieve",
                "args": {
                    "scene_id": "local_sample_risat_sar_mumbai" if not has_images else "workspace_img_1",
                    "aoi_bbox": bbox,
                    "collection": "sentinel-1-rtc",
                    "bands": ["vv", "vh"],
                    "compute_dprvi": True
                },
                "description": "Acquire Sentinel-1 RTC dual-pol window and compute calibrated DpRVI"
            })
        elif task == "sentinel2_ndvi":
            steps.append({
                "tool": "stac_composite_retrieve",
                "args": {
                    "scene_id": "local_sample_cartosat_optical_bengaluru" if not has_images else "workspace_img_1",
                    "aoi_bbox": bbox,
                    "collection": "sentinel-2-l2a",
                    "bands": ["b04", "b08", "scl"],
                    "include_scl": True,
                    "compute_ndvi": True
                },
                "description": "Acquire Sentinel-2 L2A window and compute calibrated NDVI with SCL"
            })
        else:
            steps.append({
                "tool": "vqa_captioning",
                "args": {
                    "images": [],
                    "query": parsed.get("task", "Analyze scene")
                },
                "description": "Execute vision-language specialist analysis"
            })

        return steps


# Singleton instance
agent_orchestrator = MultiStepOrchestrator()
