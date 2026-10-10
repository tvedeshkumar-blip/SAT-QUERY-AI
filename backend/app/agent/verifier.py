"""
Stage 7: Evidence-Grounded LLM Scientific Verification.
Provides deterministic scientific integrity validation and schema-constrained
LLM interpretive verification for remote sensing analysis outputs.
"""

import json
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple, Union
import httpx

from app.schemas.verification import (
    ClaimVerificationItem,
    DisplayStatisticItem,
    EvidenceArtifactItem,
    EvidencePackageSchema,
    HeuristicIndicatorItem,
    PhysicalMeasurementItem,
    ProviderInfoItem,
    VerificationResponseSchema,
)
from app.chatbot.lmstudio_client import (
    LMStudioClient,
    LMStudioClientError,
    LMStudioConnectionError,
    LMStudioAPIError,
)

logger = logging.getLogger("satquery.verifier")


class DeterministicVerifier:
    """
    Executes mandatory deterministic scientific-integrity checks on the evidence package
    and any proposed claims. Deterministic failures CANNOT be overridden by an LLM assertion.
    """

    @staticmethod
    def verify(
        evidence_package: EvidencePackageSchema,
        candidate_claims: Optional[List[Union[ClaimVerificationItem, Dict[str, Any], str]]] = None,
        answer_text: Optional[str] = None,
    ) -> Tuple[bool, List[str], List[ClaimVerificationItem], List[str]]:
        """
        Runs deterministic checks.
        Returns:
            (deterministic_passed, deterministic_failures, evaluated_claims, contradictions)
        """
        failures: List[str] = []
        contradictions: List[str] = []
        evaluated_claims: List[ClaimVerificationItem] = []

        # Build lookup set and dictionary of valid artifact IDs
        artifacts_by_id = {a.artifact_id.strip(): a for a in evidence_package.evidence_artifacts}
        norm_artifact_ids = {a.artifact_id.strip().lower(): a.artifact_id.strip() for a in evidence_package.evidence_artifacts}
        valid_artifact_ids = set(artifacts_by_id.keys())
        phys_by_name = {pm.name: pm for pm in evidence_package.physical_measurements}

        # 1. Deterministic Check: Physical measurements must declare units, statistic type, and mask
        for pm in evidence_package.physical_measurements:
            if not pm.unit or not pm.unit.strip():
                failures.append(f"Physical measurement '{pm.name}' lacks a declared physical unit.")
            if not pm.statistic_type or not pm.statistic_type.strip():
                failures.append(f"Physical measurement '{pm.name}' lacks a declared statistic type.")
            if not pm.mask_applied or not pm.mask_applied.strip():
                failures.append(f"Physical measurement '{pm.name}' lacks a declared valid-pixel mask.")

        # 2. Deterministic Check: Display-scale statistics must be labeled as display/visualization only
        for ds in evidence_package.display_statistics:
            if ds.purpose != "visualization_only":
                failures.append(
                    f"Display statistic '{ds.name}' purpose is not 'visualization_only' ({ds.purpose})."
                )

        # 3. Deterministic Check: Heuristic indicators must never be certified classifications
        for hi in evidence_package.heuristic_indicators:
            if hi.is_certified_classification:
                failures.append(
                    f"Heuristic indicator '{hi.name}' is improperly marked as certified classification."
                )

        # 4. Check for Gamma-0 vs Sigma-0 conflation in sensor / asset provenance
        has_gamma0 = False
        has_sigma0 = False
        is_uncalibrated_asset = False
        for asset in evidence_package.source_assets:
            cal = str(asset.get("calibration", "")).lower()
            meas = str(asset.get("measurement", "")).lower()
            desc = str(asset.get("description", "")).lower()
            coll = str(asset.get("collection", "")).lower()
            if "uncalibrated" in cal or "uncalibrated" in meas:
                is_uncalibrated_asset = True
            if "gamma" in cal or "gamma" in meas or "rtc" in coll or "gamma0" in desc:
                has_gamma0 = True
            if "sigma" in cal or "sigma" in meas or "sigma0" in desc:
                has_sigma0 = True

        for pm in evidence_package.physical_measurements:
            cal_q = str(pm.calibration_quantity or "").lower()
            if "gamma" in cal_q or "gamma0" in cal_q:
                has_gamma0 = True
            if "sigma" in cal_q or "sigma0" in cal_q:
                has_sigma0 = True

        # 5. Evaluate Candidate Claims & Answer Text
        claims_to_check: List[ClaimVerificationItem] = []
        if candidate_claims:
            for c in candidate_claims:
                if isinstance(c, ClaimVerificationItem):
                    claims_to_check.append(c)
                elif isinstance(c, dict):
                    claims_to_check.append(ClaimVerificationItem(**c))
                elif isinstance(c, str):
                    claims_to_check.append(ClaimVerificationItem(
                        claim_text=c,
                        claim_type="general",
                        status="partially_supported"
                    ))
        elif answer_text:
            # Extract basic claims from answer text
            claims_to_check = DeterministicVerifier._extract_claims_from_text(answer_text, evidence_package)

        for claim in claims_to_check:
            c_text_lower = claim.claim_text.lower()
            c_status = claim.status
            c_reason = claim.reason or ""

            # Check 0: Empty package check for physical measurements
            if not evidence_package.physical_measurements and (
                claim.claim_type == "measurement" or
                any(t in c_text_lower for t in ["reflectance", "backscatter", "linear power", "gamma0", "sigma0"])
            ):
                msg = "Evidence package contains zero physical measurements; claim cannot be verified as supported."
                failures.append(msg)
                contradictions.append(msg)
                c_status = "unsupported"
                c_reason = msg

            # Check A: Artifact citation integrity & Modality/Type Cross-Check
            cleaned_cited_ids = []
            for art_id in claim.cited_artifact_ids:
                clean_id = art_id.strip()
                # Check case-insensitive match
                if clean_id not in valid_artifact_ids and clean_id.lower() in norm_artifact_ids:
                    clean_id = norm_artifact_ids[clean_id.lower()]

                if clean_id not in valid_artifact_ids:
                    msg = f"Claim references unknown artifact ID '{art_id}' not found in evidence package."
                    failures.append(msg)
                    contradictions.append(msg)
                    c_status = "unsupported"
                    c_reason = f"Unknown artifact ID '{art_id}'."
                else:
                    cleaned_cited_ids.append(clean_id)
                    # Check modality compatibility
                    art = artifacts_by_id[clean_id]
                    art_type = (art.artifact_type or "").lower()
                    art_title = (art.title or "").lower()

                    is_optical_claim = any(t in c_text_lower for t in ["optical", "reflectance", "albedo", "b04", "ndvi", "rgb", "sentinel-2"])
                    is_pure_sar_art = ("sar" in art_type or "sar" in art_title or "radar" in art_title or "rtc" in art_title) and not any(t in art_type or t in art_title for t in ["composite", "fused", "overlay"])
                    if is_optical_claim and is_pure_sar_art:
                        msg = f"Modality mismatch: Claim asserts optical property, but cites SAR artifact '{clean_id}'."
                        failures.append(msg)
                        contradictions.append(msg)
                        c_status = "contradicted"
                        c_reason = msg

                    is_sar_claim = any(t in c_text_lower for t in ["sar", "radar", "backscatter", "gamma-0", "gamma0", "sigma-0", "sigma0", "linear power", "sentinel-1"])
                    is_pure_opt_art = ("optical" in art_type or "optical" in art_title or "sentinel-2" in art_title) and not any(t in art_type or t in art_title for t in ["composite", "fused", "overlay"])
                    if is_sar_claim and is_pure_opt_art:
                        msg = f"Modality mismatch: Claim asserts SAR/radar property, but cites optical artifact '{clean_id}'."
                        failures.append(msg)
                        contradictions.append(msg)
                        c_status = "contradicted"
                        c_reason = msg

            # Update cited artifact IDs with normalized versions
            if cleaned_cited_ids:
                claim.cited_artifact_ids = cleaned_cited_ids

            # Check A2: Unobserved Environmental Variables
            unobserved_terms = ["soil moisture", "surface temperature", "bathymetry", "precipitation", "wind speed", "salinity"]
            for term in unobserved_terms:
                if term in c_text_lower:
                    found_in_evidence = any(
                        term in pm.name.lower() or term in (pm.calibration_quantity or "").lower()
                        for pm in evidence_package.physical_measurements
                    )
                    if not found_in_evidence:
                        msg = f"Claim asserts unobserved environmental variable '{term}' absent from the evidence package."
                        failures.append(msg)
                        contradictions.append(msg)
                        c_status = "unsupported"
                        c_reason = msg

            # Check B: Co-registration claim consistency
            is_coreg_claim = any(
                term in c_text_lower for term in [
                    "co-registered", "coregistered", "co-registration", "coregistration",
                    "sub-pixel registration", "pixel-aligned", "geometric alignment",
                    "geometrically aligned", "registered and", "verified registration",
                    "scenes are registered", "images are registered"
                ]
            )
            if is_coreg_claim:
                reg_status = evidence_package.registration_status or {}
                is_coreg = bool(reg_status.get("co_registered", False))
                if not is_coreg:
                    msg = "Claim asserts geometric co-registration, but registration metadata indicates co-registration is False or unperformed."
                    failures.append(msg)
                    contradictions.append(msg)
                    c_status = "contradicted"
                    c_reason = "Contradicts registration metadata (co_registered=False)."

            # Check C: Trained model claim consistency
            is_trained_claim = bool(re.search(r'\b(?:deep[\s-]learning|neural[\s-]network|trained[\s-]model|trained[\s-]weights)\b', c_text_lower))
            if is_trained_claim:
                prov = evidence_package.provider_info
                if not prov.is_trained_model or prov.fallback_used:
                    msg = "Claim asserts a trained model was used, but provider metadata confirms a heuristic baseline or fallback was executed."
                    failures.append(msg)
                    contradictions.append(msg)
                    c_status = "contradicted"
                    c_reason = "Contradicts provider metadata: heuristic baseline / fallback was used."

            # Check D: Heuristic proxy described as certified classification or ground truth
            if any(term in c_text_lower for term in ["water", "canopy", "structural", "built-up", "vegetation"]):
                if any(term in c_text_lower for term in ["certified", "ground truth", "ground-truth", "validated accuracy", "ground truth classification"]):
                    msg = "Heuristic proxy is improperly claimed as certified land-cover classification or ground truth."
                    failures.append(msg)
                    contradictions.append(msg)
                    c_status = "contradicted"
                    c_reason = "Violates scientific integrity: heuristic proxy cannot be claimed as certified classification."

            # Check E: Gamma-0 vs Sigma-0 conflation and Uncalibrated Assets
            if is_uncalibrated_asset:
                if any(t in c_text_lower for t in ["certified gamma", "certified sigma", "calibrated backscatter", "calibrated sigma-0", "calibrated gamma-0"]):
                    msg = "Asset calibration provenance is uncalibrated DN; cannot support certified backscatter claim."
                    failures.append(msg)
                    contradictions.append(msg)
                    c_status = "contradicted"
                    c_reason = msg
            elif has_gamma0 and not has_sigma0:
                if any(term in c_text_lower for term in ["sigma-0", "sigma_0", "sigma0", "sigma-naught", "sigma naught"]):
                    msg = "SAR gamma-naught backscatter is mislabeled as sigma-naught without supporting calibration provenance."
                    failures.append(msg)
                    contradictions.append(msg)
                    c_status = "contradicted"
                    c_reason = "Mislabels gamma-naught RTC power as sigma-naught."

            # Check F: Display values conflated with physical measurements & Numerical verification
            if any(term in c_text_lower for term in ["surface reflectance", "boa reflectance", "albedo"]):
                match_before = re.search(r'(\d+\.?\d*)\s*(?:%|reflectance|albedo)', c_text_lower)
                match_after = re.search(r'(?:surface reflectance|boa reflectance|reflectance|albedo)[^\d]*(\d+\.?\d*)', c_text_lower)
                num_str = None
                if match_after:
                    num_str = match_after.group(1)
                elif match_before:
                    num_str = match_before.group(1)

                if num_str:
                    val = float(num_str)
                    if val > 1.0 and "display" not in c_text_lower and "%" not in c_text_lower and "dn" not in c_text_lower:
                        msg = f"Display-scale value ({val}) is conflated with physical BOA surface reflectance (range [0, 1])."
                        failures.append(msg)
                        contradictions.append(msg)
                        c_status = "contradicted"
                        c_reason = "Conflates 8-bit display value with physical BOA reflectance."
                    elif val <= 1.0:
                        # Verify against actual measured reflectance
                        true_refl = phys_by_name.get("optical_mean_boa_reflectance")
                        if true_refl and isinstance(true_refl.value, (int, float)):
                            actual = float(true_refl.value)
                            if abs(val - actual) > 0.05:
                                msg = f"Claimed BOA surface reflectance ({val}) contradicts verified physical measurement ({actual})."
                                failures.append(msg)
                                contradictions.append(msg)
                                c_status = "contradicted"
                                c_reason = msg

            # Check F2: SAR Display intensity conflation
            if any(t in c_text_lower for t in ["backscatter", "sar", "radar"]):
                m_sar_after = re.search(r'(?:backscatter|sar|radar)[^\d]*(\d+\.?\d*)', c_text_lower)
                m_sar_before = re.search(r'(\d+\.?\d*)\s*(?:backscatter|sar|radar)', c_text_lower)
                num_sar = None
                if m_sar_after:
                    num_sar = m_sar_after.group(1)
                elif m_sar_before:
                    num_sar = m_sar_before.group(1)

                if num_sar:
                    val_sar = float(num_sar)
                    disp_sar = next((ds for ds in evidence_package.display_statistics if "sar" in ds.name), None)
                    is_disp_val = (disp_sar and abs(val_sar - float(disp_sar.value)) < 0.5) or (val_sar > 25.0)
                    if is_disp_val and "display" not in c_text_lower and "dn" not in c_text_lower and "index" not in c_text_lower:
                        msg = f"Display-scale value ({val_sar}) is conflated with physical calibrated SAR backscatter."
                        failures.append(msg)
                        contradictions.append(msg)
                        c_status = "contradicted"
                        c_reason = "Conflates 8-bit display value with physical SAR backscatter."

            # Check G: Decibel naming clarity & non-linear statistics
            if any(t in c_text_lower for t in ["linear power", "linear gamma", "linear backscatter", "mean linear"]) and "db" in c_text_lower and "10*log10" not in c_text_lower and "converted" not in c_text_lower:
                msg = "Linear power is incorrectly labeled as dB backscatter without logarithmic conversion."
                failures.append(msg)
                contradictions.append(msg)
                c_status = "contradicted"
                c_reason = "Conflates linear power with decibels."

            if "mean pixel-wise" in c_text_lower or "pixel-wise db" in c_text_lower:
                m_db = re.search(r'(-?\d+\.?\d*)\s*db', c_text_lower)
                if m_db:
                    db_val = float(m_db.group(1))
                    true_lin_to_db = phys_by_name.get("sar_mean_linear_to_db")
                    true_px_db = phys_by_name.get("sar_mean_pixel_db")
                    if true_lin_to_db and true_px_db:
                        v_lin_db = float(true_lin_to_db.value)
                        v_px_db = float(true_px_db.value)
                        if abs(db_val - v_lin_db) < 0.2 and abs(db_val - v_px_db) > 1.0:
                            msg = f"Value ({db_val} dB) is the linear power mean converted to dB (10*log10(mean linear)), but is incorrectly claimed as mean pixel-wise dB."
                            failures.append(msg)
                            contradictions.append(msg)
                            c_status = "contradicted"
                            c_reason = msg

            evaluated_claims.append(ClaimVerificationItem(
                claim_text=claim.claim_text,
                claim_type=claim.claim_type,
                status=c_status,
                cited_artifact_ids=claim.cited_artifact_ids,
                evidence_found=claim.evidence_found,
                reason=c_reason or claim.reason
            ))

        passed = len(failures) == 0
        return passed, failures, evaluated_claims, contradictions

    @staticmethod
    def _extract_claims_from_text(
        text: str,
        evidence_package: EvidencePackageSchema
    ) -> List[ClaimVerificationItem]:
        """
        Extracts coarse candidate claims from text sentences.
        """
        claims = []
        sentences = [s.strip() for s in re.split(r'[.\n;]+', text) if len(s.strip()) > 15]
        for s in sentences:
            s_lower = s.lower()
            claim_type = "general"
            if any(t in s_lower for t in ["reflectance", "gamma", "sigma", "db", "backscatter"]):
                claim_type = "measurement"
            elif any(t in s_lower for t in ["display", "albedo", "intensity"]):
                claim_type = "display"
            elif any(t in s_lower for t in ["water", "canopy", "structural", "proxy", "heuristic"]):
                claim_type = "heuristic"
            elif any(t in s_lower for t in ["sentinel", "cartosat", "landsat", "rtc"]):
                claim_type = "provenance"
            elif any(t in s_lower for t in ["co-registered", "registered", "aligned"]):
                claim_type = "registration"
            elif any(t in s_lower for t in ["model", "baseline", "bit-cd", "neural"]):
                claim_type = "model"

            # Check if any artifact ID is cited in sentence
            cited = []
            for art in evidence_package.evidence_artifacts:
                if art.artifact_id.lower() in s_lower:
                    cited.append(art.artifact_id)

            claims.append(ClaimVerificationItem(
                claim_text=s,
                claim_type=claim_type,
                status="supported",
                cited_artifact_ids=cited,
                reason="Extracted from analysis answer text."
            ))
        return claims


