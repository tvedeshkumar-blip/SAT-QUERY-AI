"""
Stage 8: Scientific Analysis Quality and Evidence Reporting.
Builds structured, reproducible, schema-validated analysis reports
strictly preserving physical measurements, unit scales, verification outcomes,
and honest representation of unavailable provenance.
"""

import logging
from typing import Any, Dict, List, Optional, Union
from datetime import datetime

from app.schemas.report import (
    PhysicalMeasurementReportItem,
    ReportEvidenceArtifactItem,
    ReportProvenanceSchema,
    ReportReproducibilitySchema,
    ReportVerificationSummarySchema,
    ScientificReportSchema,
)
from app.schemas.verification import (
    EvidencePackageSchema,
    PhysicalMeasurementItem,
    DisplayStatisticItem,
    HeuristicIndicatorItem,
    VerificationResponseSchema,
)
from app.agent.verifier import EvidencePackageBuilder

logger = logging.getLogger("satquery.reports.scientific")


class ScientificReportBuilder:
    """
    Constructs an audit-grade, schema-validated ScientificReportSchema from
    an analysis response and optional evidence package.
    """

    @staticmethod
    def build_report(
        analysis_response: Union[Dict[str, Any], Any],
        evidence_package: Optional[EvidencePackageSchema] = None,
    ) -> ScientificReportSchema:
        """
        Builds a reproducible ScientificReportSchema.
        Deterministic for identical input data.
        """
        # Convert response to dictionary safely
        if hasattr(analysis_response, "model_dump"):
            resp_data = analysis_response.model_dump()
        elif hasattr(analysis_response, "dict"):
            resp_data = analysis_response.dict()
        elif isinstance(analysis_response, dict):
            resp_data = analysis_response
        else:
            resp_data = getattr(analysis_response, "__dict__", {})

        analysis_id = str(resp_data.get("id") or "analysis_unknown")
        task = str(resp_data.get("task") or "general")
        query = str(resp_data.get("query") or (resp_data.get("answer", "")[:120]))
        mode = str(resp_data.get("mode") or "auto")
        created_at = str(resp_data.get("created_at") or (datetime.utcnow().isoformat() + "Z"))
        answer_text = str(resp_data.get("answer") or "No analysis answer text recorded.")
        metadata = resp_data.get("metadata") or {}

        # 1. Build or retrieve EvidencePackageSchema
        if evidence_package is None:
            try:
                evidence_package = EvidencePackageBuilder.from_analysis_response(resp_data, raw_metadata=metadata)
            except Exception as e:
                logger.warning(f"Could not build evidence package from response: {e}")
                evidence_package = None

        # Track explicitly unavailable or missing fields
        unavailable_fields: List[str] = []

        # 2. Extract Provenance
        sensor_identities = []
        source_asset_ids = []
        acquisition_timestamps = []
        crs = None
        spatial_resolution = None
        dimensions = None
        registration_status: Dict[str, Any] = {}
        valid_pixel_count = None
        total_pixel_count = None
        valid_pixel_percentage = None

        if evidence_package:
            sensor_identities = list(evidence_package.sensor_identities)
            source_asset_ids = [str(a.get("id", "asset")) for a in evidence_package.source_assets]
            acquisition_timestamps = list(evidence_package.acquisition_timestamps)
            crs = evidence_package.crs
            spatial_resolution = evidence_package.resolution
            dimensions = evidence_package.dimensions
            registration_status = dict(evidence_package.registration_status)
            valid_pixel_count = evidence_package.valid_pixel_count
            total_pixel_count = evidence_package.total_pixel_count
            valid_pixel_percentage = evidence_package.valid_pixel_percentage
        else:
            if metadata.get("sensor"):
                sensor_identities.append(str(metadata["sensor"]))
            if metadata.get("id"):
                source_asset_ids.append(str(metadata["id"]))
            if metadata.get("datetime"):
                acquisition_timestamps.append(str(metadata["datetime"]))
            crs = metadata.get("crs")
            spatial_resolution = metadata.get("resolution")
            dimensions = f"{metadata.get('width', '')}x{metadata.get('height', '')}" if metadata.get("width") else None

        # Check for unavailable fields honestly
        if not sensor_identities:
            unavailable_fields.append("sensor_identities: not provided in source metadata")
        if not source_asset_ids:
            unavailable_fields.append("source_asset_ids: unverified catalog assets")
        if not acquisition_timestamps:
            unavailable_fields.append("acquisition_timestamps: unprovided in source metadata")
        if not crs:
            unavailable_fields.append("crs: missing or unprojected local image coordinates")
        if spatial_resolution is None:
            unavailable_fields.append("spatial_resolution_m: uncalibrated ground sample distance")
        if dimensions is None or dimensions == "x":
            unavailable_fields.append("dimensions: raster dimensions not recorded")
        if not registration_status:
            unavailable_fields.append("registration_status: multi-sensor co-registration unperformed or unrecorded")

        # Provider info
        provider_name = str(resp_data.get("primary_model") or resp_data.get("actual_model_used") or "SatQueryAgent")
        actual_model_used = resp_data.get("actual_model_used")
        fallback_used = bool(resp_data.get("fallback_used", False))
        model_status = resp_data.get("model_status")
        is_trained_model = False

        if evidence_package and evidence_package.provider_info:
            prov_info = evidence_package.provider_info
            provider_name = prov_info.provider_name or provider_name
            actual_model_used = prov_info.actual_model_used or actual_model_used
            fallback_used = prov_info.fallback_used
            is_trained_model = prov_info.is_trained_model
            model_status = prov_info.model_status or model_status

        provenance = ReportProvenanceSchema(
            analysis_id=analysis_id,
            task=task,
            query=query,
            mode=mode,
            created_at=created_at,
            sensor_identities=sensor_identities,
            source_asset_ids=source_asset_ids,
            acquisition_timestamps=acquisition_timestamps,
            crs=crs,
            spatial_resolution_m=spatial_resolution,
            dimensions=dimensions,
            registration_status=registration_status,
            valid_pixel_count=valid_pixel_count,
            total_pixel_count=total_pixel_count,
            valid_pixel_percentage=valid_pixel_percentage,
            provider_name=provider_name,
            actual_model_used=actual_model_used,
            fallback_used=fallback_used,
            is_trained_model=is_trained_model,
            model_status=model_status,
        )

        # 3. Physical Measurements
        physical_measurements: List[PhysicalMeasurementReportItem] = []
        valid_artifact_ids = set()

        if evidence_package:
            valid_artifact_ids = {a.artifact_id for a in evidence_package.evidence_artifacts}
            for pm in evidence_package.physical_measurements:
                # Map source artifact ID based on measurement modality
                matched_art_ids = []
                name_l = pm.name.lower()
                cal_l = str(pm.calibration_quantity or "").lower()
                if "optical" in name_l or "reflectance" in name_l or "boa" in cal_l:
                    if "optical_input" in valid_artifact_ids:
                        matched_art_ids.append("optical_input")
                if "sar" in name_l or "power" in name_l or "gamma" in cal_l or "sigma" in cal_l:
                    if "sar_input" in valid_artifact_ids:
                        matched_art_ids.append("sar_input")
                if not matched_art_ids and valid_artifact_ids:
                    # If specific modality not matched, leave empty or link joint mask if applicable
                    if "mask" in pm.mask_applied.lower() and pm.mask_applied in valid_artifact_ids:
                        matched_art_ids.append(pm.mask_applied)

                physical_measurements.append(PhysicalMeasurementReportItem(
                    name=pm.name,
                    value=pm.value,
                    unit=pm.unit,
                    statistic_type=pm.statistic_type,
                    calibration_quantity=pm.calibration_quantity,
                    mask_applied=pm.mask_applied,
                    source_artifact_ids=matched_art_ids
                ))

        # 4. Display Statistics (Visualization Only)
        display_statistics: List[DisplayStatisticItem] = []
        if evidence_package:
            display_statistics = list(evidence_package.display_statistics)

        # 5. Heuristic Indicators (Never certified classifications)
        heuristic_indicators: List[HeuristicIndicatorItem] = []
        if evidence_package:
            for hi in evidence_package.heuristic_indicators:
                # Strictly enforce is_certified_classification is False
                heuristic_indicators.append(HeuristicIndicatorItem(
                    name=hi.name,
                    percentage=hi.percentage,
                    pixel_count=hi.pixel_count,
                    definition=hi.definition,
                    is_certified_classification=False,
                    limitations=hi.limitations
                ))

        # 6. Evidence Artifacts
        evidence_artifacts: List[ReportEvidenceArtifactItem] = []
        if evidence_package and evidence_package.evidence_artifacts:
            for ea in evidence_package.evidence_artifacts:
                evidence_artifacts.append(ReportEvidenceArtifactItem(
                    artifact_id=ea.artifact_id,
                    artifact_type=ea.artifact_type,
                    title=ea.title,
                    description=ea.description,
                    statistics=ea.statistics or {}
                ))
        elif resp_data.get("evidence"):
            for ev in resp_data["evidence"]:
                evidence_artifacts.append(ReportEvidenceArtifactItem(
                    artifact_id=ev.get("id", "artifact"),
                    artifact_type=ev.get("type", "processed"),
                    title=ev.get("title", "Evidence Artifact"),
                    description=ev.get("description"),
                    statistics=ev.get("statistics") or {}
                ))

        # 7. Verification Summary
        verification_summary: Optional[ReportVerificationSummarySchema] = None
        verif_raw = resp_data.get("verification")
        if isinstance(verif_raw, dict):
            try:
                v_obj = VerificationResponseSchema(**verif_raw)
            except Exception:
                v_obj = None
        elif isinstance(verif_raw, VerificationResponseSchema):
            v_obj = verif_raw
        else:
            v_obj = None

        if v_obj:
            verification_summary = ReportVerificationSummarySchema(
                verification_status=v_obj.verification_status,
                deterministic_passed=v_obj.deterministic_passed,
                deterministic_failures=list(v_obj.deterministic_failures),
                claims=list(v_obj.claims),
                contradictions=list(v_obj.contradictions),
                unsupported_claims=list(v_obj.unsupported_claims),
                missing_evidence=list(v_obj.missing_evidence),
                scientific_limitations=list(v_obj.scientific_limitations),
                recommended_checks=list(v_obj.recommended_checks),
                is_interpretive_only=v_obj.is_interpretive_only,
                interpretive_statement=v_obj.interpretive_statement,
                summary_explanation=v_obj.summary_explanation,
            )

        # 8. Reproducibility
        trace_data = resp_data.get("trace") or {}
        trace_steps_raw = trace_data.get("steps") or []
        pipeline_steps = []
        for step in trace_steps_raw:
            if isinstance(step, dict) and step.get("step"):
                pipeline_steps.append(str(step["step"]))
            elif hasattr(step, "step"):
                pipeline_steps.append(str(step.step))

        reproducibility = ReportReproducibilitySchema(
            software_version="SatQuery-AI v1.0.0 (ISRO PS 26167 Stage 8 Scientific Reporting)",
            provider_config={
                "provider_name": provider_name,
                "fallback_activated": fallback_used,
                "trained_weights_present": is_trained_model,
                "mode": mode,
            },
            pipeline_steps=pipeline_steps,
            unavailable_fields=unavailable_fields,
        )

        return ScientificReportSchema(
            report_id=f"report_{analysis_id}",
            report_version="1.0.0",
            generated_at=created_at,
            provenance=provenance,
            physical_measurements=physical_measurements,
            display_statistics=display_statistics,
            heuristic_indicators=heuristic_indicators,
            evidence_artifacts=evidence_artifacts,
            verification_summary=verification_summary,
            reproducibility=reproducibility,
            executive_summary=answer_text,
        )


