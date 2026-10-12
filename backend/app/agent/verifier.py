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

        # Check J (Package-Level): Deterministic validation of NDVI measurements
        for pm in evidence_package.physical_measurements:
            pm_name_lower = pm.name.lower()
            cal_qty_lower = (pm.calibration_quantity or "").lower()
            is_ndvi_measurement = "ndvi" in pm_name_lower or "ndvi" in cal_qty_lower
            if is_ndvi_measurement:
                # 1. Measurements must be finite and within [-1.0, 1.0]
                if pm.value is not None:
                    try:
                        val_float = float(pm.value)
                        import math
                        if math.isnan(val_float) or math.isinf(val_float):
                            failures.append(f"NDVI measurement '{pm.name}' must be finite, found NaN/inf.")
                        elif val_float < -1.0 or val_float > 1.0:
                            failures.append(f"NDVI measurement '{pm.name}' value {val_float} is outside valid physical range [-1.0, 1.0].")
                    except (ValueError, TypeError):
                        failures.append(f"NDVI measurement '{pm.name}' value '{pm.value}' is not a valid numeric float.")

                # 2. Must be reported as a unitless ratio, not percentage or reflectance
                unit_lower = (pm.unit or "").strip().lower()
                if any(pu == unit_lower or f" {pu}" in unit_lower or f"{pu} " in unit_lower for pu in ["%", "percent", "percentage", "reflectance"]):
                    failures.append(f"NDVI measurement '{pm.name}' must be reported as a unitless ratio [-1, 1], not '{pm.unit}'.")

                # 6 & 7. Zero valid pixels defense
                if evidence_package.valid_pixel_count == 0 or (hasattr(evidence_package, "valid_pixel_percentage") and evidence_package.valid_pixel_percentage == 0.0 and evidence_package.total_pixel_count and evidence_package.total_pixel_count > 0):
                    if pm.value is not None:
                        failures.append(f"Cannot report numeric NDVI statistic '{pm.name}' ({pm.value}) when valid pixel count is zero.")

        # Check K (Package-Level): Deterministic validation of Sentinel-1 RTC Dual-Polarization & DpRVI measurements
        for pm in evidence_package.physical_measurements:
            pm_name_lower = pm.name.lower()
            cal_qty_lower = (pm.calibration_quantity or "").lower()
            is_dprvi_measurement = "dprvi" in pm_name_lower or "dprvi" in cal_qty_lower
            if is_dprvi_measurement:
                # 1. DpRVI values must be finite and within [0.0, 1.0] (Mandal et al., 2020)
                if pm.value is not None:
                    try:
                        val_float = float(pm.value)
                        import math
                        if math.isnan(val_float) or math.isinf(val_float):
                            failures.append(f"DpRVI measurement '{pm.name}' must be finite, found NaN/inf.")
                        elif val_float < 0.0 or val_float > 1.0:
                            failures.append(f"DpRVI measurement '{pm.name}' value {val_float} is outside valid physical range [0.0, 1.0].")
                    except (ValueError, TypeError):
                        failures.append(f"DpRVI measurement '{pm.name}' value '{pm.value}' is not a valid numeric float.")

                # 2. Must be reported as a unitless ratio [0, 1], not dB, %, or linear power
                unit_lower = (pm.unit or "").strip().lower()
                invalid_dprvi_units = ["db", "%", "percent", "percentage", "reflectance", "m^2/m^2", "m2/m2"]
                if any(iu == unit_lower or f" {iu}" in unit_lower or f"{iu} " in unit_lower for iu in invalid_dprvi_units):
                    failures.append(f"DpRVI measurement '{pm.name}' must be reported as a unitless ratio [0, 1], not '{pm.unit}'.")

                # 3. Zero valid pixels defense
                if evidence_package.valid_pixel_count == 0 or (hasattr(evidence_package, "valid_pixel_percentage") and evidence_package.valid_pixel_percentage == 0.0 and evidence_package.total_pixel_count and evidence_package.total_pixel_count > 0):
                    if pm.value is not None:
                        failures.append(f"Cannot report numeric DpRVI statistic '{pm.name}' ({pm.value}) when valid pixel count is zero.")

            # Cross-polarization ratio validation
            is_cross_pol_linear = "cross_pol_ratio_linear" in pm_name_lower
            if is_cross_pol_linear and pm.value is not None:
                try:
                    val_float = float(pm.value)
                    if val_float < 0.0:
                        failures.append(f"Cross-polarization ratio '{pm.name}' linear power ratio cannot be negative ({val_float}).")
                except (ValueError, TypeError):
                    pass

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

                    if claim.claim_type == "measurement" and art_type == "mask" and not any(t in c_text_lower for t in ["mask", "coverage", "valid pixel", "pixel count", "flag"]):
                        msg = f"Quantity/type mismatch: Measurement claim cites mask artifact '{clean_id}' without measurement data."
                        failures.append(msg)
                        contradictions.append(msg)
                        c_status = "contradicted"
                        c_reason = msg

            # Update cited artifact IDs with deduplicated, normalized versions
            if cleaned_cited_ids:
                claim.cited_artifact_ids = list(dict.fromkeys(cleaned_cited_ids))

            # Check A2: Unobserved Environmental Variables
            unobserved_terms = ["soil moisture", "surface temperature", "bathymetry", "precipitation", "wind speed", "salinity"]
            for term in unobserved_terms:
                if term in c_text_lower:
                    is_disclaiming = any(neg in c_text_lower for neg in [
                        "not observed", "unobserved", "absent", "cannot be inferred",
                        "not measured", "not available", "no data", "without"
                    ])
                    if not is_disclaiming:
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
                    is_negated = any(neg in c_text_lower for neg in [
                        "not certified", "not a certified", "not ground truth", "not ground-truth",
                        "never certified", "neither certified", "no certified", "cannot be considered ground truth"
                    ])
                    if not is_negated:
                        msg = "Heuristic proxy is improperly claimed as certified land-cover classification or ground truth."
                        failures.append(msg)
                        contradictions.append(msg)
                        c_status = "contradicted"
                        c_reason = "Violates scientific integrity: heuristic proxy cannot be claimed as certified classification."

            # Check E: Gamma-0 vs Sigma-0 conflation and Uncalibrated Assets
            is_cert_cal_claim = any(t in c_text_lower for t in ["certified gamma", "certified sigma", "calibrated backscatter", "calibrated sigma-0", "calibrated gamma-0"])
            if is_cert_cal_claim:
                if is_uncalibrated_asset:
                    msg = "Asset calibration provenance is uncalibrated DN; cannot support certified backscatter claim."
                    failures.append(msg)
                    contradictions.append(msg)
                    c_status = "contradicted"
                    c_reason = msg
                elif not has_gamma0 and not has_sigma0:
                    msg = "Calibration provenance metadata is missing or unverified; cannot support certified backscatter claim."
                    failures.append(msg)
                    contradictions.append(msg)
                    c_status = "contradicted"
                    c_reason = msg

            if has_gamma0 and not has_sigma0:
                if any(term in c_text_lower for term in ["sigma-0", "sigma_0", "sigma0", "sigma-naught", "sigma naught"]):
                    msg = "SAR gamma-naught backscatter is mislabeled as sigma-naught without supporting calibration provenance."
                    failures.append(msg)
                    contradictions.append(msg)
                    c_status = "contradicted"
                    c_reason = "Mislabels gamma-naught RTC power as sigma-naught."

            # Check F: Display values conflated with physical measurements & Numerical verification
            if any(term in c_text_lower for term in ["surface reflectance", "boa reflectance", "albedo"]):
                if "db" in c_text_lower:
                    msg = "Surface reflectance is a unitless ratio [0, 1] and cannot be expressed in decibels (dB)."
                    failures.append(msg)
                    contradictions.append(msg)
                    c_status = "contradicted"
                    c_reason = msg

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

            # Numeric verification for SAR linear power
            if any(t in c_text_lower for t in ["linear power", "linear backscatter", "linear gamma"]):
                m_lin = re.search(r'(?:linear (?:gamma(?:-?0| naught)? )?(?:power|backscatter)|linear power|linear backscatter)[^\d]*(\d+\.?\d*)', c_text_lower)
                if not m_lin:
                    m_lin = re.search(r'(\d+\.?\d*)\s*(?:linear power|linear backscatter)', c_text_lower)
                if m_lin:
                    val_lin = float(m_lin.group(1))
                    true_lin = phys_by_name.get("sar_mean_linear_power")
                    if true_lin and isinstance(true_lin.value, (int, float)):
                        actual_lin = float(true_lin.value)
                        if abs(val_lin - actual_lin) > 0.05:
                            msg = f"Claimed linear backscatter ({val_lin}) contradicts verified physical measurement ({actual_lin})."
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

            # Check H: Radiometric Quality Screening & Cloud-Free Claims
            is_cloud_free_claim = any(
                term in c_text_lower for term in [
                    "cloud-free", "cloud free", "cloudless", "clear sky", "clear-sky",
                    "free of clouds", "zero clouds", "no clouds", "completely clear"
                ]
            )
            if is_cloud_free_claim:
                is_negated_cloud = any(neg in c_text_lower for neg in [
                    "not cloud-free", "not cloud free", "not clear", "contains clouds",
                    "partly cloudy", "cloud covered", "cloud obstruction"
                ])
                if not is_negated_cloud:
                    q_data = evidence_package.quality_screening or {}
                    opt_q = q_data.get("optical") if isinstance(q_data, dict) else None
                    if not opt_q or not opt_q.get("screened"):
                        msg = "Claim asserts cloud-free scene, but radiometric quality screening was not performed or SCL data is unavailable."
                        failures.append(msg)
                        contradictions.append(msg)
                        c_status = "unsupported"
                        c_reason = msg
                    else:
                        excl_px = int(opt_q.get("excluded_pixel_count", 0))
                        cloud_px = int(opt_q.get("cloud_pixels", 0))
                        clearance = float(opt_q.get("quality_clearance_fraction", 0.0))
                        has_obstruction = bool(opt_q.get("has_cloud_obstruction", False))
                        if excl_px > 0 or cloud_px > 0 or clearance < 1.0 or has_obstruction:
                            msg = f"Claim asserts cloud-free scene, but radiometric quality screening detected {excl_px} excluded / cloud / shadow pixels (clearance: {round(clearance * 100, 1)}%)."
                            failures.append(msg)
                            contradictions.append(msg)
                            c_status = "contradicted"
                            c_reason = msg

            # Check I: SAR Geometric Layover/Shadow-Free Claims
            is_shadow_free_claim = any(
                term in c_text_lower for term in [
                    "terrain-shadow-free", "terrain shadow free", "free of terrain shadows",
                    "no terrain layover", "shadow-free", "no radar shadow", "no layover or shadow",
                    "free from terrain shadow"
                ]
            )
            if is_shadow_free_claim:
                is_negated_shadow = any(neg in c_text_lower for neg in [
                    "not terrain-shadow-free", "terrain shadow cannot be ruled out",
                    "shadow mask unavailable", "cannot claim terrain-shadow-free"
                ])
                if not is_negated_shadow:
                    msg = "Claim asserts terrain-shadow-free scene, but SAR geometric layover/shadow masking is unavailable from the STAC provider."
                    failures.append(msg)
                    contradictions.append(msg)
                    c_status = "unsupported"
                    c_reason = msg

            # Check J: Calibrated Sentinel-2 B04+B08 NDVI Claims
            is_ndvi_claim = any(
                t in c_text_lower for t in [
                    "ndvi", "normalized difference vegetation index", "vegetation index", "calibrated ndvi", "b04+b08"
                ]
            )
            if is_ndvi_claim:
                # 1. Out-of-bounds or non-finite NDVI values asserted in text
                ndvi_val_matches = re.findall(r'ndvi\s*(?:is|=|of|value\s*(?:is|=|of)?|score\s*(?:is|=|of)?)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)', c_text_lower)
                for nv_str in ndvi_val_matches:
                    try:
                        nv = float(nv_str)
                        if nv < -1.0 or nv > 1.0:
                            msg = f"Claim asserts NDVI value {nv} outside physical bounds [-1.0, 1.0]."
                            failures.append(msg)
                            contradictions.append(msg)
                            c_status = "contradicted"
                            c_reason = msg
                    except ValueError:
                        pass

                # 2. Asserting NDVI in percentage or reflectance units in claim text
                if (re.search(r'ndvi\s*(?:is|=|of)?\s*[+-]?\d+(?:\.\d+)?\s*(?:%|percent|percentage)', c_text_lower) or
                    re.search(r'ndvi\s*(?:is|=|of)?\s*[+-]?\d+(?:\.\d+)?\s*(?:reflectance|surface reflectance)', c_text_lower)):
                    msg = "Claim reports NDVI as percentage or reflectance rather than unitless ratio."
                    failures.append(msg)
                    contradictions.append(msg)
                    c_status = "contradicted"
                    c_reason = msg

                # 3 & 4 & 5. Genuine NDVI claims require B04, B08, and SCL provenance; reject RGB-only pseudo-NDVI
                is_genuine_or_calibrated_claim = any(
                    t in c_text_lower for t in [
                        "genuine ndvi", "calibrated ndvi", "sentinel-2 ndvi", "b04", "b08",
                        "surface-reflectance ndvi", "surface reflectance ndvi", "true ndvi", "measured ndvi"
                    ]
                ) or ("ndvi" in c_text_lower and not any(t in c_text_lower for t in ["pseudo", "heuristic", "rgb visual", "visual approximation", "pseudo-ndvi"]))

                is_rgb_only = False
                has_b04 = False
                has_b08 = False
                has_scl = False

                for asset in evidence_package.source_assets:
                    cat = str(asset.get("asset_category", "")).lower()
                    aid = str(asset.get("id", "")).lower()
                    desc = str(asset.get("description", "")).lower()
                    key = str(asset.get("asset_key", "")).lower()
                    if "rgb" in cat or "visual" in cat or "rgb_visual" in aid or "visual" in aid:
                        is_rgb_only = True
                    if "b04" in aid or "b04" in key or "red" in key or "b04" in desc:
                        has_b04 = True
                    if "b08" in aid or "b08" in key or "nir" in key or "b08" in desc:
                        has_b08 = True
                    if "scl" in aid or "scl" in key or "scl" in desc:
                        has_scl = True

                for art in evidence_package.evidence_artifacts:
                    art_id_l = art.artifact_id.lower()
                    art_type_l = (art.artifact_type or "").lower()
                    art_title_l = (art.title or "").lower()
                    if "b04" in art_id_l or "b04" in art_title_l or "red" in art_title_l:
                        has_b04 = True
                    if "b08" in art_id_l or "b08" in art_title_l or "nir" in art_title_l:
                        has_b08 = True
                    if "scl" in art_id_l or "scl" in art_title_l or "quality_mask" in art_id_l:
                        has_scl = True
                    if "pseudo" in art_id_l or "pseudo" in art_title_l or "rgb_ndvi" in art_id_l or "visual" in art_type_l:
                        is_rgb_only = True

                q_data = evidence_package.quality_screening or {}
                if isinstance(q_data, dict):
                    if q_data.get("optical") or q_data.get("scl") or "clear_mask" in q_data or q_data.get("status") in ("evaluated", "screened") or q_data.get("is_evaluated"):
                        has_scl = True

                for pm in evidence_package.physical_measurements:
                    if "b04" in pm.name.lower() or "red" in pm.name.lower():
                        has_b04 = True
                    if "b08" in pm.name.lower() or "nir" in pm.name.lower():
                        has_b08 = True
                    if "scl" in pm.mask_applied.lower() or "quality" in pm.mask_applied.lower():
                        has_scl = True

                if is_genuine_or_calibrated_claim:
                    if is_rgb_only and not (has_b04 and has_b08):
                        msg = "RGB-only inputs cannot substantiate claims of genuine calibrated NDVI."
                        failures.append(msg)
                        contradictions.append(msg)
                        c_status = "unsupported"
                        c_reason = msg
                    elif not (has_b04 and has_b08):
                        msg = "Genuine NDVI claims require evidence references and provenance for both B04 (Red) and B08 (NIR) inputs."
                        failures.append(msg)
                        contradictions.append(msg)
                        c_status = "unsupported"
                        c_reason = msg
                    elif not has_scl:
                        msg = "Genuine NDVI analysis requires provenance identifying the relevant Scene Classification Layer (SCL) quality mask."
                        failures.append(msg)
                        contradictions.append(msg)
                        c_status = "unsupported"
                        c_reason = msg

                # 6. Zero valid pixels check
                if evidence_package.valid_pixel_count == 0 or (hasattr(evidence_package, "valid_pixel_percentage") and evidence_package.valid_pixel_percentage == 0.0 and evidence_package.total_pixel_count and evidence_package.total_pixel_count > 0):
                    has_numeric_assertion = bool(
                        re.search(r'ndvi\s*(?:is|=|of)?\s*[+-]?\d+(?:\.\d+)?', c_text_lower) or
                        re.search(r'(?:mean|average|p90)\s*ndvi', c_text_lower) or
                        "vegetation coverage" in c_text_lower
                    )
                    is_disclaiming_zero = any(t in c_text_lower for t in ["zero valid", "no valid pixels", "unsupported", "cannot be calculated", "none"])
                    if has_numeric_assertion and not is_disclaiming_zero:
                        msg = "A zero-valid-pixel result cannot support numeric NDVI statistics or vegetation claims."
                        failures.append(msg)
                        contradictions.append(msg)
                        c_status = "unsupported"
                        c_reason = msg

            # Check K: Sentinel-1 RTC Dual-Polarization (VV + VH) & DpRVI Claims
            is_dprvi_claim = any(
                t in c_text_lower for t in [
                    "dprvi", "dual-pol radar vegetation index", "dual-polarimetric radar vegetation index",
                    "radar vegetation index", "dual-pol rvi", "cross-polarization ratio", "cross-pol ratio"
                ]
            )
            if is_dprvi_claim:
                # 1. Out-of-bounds DpRVI values in claim text (valid physical range [0.0, 1.0])
                dprvi_val_matches = re.findall(r'dprvi\s*(?:is|=|of|value\s*(?:is|=|of)?|score\s*(?:is|=|of)?)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)', c_text_lower)
                for dv_str in dprvi_val_matches:
                    try:
                        dv = float(dv_str)
                        if dv < 0.0 or dv > 1.0:
                            msg = f"Claim asserts DpRVI value {dv} outside physical bounds [0.0, 1.0]."
                            failures.append(msg)
                            contradictions.append(msg)
                            c_status = "contradicted"
                            c_reason = msg
                    except ValueError:
                        pass

                # 2. Asserting DpRVI in invalid units (percentage, dB, reflectance, linear power)
                if (re.search(r'dprvi\s*(?:is|=|of)?\s*[+-]?\d+(?:\.\d+)?\s*(?:%|percent|percentage)', c_text_lower) or
                    re.search(r'dprvi\s*(?:is|=|of)?\s*[+-]?\d+(?:\.\d+)?\s*(?:db|decibels)', c_text_lower) or
                    re.search(r'dprvi\s*(?:is|=|of)?\s*[+-]?\d+(?:\.\d+)?\s*(?:reflectance|surface reflectance)', c_text_lower) or
                    re.search(r'dprvi\s*(?:is|=|of)?\s*[+-]?\d+(?:\.\d+)?\s*(?:m\^2/m\^2|m2/m2)', c_text_lower)):
                    msg = "Claim reports DpRVI in invalid units (% / dB / reflectance / m^2/m^2) rather than unitless ratio [0, 1]."
                    failures.append(msg)
                    contradictions.append(msg)
                    c_status = "contradicted"
                    c_reason = msg

                # 3. Dual-polarization completeness: DpRVI requires both VV and VH inputs
                has_vv = False
                has_vh = False
                for asset in evidence_package.source_assets:
                    aid = str(asset.get("id", "")).lower()
                    desc = str(asset.get("description", "")).lower()
                    key = str(asset.get("asset_key", "")).lower()
                    pol = str(asset.get("polarization", "")).lower()
                    if "vv" in aid or "vv" in key or "vv" in desc or "vv" in pol:
                        has_vv = True
                    if "vh" in aid or "vh" in key or "vh" in desc or "vh" in pol:
                        has_vh = True
                    if "dual_vv_vh" in pol or "dual" in pol:
                        has_vv = True
                        has_vh = True

                for art in evidence_package.evidence_artifacts:
                    art_id_l = art.artifact_id.lower()
                    art_title_l = (art.title or "").lower()
                    if "vv" in art_id_l or "vv" in art_title_l:
                        has_vv = True
                    if "vh" in art_id_l or "vh" in art_title_l:
                        has_vh = True
                    if "dprvi" in art_id_l or "dprvi" in art_title_l:
                        has_vv = True
                        has_vh = True

                for pm in evidence_package.physical_measurements:
                    pm_l = pm.name.lower()
                    if "vv" in pm_l:
                        has_vv = True
                    if "vh" in pm_l:
                        has_vh = True
                    if "dprvi" in pm_l:
                        has_vv = True
                        has_vh = True

                # If claim asserts DpRVI but evidence package is single-pol (e.g., only VV or only VH)
                if not (has_vv and has_vh):
                    msg = "DpRVI dual-polarization analysis requires evidence and provenance for both VV and VH channels; single-pol data cannot support DpRVI."
                    failures.append(msg)
                    contradictions.append(msg)
                    c_status = "unsupported"
                    c_reason = msg

                # 4. Zero valid pixels check
                if evidence_package.valid_pixel_count == 0 or (hasattr(evidence_package, "valid_pixel_percentage") and evidence_package.valid_pixel_percentage == 0.0 and evidence_package.total_pixel_count and evidence_package.total_pixel_count > 0):
                    has_numeric_assertion = bool(
                        re.search(r'dprvi\s*(?:is|=|of)?\s*[+-]?\d+(?:\.\d+)?', c_text_lower) or
                        re.search(r'(?:mean|average|p90)\s*dprvi', c_text_lower) or
                        "radar vegetation" in c_text_lower
                    )
                    is_disclaiming_zero = any(t in c_text_lower for t in ["zero valid", "no valid pixels", "unsupported", "cannot be calculated", "none"])
                    if has_numeric_assertion and not is_disclaiming_zero:
                        msg = "A zero-valid-pixel SAR result cannot support numeric DpRVI statistics or radar canopy claims."
                        failures.append(msg)
                        contradictions.append(msg)
                        c_status = "unsupported"
                        c_reason = msg

                # 5. Scientific distinction: DpRVI cannot claim to measure optical chlorophyll
                if any(t in c_text_lower for t in ["chlorophyll", "photosynthetic", "pigment absorption"]):
                    msg = "DpRVI characterizes radar microwave volume scattering randomness (Mandal et al., 2020); it cannot be claimed as a direct measure of optical chlorophyll."
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

        # 5. Valid pixel count & Quality Screening
        valid_px = reg_info.get("valid_pixels") or meta.get("valid_pixel_count")
        total_px = reg_info.get("total_pixels") or meta.get("total_pixels")
        valid_pct = reg_info.get("valid_percentage")
        if valid_pct is None and valid_px and total_px:
            valid_pct = round((valid_px / total_px) * 100.0, 2)

        # Quality screening provenance
        q_screen = meta.get("quality_screening") or opt_sar_meta.get("quality_screening")
        opt_screened = bool(q_screen and q_screen.get("optical", {}).get("screened"))
        sar_screened = bool(q_screen and q_screen.get("sar", {}).get("screened"))
        opt_mask_name = "joint_screened_quality_mask" if opt_screened else "joint_valid_mask"
        sar_mask_name = "joint_screened_quality_mask" if sar_screened else "joint_valid_mask"

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
                mask_applied=opt_mask_name,
                calibration_quantity="boa_surface_reflectance"
            ))

        # Optical Calibrated NDVI (Sentinel-2 B04 + B08)
        ndvi_info = meta.get("ndvi_result") or meta.get("ndvi") or opt_sar_meta.get("ndvi") or opt_sar_meta.get("ndvi_result")
        if isinstance(ndvi_info, dict):
            ndvi_mean = ndvi_info.get("ndvi_mean")
            ndvi_p90 = ndvi_info.get("ndvi_p90")
            ndvi_status = ndvi_info.get("status")
            scl_applied = bool(ndvi_info.get("validity_policy", {}).get("scl_mask_applied") or opt_screened)
            ndvi_mask_name = "scl_screened_valid_mask" if scl_applied else "valid_pixel_mask"

            if ndvi_status != "unsupported_zero_valid_pixels":
                if ndvi_mean is not None:
                    physical_measurements.append(PhysicalMeasurementItem(
                        name="optical_mean_ndvi",
                        value=ndvi_mean,
                        unit="unitless ratio [-1, 1]",
                        statistic_type="mean",
                        mask_applied=ndvi_mask_name,
                        calibration_quantity="normalized_difference_vegetation_index"
                    ))
                if ndvi_p90 is not None:
                    physical_measurements.append(PhysicalMeasurementItem(
                        name="optical_p90_ndvi",
                        value=ndvi_p90,
                        unit="unitless ratio [-1, 1]",
                        statistic_type="90th percentile",
                        mask_applied=ndvi_mask_name,
                        calibration_quantity="normalized_difference_vegetation_index"
                    ))

        # SAR linear power
        sar_lin = opt_sar_meta.get("sar_mean_linear_power")
        if sar_lin is not None:
            physical_measurements.append(PhysicalMeasurementItem(
                name="sar_mean_linear_power",
                value=sar_lin,
                unit="linear power (m^2/m^2)",
                statistic_type="mean",
                mask_applied=sar_mask_name,
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

        # Calibrated Sentinel-1 RTC Dual-Polarization (VV + VH) & DpRVI
        dprvi_info = meta.get("dprvi_result") or meta.get("dprvi") or opt_sar_meta.get("dprvi_result") or opt_sar_meta.get("dprvi")
        if isinstance(dprvi_info, dict):
            dprvi_mean = dprvi_info.get("dprvi_mean")
            dprvi_p90 = dprvi_info.get("dprvi_p90")
            q_lin = dprvi_info.get("cross_pol_ratio_linear")
            q_db = dprvi_info.get("cross_pol_ratio_db")
            vv_lin = dprvi_info.get("vv_mean_linear")
            vh_lin = dprvi_info.get("vh_mean_linear")
            vv_db = dprvi_info.get("vv_mean_db")
            vh_db = dprvi_info.get("vh_mean_db")
            dprvi_status = dprvi_info.get("status")
            sar_dprvi_mask = "sar_rtc_valid_mask"

            if dprvi_status != "unsupported_zero_valid_pixels":
                if dprvi_mean is not None:
                    physical_measurements.append(PhysicalMeasurementItem(
                        name="sar_mean_dprvi",
                        value=dprvi_mean,
                        unit="unitless ratio [0, 1]",
                        statistic_type="mean",
                        mask_applied=sar_dprvi_mask,
                        calibration_quantity="dual_polarimetric_radar_vegetation_index"
                    ))
                if dprvi_p90 is not None:
                    physical_measurements.append(PhysicalMeasurementItem(
                        name="sar_p90_dprvi",
                        value=dprvi_p90,
                        unit="unitless ratio [0, 1]",
                        statistic_type="90th percentile",
                        mask_applied=sar_dprvi_mask,
                        calibration_quantity="dual_polarimetric_radar_vegetation_index"
                    ))
                if q_lin is not None:
                    physical_measurements.append(PhysicalMeasurementItem(
                        name="sar_cross_pol_ratio_linear",
                        value=q_lin,
                        unit="unitless ratio",
                        statistic_type="mean linear cross-pol ratio (VH/VV)",
                        mask_applied=sar_dprvi_mask,
                        calibration_quantity="cross_polarization_ratio"
                    ))
                if q_db is not None:
                    physical_measurements.append(PhysicalMeasurementItem(
                        name="sar_cross_pol_ratio_db",
                        value=q_db,
                        unit="dB",
                        statistic_type="10*log10(mean cross-pol ratio)",
                        mask_applied=sar_dprvi_mask,
                        calibration_quantity="cross_polarization_ratio"
                    ))
                if vv_lin is not None:
                    physical_measurements.append(PhysicalMeasurementItem(
                        name="sar_vv_mean_linear_power",
                        value=vv_lin,
                        unit="linear power (m^2/m^2)",
                        statistic_type="mean linear power",
                        mask_applied=sar_dprvi_mask,
                        calibration_quantity="gamma0"
                    ))
                if vh_lin is not None:
                    physical_measurements.append(PhysicalMeasurementItem(
                        name="sar_vh_mean_linear_power",
                        value=vh_lin,
                        unit="linear power (m^2/m^2)",
                        statistic_type="mean linear power",
                        mask_applied=sar_dprvi_mask,
                        calibration_quantity="gamma0"
                    ))
                if vv_db is not None:
                    physical_measurements.append(PhysicalMeasurementItem(
                        name="sar_vv_mean_to_db",
                        value=vv_db,
                        unit="dB",
                        statistic_type="10*log10(mean power)",
                        mask_applied=sar_dprvi_mask,
                        calibration_quantity="gamma0"
                    ))
                if vh_db is not None:
                    physical_measurements.append(PhysicalMeasurementItem(
                        name="sar_vh_mean_to_db",
                        value=vh_db,
                        unit="dB",
                        statistic_type="10*log10(mean power)",
                        mask_applied=sar_dprvi_mask,
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

        if isinstance(ndvi_info, dict) and ndvi_info.get("status") != "unsupported_zero_valid_pixels":
            veg_pct = ndvi_info.get("vegetation_coverage_pct")
            veg_px = ndvi_info.get("vegetation_pixel_count")
            if veg_pct is not None:
                heuristics.append(HeuristicIndicatorItem(
                    name="calibrated_vegetation_coverage",
                    percentage=float(veg_pct),
                    pixel_count=int(veg_px or 0),
                    definition="Valid pixels with calibrated Sentinel-2 B04+B08 NDVI >= 0.40",
                    is_certified_classification=False,
                    limitations="Vegetation proxy based on BOA surface reflectance NDVI threshold 0.40; not certified species classification."
                ))

        if isinstance(dprvi_info, dict) and dprvi_info.get("status") != "unsupported_zero_valid_pixels":
            sar_veg_pct = dprvi_info.get("vegetation_proxy_coverage_pct")
            sar_veg_px = dprvi_info.get("veg_pixel_count")
            sar_thresh = float(dprvi_info.get("vegetation_threshold", 0.45))
            if sar_veg_pct is not None:
                heuristics.append(HeuristicIndicatorItem(
                    name="radar_vegetation_volume_coverage",
                    percentage=float(sar_veg_pct),
                    pixel_count=int(sar_veg_px or 0),
                    definition=f"Valid pixels with Sentinel-1 RTC DpRVI >= {sar_thresh:.2f}",
                    is_certified_classification=False,
                    limitations=f"Radar volume scattering proxy based on DpRVI threshold {sar_thresh:.2f}; not certified botanical classification or optical chlorophyll NDVI."
                ))

        # 9. Evidence Artifacts
        evidence_artifacts = []
        if isinstance(ndvi_info, dict) and ndvi_info.get("preview_base64"):
            evidence_artifacts.append(EvidenceArtifactItem(
                artifact_id="ev_optical_ndvi_map",
                artifact_type="raster_index",
                title="Sentinel-2 Calibrated NDVI Map",
                description="Calibrated Sentinel-2 B04/B08 NDVI surface reflectance map screened with SCL mask",
                statistics={
                    "mean": ndvi_info.get("ndvi_mean"),
                    "p90": ndvi_info.get("ndvi_p90"),
                    "vegetation_coverage_pct": ndvi_info.get("vegetation_coverage_pct")
                }
            ))
        if isinstance(dprvi_info, dict) and (dprvi_info.get("preview_base64") or dprvi_info.get("colorized_preview_base64")):
            evidence_artifacts.append(EvidenceArtifactItem(
                artifact_id="ev_sar_dprvi_map",
                artifact_type="raster_index",
                title="Sentinel-1 Calibrated DpRVI Map",
                description="Calibrated Sentinel-1 RTC VV/VH DpRVI dual-polarization radar vegetation index map",
                statistics={
                    "mean": dprvi_info.get("dprvi_mean"),
                    "p90": dprvi_info.get("dprvi_p90"),
                    "cross_pol_ratio_db": dprvi_info.get("cross_pol_ratio_db"),
                    "vegetation_proxy_coverage_pct": dprvi_info.get("vegetation_proxy_coverage_pct")
                }
            ))
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
            quality_screening=q_screen,
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
            if not det_passed:
                supp_c = sum(1 for c in evaluated_claims if c.status == "supported")
                fallback_status = "partially_supported" if supp_c > 0 else "unsupported"
            else:
                fallback_status = "not_run"

            summary = (
                "Deterministic scientific-integrity checks completed successfully. "
                "LLM interpretive verification was not run because the local LLM service is offline or unreachable."
                if det_passed else
                f"Deterministic scientific-integrity check failed with {len(det_failures)} violation(s). "
                "LLM verification was not run because the local LLM service is offline or unreachable."
            )
            return VerificationResponseSchema(
                verification_status=fallback_status,
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
                c_item.cited_artifact_ids = list(dict.fromkeys(cleaned_cited))

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

            # Step 5: Enforce Non-Overridable Deterministic Gate & Claim-Level Aggregation
            valid_statuses = {"supported", "partially_supported", "unsupported", "contradicted"}
            for c in final_claims:
                if c.status not in valid_statuses:
                    c.status = "unsupported"
                    c.reason = (c.reason or "") + " [Normalized from invalid status string]"

            supported_count = sum(1 for c in final_claims if c.status == "supported")
            contradicted_count = sum(1 for c in final_claims if c.status == "contradicted")
            unsupported_count = sum(1 for c in final_claims if c.status == "unsupported")

            if not det_passed:
                if supported_count == 0:
                    final_status = "unsupported"
                else:
                    final_status = "partially_supported"
                # Ensure all deterministic failures are in contradictions
                for f in det_failures:
                    if f not in llm_contradictions:
                        llm_contradictions.insert(0, f)
            else:
                # Deterministic checks passed; aggregate based on claim evaluations
                if not final_claims:
                    final_status = "not_run" if not candidate_claims else "unsupported"
                elif supported_count == len(final_claims) and contradicted_count == 0 and unsupported_count == 0:
                    final_status = "supported" if llm_status == "supported" else llm_status
                elif supported_count > 0:
                    final_status = "partially_supported"
                else:
                    final_status = "unsupported"

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
            if not det_passed:
                supp_c = sum(1 for c in evaluated_claims if c.status == "supported")
                fallback_status = "partially_supported" if supp_c > 0 else "unsupported"
            else:
                fallback_status = "not_run"

            return VerificationResponseSchema(
                verification_status=fallback_status,
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
            if not det_passed:
                supp_c = sum(1 for c in evaluated_claims if c.status == "supported")
                fallback_status = "partially_supported" if supp_c > 0 else "unsupported"
            else:
                fallback_status = "not_run"

            # Malformed output or unexpected error must NOT be treated as successful verification
            return VerificationResponseSchema(
                verification_status=fallback_status,
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