class EvidencePackageBuilder:
    """
    Constructs a structured, bounded EvidencePackageSchema from runtime analysis results.
    """

    @staticmethod
    def from_analysis_response(
        response_dict_or_obj: Union[Dict[str, Any], Any],
        raw_metadata: Optional[Dict[str, Any]] = None,
    ) -> EvidencePackageSchema:
        """
        Builds EvidencePackageSchema from an AnalysisResponseSchema or response dictionary.
        """
        if hasattr(response_dict_or_obj, "model_dump"):
            data = response_dict_or_obj.model_dump()
        elif hasattr(response_dict_or_obj, "dict"):
            data = response_dict_or_obj.dict()
        elif isinstance(response_dict_or_obj, dict):
            data = response_dict_or_obj
        else:
            data = getattr(response_dict_or_obj, "__dict__", {})

        req_id = data.get("id", f"task_{int(time.time())}")
        task = data.get("task", "general")
        query = data.get("query", data.get("answer", "")[:100])
        meta = raw_metadata or data.get("metadata", {})

        # 1. Sensors & Timestamps
        sensor_identities = []
        timestamps = []
        if meta.get("sensor"):
            sensor_identities.append(str(meta["sensor"]))
        if meta.get("datetime"):
            timestamps.append(str(meta["datetime"]))

        # Check temporal / cross-sensor metadata
        temp_prov = meta.get("temporal_provenance", {})
        if temp_prov:
            for key in ["t1", "t2"]:
                t_info = temp_prov.get(key, {})
                if t_info.get("collection"):
                    sensor_identities.append(str(t_info.get("collection")))
                if t_info.get("datetime"):
                    timestamps.append(str(t_info.get("datetime")))

        # Check optical_sar metadata
        opt_sar_meta = meta.get("optical_sar_joint", {})
        if opt_sar_meta:
            opt_info = opt_sar_meta.get("optical_scene", {})
            sar_info = opt_sar_meta.get("sar_scene", {})
            if opt_info.get("sensor"):
                sensor_identities.append(str(opt_info["sensor"]))
            if opt_info.get("datetime"):
                timestamps.append(str(opt_info["datetime"]))
            if sar_info.get("sensor"):
                sensor_identities.append(str(sar_info["sensor"]))
            if sar_info.get("datetime"):
                timestamps.append(str(sar_info["datetime"]))

        # Deduplicate
        sensor_identities = list(dict.fromkeys(sensor_identities))
        timestamps = list(dict.fromkeys(timestamps))

        # 2. Source assets
        source_assets = []
        if meta.get("source_url") or meta.get("id"):
            source_assets.append({
                "id": meta.get("id") or meta.get("scene_id") or "primary",
                "collection": meta.get("collection") or meta.get("sensor"),
                "calibration": meta.get("calibration", "unspecified"),
                "asset_category": meta.get("asset_category")
            })

        # 3. CRS, Resolution, Dimensions
        crs = meta.get("crs_display") or meta.get("crs")
        res = meta.get("resolution") or meta.get("pixel_size")
        dims = None
        if meta.get("width") and meta.get("height"):
            dims = f"{meta['width']}x{meta['height']}"

        # 4. Registration info
        reg_info = meta.get("registration_info", {})
        if not reg_info and opt_sar_meta.get("registration"):
            reg_info = opt_sar_meta["registration"]

        # 5. Valid pixel count
        valid_px = reg_info.get("valid_pixels") or meta.get("valid_pixel_count")
        total_px = reg_info.get("total_pixels") or meta.get("total_pixels")
        valid_pct = reg_info.get("valid_percentage")
        if valid_pct is None and valid_px and total_px:
            valid_pct = round((valid_px / total_px) * 100.0, 2)

        # 6. Physical measurements
        physical_measurements = []
        # Optical BOA reflectance
        opt_mean_boa = opt_sar_meta.get("optical_mean_boa_reflectance")
        if opt_mean_boa is not None:
            physical_measurements.append(PhysicalMeasurementItem(
                name="optical_mean_boa_reflectance",
                value=opt_mean_boa,
                unit="unitless (surface reflectance BOA)",
                statistic_type="mean",
                mask_applied="joint_valid_mask",
                calibration_quantity="boa_surface_reflectance"
            ))

        # SAR linear power
        sar_lin = opt_sar_meta.get("sar_mean_linear_power")
        if sar_lin is not None:
            physical_measurements.append(PhysicalMeasurementItem(
                name="sar_mean_linear_power",
                value=sar_lin,
                unit="linear power (m^2/m^2)",
                statistic_type="mean",
                mask_applied="joint_valid_mask",
                calibration_quantity="gamma0"
            ))

        # SAR pixel decibels
        sar_px_db = opt_sar_meta.get("sar_mean_pixel_db")
        if sar_px_db is not None:
            physical_measurements.append(PhysicalMeasurementItem(
                name="sar_mean_pixel_db",
                value=sar_px_db,
                unit="dB",
                statistic_type="mean of pixel-wise dB",
                mask_applied="joint_valid_mask",
                calibration_quantity="gamma0"
            ))

        # SAR linear converted to decibels
        sar_lin_db = opt_sar_meta.get("sar_mean_linear_to_db")
        if sar_lin_db is not None:
            physical_measurements.append(PhysicalMeasurementItem(
                name="sar_mean_linear_to_db",
                value=sar_lin_db,
                unit="dB",
                statistic_type="10*log10(mean linear power)",
                mask_applied="joint_valid_mask",
                calibration_quantity="gamma0"
            ))

        # 7. Display statistics
        display_stats = []
        opt_disp = opt_sar_meta.get("optical_mean_albedo") or opt_sar_meta.get("optical_albedo_display_mean")
        if opt_disp is not None:
            display_stats.append(DisplayStatisticItem(
                name="optical_albedo_display_mean",
                value=opt_disp,
                scale="8-bit normalized [0, 255]",
                purpose="visualization_only"
            ))

        sar_disp = opt_sar_meta.get("sar_mean_intensity") or opt_sar_meta.get("sar_intensity_display_mean")
        if sar_disp is not None:
            display_stats.append(DisplayStatisticItem(
                name="sar_intensity_display_mean",
                value=sar_disp,
                scale="8-bit normalized [0, 255]",
                purpose="visualization_only"
            ))

        # 8. Heuristic indicators
        heuristics = []
        heur_dict = opt_sar_meta.get("heuristic_segmentation", {})
        if heur_dict:
            if "water" in heur_dict:
                w = heur_dict["water"]
                heuristics.append(HeuristicIndicatorItem(
                    name="heuristic_surface_water_proxy",
                    percentage=float(w.get("percentage", 0.0)),
                    pixel_count=int(w.get("pixels", 0)),
                    definition="Normalized display optical albedo <= 25 and SAR intensity <= 40",
                    is_certified_classification=False,
                    limitations="Preliminary scene-normalized empirical heuristic proxy; not validated ground-truth."
                ))
            if "structural" in heur_dict:
                s = heur_dict["structural"]
                heuristics.append(HeuristicIndicatorItem(
                    name="heuristic_structural_proxy",
                    percentage=float(s.get("percentage", 0.0)),
                    pixel_count=int(s.get("pixels", 0)),
                    definition="Normalized display optical albedo >= 110 and SAR intensity >= 140",
                    is_certified_classification=False,
                    limitations="Preliminary scene-normalized empirical heuristic proxy; not validated ground-truth."
                ))
            if "canopy" in heur_dict:
                c = heur_dict["canopy"]
                heuristics.append(HeuristicIndicatorItem(
                    name="heuristic_canopy_proxy",
                    percentage=float(c.get("percentage", 0.0)),
                    pixel_count=int(c.get("pixels", 0)),
                    definition="Residual valid vegetation pixels outside water and structural slices",
                    is_certified_classification=False,
                    limitations="Preliminary scene-normalized empirical heuristic proxy; not validated ground-truth."
                ))

        # 9. Evidence Artifacts
        evidence_artifacts = []
        raw_evidence = data.get("evidence", [])
        for ev in raw_evidence:
            if isinstance(ev, dict):
                art_id = ev.get("id", "unknown")
                art_type = ev.get("type", "unknown")
                title = ev.get("title", "")
                desc = ev.get("description")
                stats = ev.get("statistics")
            else:
                art_id = getattr(ev, "id", "unknown")
                art_type = getattr(ev, "type", "unknown")
                title = getattr(ev, "title", "")
                desc = getattr(ev, "description", None)
                stats = getattr(ev, "statistics", None)

            evidence_artifacts.append(EvidenceArtifactItem(
                artifact_id=art_id,
                artifact_type=art_type,
                title=title,
                description=desc,
                statistics=stats or {}
            ))

        # 10. Provider Info
        prov_info = ProviderInfoItem(
            provider_name=data.get("primary_model") or data.get("actual_model_used") or "SatQueryEngine",
            actual_model_used=data.get("actual_model_used"),
            fallback_used=bool(data.get("fallback_used", False)),
            is_trained_model=(data.get("implementation_status") == "pretrained_model"),
            model_status=data.get("model_status")
        )

        # 11. Warnings & Limitations
        warnings = meta.get("validation_warnings", [])
        limitations = meta.get("scientific_limitations", [])

        return EvidencePackageSchema(
            task_id=req_id,
            query=query,
            sensor_identities=sensor_identities,
            acquisition_timestamps=timestamps,
            source_assets=source_assets,
            crs=crs,
            resolution=str(res) if res is not None else None,
            dimensions=dims,
            registration_status=reg_info,
            valid_pixel_count=valid_px,
            total_pixel_count=total_px,
            valid_pixel_percentage=valid_pct,
            physical_measurements=physical_measurements,
            display_statistics=display_stats,
            heuristic_indicators=heuristics,
            evidence_artifacts=evidence_artifacts,
            provider_info=prov_info,
            validation_warnings=warnings,
            known_limitations=limitations
        )