def generate_scientific_markdown(report: ScientificReportSchema) -> str:
    """
    Renders a validated ScientificReportSchema as a formal Markdown document.
    """
    prov = report.provenance
    verif = report.verification_summary

    lines: List[str] = []
    lines.append(f"# SAT-QUERY-AI — Scientific Analysis & Verification Report")
    lines.append("")
    lines.append(f"**Report ID:** `{report.report_id}` | **Generated:** `{report.generated_at}`")
    lines.append(f"**Software:** {report.reproducibility.software_version}")
    lines.append("")
    lines.append("> [!NOTE]")
    lines.append(f"> {report.integrity_notice}")
    lines.append("")

    # Provenance
    lines.append("## 1. Analysis Provenance & Geometry")
    lines.append("")
    lines.append("| Parameter | Value | Parameter | Value |")
    lines.append("| :--- | :--- | :--- | :--- |")
    lines.append(f"| **Analysis ID** | `{prov.analysis_id}` | **Task Classification** | `{prov.task}` |")
    lines.append(f"| **Operational Mode** | `{prov.mode}` | **Coordinate System (CRS)** | `{prov.crs or 'Not Provided'}` |")
    lines.append(f"| **Spatial Resolution** | `{prov.spatial_resolution_m or 'Uncalibrated'}` | **Raster Dimensions** | `{prov.dimensions or 'Not Specified'}` |")
    reg_val = "True (Verified)" if prov.registration_status.get("co_registered") else "False / Unperformed"
    lines.append(f"| **Co-Registration** | `{reg_val}` | **Valid Pixel Footprint** | `{prov.valid_pixel_percentage or 'N/A'}%` (`{prov.valid_pixel_count or 'N/A'}` px) |")
    lines.append(f"| **Provider Engine** | `{prov.provider_name}` | **Model Status** | `{prov.model_status or 'baseline'}` (Fallback: `{prov.fallback_used}`) |")
    lines.append(f"| **Sensor Identities** | `{', '.join(prov.sensor_identities) or 'None'}` | **Acquisition Datetimes** | `{', '.join(prov.acquisition_timestamps) or 'None'}` |")
    lines.append("")

    # Executive Synthesis
    lines.append("## 2. Executive Synthesis & Findings")
    lines.append("")
    lines.append(report.executive_summary)
    lines.append("")

    # Calibrated Physical Measurements
    lines.append("## 3. Calibrated Physical Measurements")
    lines.append("")
    if report.physical_measurements:
        lines.append("| Measurement | Value | Unit | Statistic Type | Mask Applied | Supporting Artifacts |")
        lines.append("| :--- | :---: | :--- | :--- | :--- | :--- |")
        for pm in report.physical_measurements:
            arts = ", ".join(f"`{a}`" for a in pm.source_artifact_ids) if pm.source_artifact_ids else "None"
            lines.append(f"| **{pm.name}** | `{pm.value}` | `{pm.unit}` | {pm.statistic_type} | `{pm.mask_applied}` | {arts} |")
    else:
        lines.append("*No calibrated physical measurements available in this analysis package.*")
    lines.append("")

    # Display Statistics (Visualization Only)
    lines.append("## 4. Normalized Display Statistics (Visualization Only)")
    lines.append("")
    lines.append("> [!IMPORTANT]")
    lines.append("> Display statistics are 8-bit normalized or percentile-stretched arrays generated exclusively for screen rendering. They MUST NOT be conflated with calibrated physical radiometry.")
    lines.append("")
    if report.display_statistics:
        lines.append("| Display Statistic | Render Value | Scale | Purpose |")
        lines.append("| :--- | :---: | :--- | :--- |")
        for ds in report.display_statistics:
            lines.append(f"| **{ds.name}** | `{ds.value}` | {ds.scale} | `{ds.purpose}` |")
    else:
        lines.append("*No separate display statistics recorded.*")
    lines.append("")

    # Heuristic Indicators
    lines.append("## 5. Preliminary Heuristic Indicators")
    lines.append("")
    lines.append("> [!WARNING]")
    lines.append("> Heuristic indicators are uncalibrated empirical threshold proxies. They are NOT certified land-cover classifications or ground truth.")
    lines.append("")
    if report.heuristic_indicators:
        lines.append("| Indicator | Extent (%) | Pixel Count | Empirical Threshold | Certified Classification? |")
        lines.append("| :--- | :---: | :---: | :--- | :---: |")
        for hi in report.heuristic_indicators:
            cert_str = "YES" if hi.is_certified_classification else "**NO (Proxy Only)**"
            lines.append(f"| **{hi.name}** | `{hi.percentage}%` | `{hi.pixel_count}` | `{hi.definition}` | {cert_str} |")
    else:
        lines.append("*No heuristic indicators computed for this query.*")
    lines.append("")

    # Evidence Artifacts
    lines.append("## 6. Generated Evidence Artifacts")
    lines.append("")
    if report.evidence_artifacts:
        lines.append("| Artifact ID | Type | Title | Summary Statistics |")
        lines.append("| :--- | :--- | :--- | :--- |")
        for ea in report.evidence_artifacts:
            stats_str = ", ".join(f"{k}: {v}" for k, v in ea.statistics.items()) if ea.statistics else "Visual"
            lines.append(f"| `{ea.artifact_id}` | `{ea.artifact_type}` | {ea.title} | {stats_str} |")
    else:
        lines.append("*No visual evidence artifacts generated.*")
    lines.append("")

    # Scientific Verification Summary
    lines.append("## 7. Evidence-Grounded Scientific Verification")
    lines.append("")
    if verif:
        status_badge = verif.verification_status.upper()
        lines.append(f"**Verification Status:** `{status_badge}` | **Deterministic Checks Passed:** `{verif.deterministic_passed}`")
        lines.append("")
        lines.append(f"**Summary:** {verif.summary_explanation}")
        lines.append("")

        if verif.claims:
            lines.append("### Evaluated Scientific Claims")
            lines.append("")
            lines.append("| Claim | Outcome | Cited Artifacts | Justification / Contradiction Reason |")
            lines.append("| :--- | :---: | :--- | :--- |")
            for c in verif.claims:
                cited = ", ".join(f"`{a}`" for a in c.cited_artifact_ids) if c.cited_artifact_ids else "None"
                reason_clean = (c.reason or "Verified against evidence package.").replace("\n", " ")
                lines.append(f"| {c.claim_text} | **`{c.status.upper()}`** | {cited} | {reason_clean} |")
            lines.append("")

        if verif.contradictions:
            lines.append("### Contradictions Identified")
            lines.append("")
            for con in verif.contradictions:
                lines.append(f"- ❌ {con}")
            lines.append("")

        if verif.scientific_limitations:
            lines.append("### Scientific Caveats & Limitations")
            lines.append("")
            for lim in verif.scientific_limitations:
                lines.append(f"- ⚠️ {lim}")
            lines.append("")
    else:
        lines.append("*Stage 7 verification was not executed for this run.*")
    lines.append("")

    # Reproducibility & Traceability
    lines.append("## 8. Reproducibility & Pipeline Traceability")
    lines.append("")
    rep = report.reproducibility
    if rep.pipeline_steps:
        lines.append(f"**Execution Pipeline Steps:** `{ ' → '.join(rep.pipeline_steps) }`")
        lines.append("")
    if rep.unavailable_fields:
        lines.append("### Unavailable / Unprovided Metadata Fields")
        lines.append("")
        for uf in rep.unavailable_fields:
            lines.append(f"- `{uf}`")
        lines.append("")
    else:
        lines.append("*All required pipeline metadata fields were observed and verified.*")
        lines.append("")

    lines.append("---")
    lines.append("*Report generated autonomously by SatQuery AI Multimodal Architecture (ISRO PS 26167).*")
    return "\n".join(lines)