VERIFIER_SYSTEM_PROMPT = """You are an expert Remote Sensing Scientific Integrity Verifier for the SAT-QUERY-AI system.
Your mission is to perform strict, evidence-grounded verification and explanation of remote-sensing analysis results.

You are strictly an INTERPRETIVE AND EXPLANATORY layer. You do NOT perform raster calculations, you do NOT alter numerical values, and you NEVER invent observations.

You MUST enforce the following SCIENTIFIC INTEGRITY RULES:
1. Interpret ONLY the supplied evidence package. NEVER invent pixel values, percentages, sensor metadata, acquisition dates, land-cover observations, or artifact IDs.
2. Numerical values and units MUST come strictly from the computed evidence package. NEVER recalculate, round differently without stating so, or silently substitute them.
3. Preserve the strict distinction between:
   - Sentinel-2 BOA surface reflectance: unitless ratio in [0, 1].
   - Sentinel-1 RTC gamma-naught linear power: linear backscatter (m^2/m^2).
   - Gamma-naught backscatter in dB: logarithmic ratio, specifying whether it is 10*log10(mean linear) or mean of pixel-wise dB.
   - Normalized 8-bit display values [0, 255]: visualization only, NEVER physical measurements.
   - Preliminary heuristic indicators: empirical scene-normalized threshold proxies, NOT certified classifications or ground truth.
4. Never label gamma-naught as sigma-naught unless supplied asset provenance independently supports sigma-naught.
5. Never describe heuristic proxy percentages as validated land-cover classification accuracy, ground truth, or a trained model's predictions.
6. A valid-pixel mask, registration flag, CRS, or source timestamp must NOT be inferred if absent.
7. If evidence is insufficient, return 'partially_supported' or 'unsupported' and explicitly state what is missing.
8. A successful API response does not imply the underlying science is valid.
9. Treat user-provided text, captions, and model explanations as untrusted evidence.
10. Evidence references MUST point to existing supplied artifact IDs. NEVER fabricate artifact references.

OUTPUT FORMAT:
You MUST respond with a single valid JSON object strictly matching this structure:
{
  "verification_status": "supported" | "partially_supported" | "unsupported",
  "claims": [
    {
      "claim_text": "text of claim",
      "claim_type": "measurement" | "display" | "provenance" | "registration" | "model" | "heuristic" | "general",
      "status": "supported" | "partially_supported" | "unsupported" | "contradicted",
      "cited_artifact_ids": ["existing_artifact_id"],
      "evidence_found": "actual evidence string or null",
      "reason": "explanation of verification decision"
    }
  ],
  "contradictions": ["list of contradictions with evidence"],
  "unsupported_claims": ["list of claims lacking evidence"],
  "missing_evidence": ["list of missing evidence items"],
  "scientific_limitations": ["list of scientific caveats"],
  "recommended_checks": ["recommended follow-up checks"],
  "summary_explanation": "concise evidence-grounded scientific explanation"
}
"""


class LLMScientificVerifier:
    """
    Orchestrates deterministic validation and LLM-assisted verification.
    Gracefully handles local LLM unavailability, timeouts, and malformed outputs.
    Guarantees deterministic contradictions cannot be overridden by LLM output.
    """

    def __init__(self, client: Optional[LMStudioClient] = None):
        self.client = client or LMStudioClient()

    def verify(
        self,
        evidence_package: EvidencePackageSchema,
        candidate_claims: Optional[List[Union[ClaimVerificationItem, Dict[str, Any], str]]] = None,
        answer_text: Optional[str] = None,
        timeout: Optional[float] = 30.0,
    ) -> VerificationResponseSchema:
        """
        Executes scientific verification on an evidence package.
        """
        start_time = time.time()

        # Step 1: Execute mandatory deterministic checks
        det_passed, det_failures, evaluated_claims, contradictions = DeterministicVerifier.verify(
            evidence_package=evidence_package,
            candidate_claims=candidate_claims,
            answer_text=answer_text
        )

        # Baseline scientific limitations from package
        scientific_limitations = list(evidence_package.known_limitations)
        if not evidence_package.crs:
            scientific_limitations.append("Missing or unverified spatial CRS in source metadata.")
        if evidence_package.valid_pixel_percentage is not None and evidence_package.valid_pixel_percentage < 90.0:
            scientific_limitations.append(f"Low valid-data pixel coverage ({evidence_package.valid_pixel_percentage}%).")

        missing_evidence = []
        if not evidence_package.source_assets:
            missing_evidence.append("Source asset identifiers and catalog provenance are missing.")
        if not evidence_package.registration_status.get("co_registered"):
            missing_evidence.append("Rigorous geometric co-registration metadata is not established.")

        recommended_checks = [
            "Verify acquisition timestamps against official STAC catalog metadata.",
            "Inspect valid-pixel mask boundaries for edge-effect distortion.",
            "Confirm physical calibration scale factor matches sensor specification."
        ]

        # If deterministic checks failed, baseline status CANNOT be 'supported'
        initial_status = "supported" if det_passed else "unsupported"
        if not det_passed and any(c.status == "supported" for c in evaluated_claims):
            initial_status = "partially_supported"

        # Step 2: Check LLM reachability
        is_llm_online = False
        try:
            is_llm_online = self.client.is_reachable(timeout=2.0)
        except Exception as e:
            logger.debug(f"LLM reachability check failed: {e}")
            is_llm_online = False

        if not is_llm_online:
            # Fallback path: deterministic-only result, LLM not run
            elapsed = round((time.time() - start_time) * 1000, 2)
            summary = (
                "Deterministic scientific-integrity checks completed successfully. "
                "LLM interpretive verification was not run because the local LLM service is offline or unreachable."
                if det_passed else
                f"Deterministic scientific-integrity check failed with {len(det_failures)} violation(s). "
                "LLM verification was not run because the local LLM service is offline or unreachable."
            )
            return VerificationResponseSchema(
                verification_status="not_run" if det_passed else "unsupported",
                deterministic_passed=det_passed,
                deterministic_failures=det_failures,
                claims=evaluated_claims,
                contradictions=contradictions,
                unsupported_claims=[c.claim_text for c in evaluated_claims if c.status in ("unsupported", "contradicted")],
                missing_evidence=missing_evidence,
                scientific_limitations=scientific_limitations,
                recommended_checks=recommended_checks,
                summary_explanation=summary,
                is_interpretive_only=True,
                llm_model_used=None,
                llm_run=False,
                execution_time_ms=elapsed
            )

        # Step 3: LLM is reachable - build strict prompt and call LLM
        evidence_dict = (
            evidence_package.model_dump()
            if hasattr(evidence_package, "model_dump")
            else evidence_package.dict()
        )
        user_prompt = (
            f"Please verify the following remote-sensing analysis evidence package and claims.\n\n"
            f"EVIDENCE PACKAGE:\n{json.dumps(evidence_dict, indent=2)}\n\n"
            f"ANALYSIS ANSWER TEXT TO VERIFY:\n{answer_text or 'No raw text provided.'}\n\n"
            f"DETERMINISTIC PRE-CHECK FINDINGS:\n"
            f"- Passed: {det_passed}\n"
            f"- Rule Violations: {json.dumps(det_failures)}\n\n"
            f"Produce the structured JSON verification report strictly adhering to the integrity rules."
        )

        messages = [
            {"role": "system", "content": VERIFIER_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt}
        ]

        llm_model_name = None
        try:
            resp = self.client.chat_completion(
                messages=messages,
                temperature=0.0,
                max_tokens=1500,
                timeout=timeout
            )
            content = resp.get("content", "").strip()
            llm_model_name = resp.get("model")

            # Extract JSON block
            parsed_data = self._parse_json_response(content)

            # Step 4: Validate structured output against verifier contract
            llm_status = parsed_data.get("verification_status", "partially_supported")
            llm_claims_raw = parsed_data.get("claims", [])
            llm_contradictions = parsed_data.get("contradictions", [])
            llm_unsupported = parsed_data.get("unsupported_claims", [])
            llm_missing = parsed_data.get("missing_evidence", [])
            llm_limits = parsed_data.get("scientific_limitations", [])
            llm_checks = parsed_data.get("recommended_checks", [])
            llm_summary = parsed_data.get("summary_explanation", "")

            # Merge LLM claims with deterministic evaluation
            final_claims = []
            valid_art_ids = {a.artifact_id.strip() for a in evidence_package.evidence_artifacts}
            det_contradicted_claims = {
                c.claim_text.strip().lower(): c
                for c in evaluated_claims
                if c.status in ("contradicted", "unsupported")
            }

            for c_raw in llm_claims_raw:
                c_item = ClaimVerificationItem(**c_raw)
                # Check for hallucinated artifact citations by LLM
                cleaned_cited = []
                for art_id in c_item.cited_artifact_ids:
                    clean_id = art_id.strip()
                    if clean_id not in valid_art_ids and clean_id.lower() in {a.lower() for a in valid_art_ids}:
                        clean_id = next(a for a in valid_art_ids if a.lower() == clean_id.lower())
                    if clean_id not in valid_art_ids:
                        c_item.status = "unsupported"
                        c_item.reason = f"LLM cited invalid artifact ID '{art_id}' not in evidence package."
                        llm_contradictions.append(f"Invalid artifact ID '{art_id}' cited by LLM.")
                    else:
                        cleaned_cited.append(clean_id)
                c_item.cited_artifact_ids = cleaned_cited

                # NON-OVERRIDABLE GATE: A deterministically contradicted/unsupported claim CANNOT be promoted to supported!
                c_text_l = c_item.claim_text.strip().lower()
                for det_text, det_c in det_contradicted_claims.items():
                    if det_text in c_text_l or c_text_l in det_text:
                        if c_item.status == "supported":
                            c_item.status = det_c.status
                            c_item.reason = f"Deterministic gate: {det_c.reason}"

                final_claims.append(c_item)

            if not final_claims and evaluated_claims:
                final_claims = evaluated_claims
            elif not llm_claims_raw and evaluated_claims:
                final_claims = evaluated_claims

            # Step 5: Enforce Non-Overridable Deterministic Gate
            # A deterministic failure MUST NOT be overridden by an LLM assertion!
            final_status = llm_status
            if not det_passed:
                supported_count = sum(1 for c in final_claims if c.status == "supported")
                if supported_count == 0:
                    final_status = "unsupported"
                else:
                    final_status = "partially_supported"
                # Ensure all deterministic failures are in contradictions
                for f in det_failures:
                    if f not in llm_contradictions:
                        llm_contradictions.insert(0, f)

            # Merge lists cleanly
            all_contradictions = list(dict.fromkeys(contradictions + llm_contradictions))
            all_missing = list(dict.fromkeys(missing_evidence + llm_missing))
            all_limits = list(dict.fromkeys(scientific_limitations + llm_limits))
            all_checks = list(dict.fromkeys(recommended_checks + llm_checks))

            if not det_passed:
                all_limits.append("Deterministic scientific-integrity check failed; underlying measurements must be reviewed.")

            elapsed = round((time.time() - start_time) * 1000, 2)

            return VerificationResponseSchema(
                verification_status=final_status,
                deterministic_passed=det_passed,
                deterministic_failures=det_failures,
                claims=final_claims,
                contradictions=all_contradictions,
                unsupported_claims=list(dict.fromkeys(llm_unsupported + [c.claim_text for c in final_claims if c.status in ("unsupported", "contradicted")])),
                missing_evidence=all_missing,
                scientific_limitations=all_limits,
                recommended_checks=all_checks,
                summary_explanation=llm_summary or "LLM scientific verification completed.",
                is_interpretive_only=True,
                llm_model_used=llm_model_name,
                llm_run=True,
                execution_time_ms=elapsed
            )

        except (LMStudioConnectionError, httpx.TimeoutException, httpx.ConnectError, httpx.ConnectTimeout) as ce:
            logger.warning(f"LLM connection/timeout error during verification: {ce}")
            elapsed = round((time.time() - start_time) * 1000, 2)
            return VerificationResponseSchema(
                verification_status="not_run" if det_passed else "unsupported",
                deterministic_passed=det_passed,
                deterministic_failures=det_failures,
                claims=evaluated_claims,
                contradictions=contradictions,
                unsupported_claims=[c.claim_text for c in evaluated_claims if c.status in ("unsupported", "contradicted")],
                missing_evidence=missing_evidence,
                scientific_limitations=scientific_limitations,
                recommended_checks=recommended_checks,
                summary_explanation=f"LLM verification could not be completed ({ce}). Deterministic checks recorded.",
                is_interpretive_only=True,
                llm_model_used=None,
                llm_run=False,
                execution_time_ms=elapsed
            )
        except Exception as e:
            logger.warning(f"LLM verification parsing or execution error: {e}")
            elapsed = round((time.time() - start_time) * 1000, 2)
            # Malformed output or unexpected error must NOT be treated as successful verification
            return VerificationResponseSchema(
                verification_status="not_run" if det_passed else "unsupported",
                deterministic_passed=det_passed,
                deterministic_failures=det_failures,
                claims=evaluated_claims,
                contradictions=contradictions,
                unsupported_claims=[c.claim_text for c in evaluated_claims if c.status in ("unsupported", "contradicted")],
                missing_evidence=missing_evidence,
                scientific_limitations=scientific_limitations + [f"LLM output could not be validated against verification schema: {str(e)}"],
                recommended_checks=recommended_checks,
                summary_explanation=f"LLM scientific verification failed schema validation or encountered an error. Deterministic checks preserved.",
                is_interpretive_only=True,
                llm_model_used=llm_model_name,
                llm_run=False,
                execution_time_ms=elapsed
            )

    def _parse_json_response(self, content: str) -> Dict[str, Any]:
        """
        Extracts and parses JSON object from LLM response text, stripping markdown if present.
        """
        cleaned = content.strip()
        # Strip markdown ```json ... ``` wrapper
        if "```" in cleaned:
            match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', cleaned)
            if match:
                cleaned = match.group(1).strip()

        # Try parsing JSON
        return json.loads(cleaned)


# Global instance
scientific_verifier = LLMScientificVerifier()
