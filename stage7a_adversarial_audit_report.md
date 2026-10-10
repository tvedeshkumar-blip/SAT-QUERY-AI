# SAT-QUERY-AI — Stage 7A: Adversarial Scientific Verification Audit Report

## Executive Summary

This report documents the security and scientific-integrity audit of the Stage 7 Evidence-Grounded LLM Scientific Verification subsystem. An adversarial test suite was designed to probe for false acceptance, false rejection, fabricated evidence references, scientific-unit confusion, deterministic gate bypassing, and failure handling under abnormal inputs.

The audit revealed 11 concrete vulnerabilities in the initial Stage 7 implementation where adversarial claims could bypass verification. A targeted, minimal remediation was implemented in `backend/app/agent/verifier.py` and regression-tested. All 17 adversarial test cases now pass, alongside 100% of existing unit, cross-sensor, and real-asset pipeline tests.

---

## 1. Baseline Repository State

- **Branch**: `main`
- **Initial Working Tree**: Clean
- **Baseline Commit**: `ee39e17` (`feat(stage7): implement evidence-grounded LLM scientific verification layer`)
- **Baseline Test Execution**:
  - `python -m pytest app/tests/test_stage7_verifier.py app/tests/test_api.py` -> 22 passed in 27.19s.
  - `npm test -- --run` -> 26 passed in 186.85ms.
- **Stage 6D Real-Asset Pipeline**: Confirmed operational via `test_controlled_real_asset_optical_sar_fusion_pipeline` (1 passed in 10.97s).

---

## 2. Files and Functions Inspected

1. `backend/app/schemas/verification.py`:
   - `EvidencePackageSchema`, `PhysicalMeasurementItem`, `DisplayStatisticItem`, `HeuristicIndicatorItem`, `EvidenceArtifactItem`, `ClaimVerificationItem`, `VerificationResponseSchema`.
2. `backend/app/agent/verifier.py`:
   - `DeterministicVerifier.verify()`: Mandatory pre-checks for units, masks, calibrations, artifact existence, and claim consistency.
   - `DeterministicVerifier._extract_claims_from_text()`: Heuristic sentence parser.
   - `EvidencePackageBuilder.from_analysis_response()`: Adapter bridging `AnalysisResponseSchema` to `EvidencePackageSchema`.
   - `LLMScientificVerifier.verify()`: LM Studio prompt dispatch, JSON deserialization, claim merging, and non-overridable gate enforcement.
3. `backend/app/api/routes_analysis.py`:
   - `POST /analyze/verify` endpoint.
4. `backend/app/agent/controller.py`:
   - Step 12 integration in `AgentController.process_request()`.
5. `frontend/src/components/ScientificVerificationPanel.tsx`:
   - Verification status rendering and claim badges.

---

## 3. Adversarial Test Matrix & Results

| Case ID | Category | Expected Behavior | Actual Pre-Fix Behavior | Test Result (Pre-Fix) | Remediated Status | Defect Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **ADV-A1** | Claim-to-Evidence | Non-existent artifact ID is flagged as unsupported/unknown. | Unknown ID caught in list lookup. | **PASSED** | **PASSED** | None |
| **ADV-A2** | Claim-to-Evidence | Pure SAR artifact (`sar_input`) cited for optical surface reflectance claim is rejected. | Only checked ID membership in set; modality mismatch allowed. | **FAILED** | **PASSED** | **HIGH** |
| **ADV-A3** | Claim-to-Evidence | Claim stating fabricated BOA reflectance (0.85 vs verified 0.1298) is rejected. | No numeric cross-reference against measured physical value; accepted. | **FAILED** | **PASSED** | **CRITICAL** |
| **ADV-A4** | Claim-to-Evidence | Claim citing real artifact but claiming unobserved variable (e.g. soil moisture = 42%) is rejected. | Only checked artifact ID existence; accepted. | **FAILED** | **PASSED** | **HIGH** |
| **ADV-A5** | Claim-to-Evidence | Whitespace padding (`" optical_input "`) normalized cleanly without failure. | Looked up in unstripped set; flagged as unknown or handled inconsistently. | **PASSED** (partial) | **PASSED** | **LOW** |
| **ADV-B1** | Physical Units | SAR display intensity (105.8) claimed as calibrated backscatter is rejected. | Check F only searched for optical terms; 105.8 backscatter accepted. | **FAILED** | **PASSED** | **HIGH** |
| **ADV-B2** | Physical Units | Optical display albedo (92.8) claimed as physical BOA reflectance is rejected. | Check F caught numeric value > 1.0; flagged. | **PASSED** | **PASSED** | None |
| **ADV-B3** | Physical Units | RTC gamma-0 asset backscatter described as sigma-0 is rejected. | Check E flagged sigma-0 contradiction. | **PASSED** | **PASSED** | None |
| **ADV-B4** | Physical Units | Asset with uncalibrated DN claimed as certified gamma-0 backscatter is rejected. | Check E only executed if `has_gamma0 and not has_sigma0`; skipped for uncalibrated assets. | **FAILED** | **PASSED** | **MEDIUM** |
| **ADV-B5** | Physical Units | Linear power (0.7417) labeled as dB without conversion is rejected. | Check G required exact substring `"mean linear"`; `"linear power is 0.7417 dB"` slipped through. | **FAILED** | **PASSED** | **MEDIUM** |
| **ADV-B6** | Physical Units | Linear power converted to dB (-1.30 dB) conflated with mean pixel-wise dB (-4.98 dB) is rejected. | Did not cross-check dB value against declared non-linear statistic types; accepted. | **FAILED** | **PASSED** | **HIGH** |
| **ADV-B7** | Physical Units | Physical measurement omits units or valid-pixel mask; flagged. | Check 1 flagged missing units. | **PASSED** | **PASSED** | None |
| **ADV-B8** | Physical Units | Physically plausible value fabricated; rejected against true measurement. | Addressed in ADV-A3 numerical cross-reference. | **FAILED** | **PASSED** | **CRITICAL** |
| **ADV-C1** | Registration & Provenance | Co-registration claim with varied phrasing ("Scenes are registered") rejected when `co_registered=False`. | Check B used restrictive substring list; missed `"registered and"`. | **FAILED** | **PASSED** | **HIGH** |
| **ADV-C2** | Registration & Provenance | Missing registration metadata (`{}`) claimed as verified co-registration is rejected. | Substring `"geometric co-registration"` missed by `"co-registered"`; accepted. | **FAILED** | **PASSED** | **HIGH** |
| **ADV-C3** | Registration & Provenance | Claim asserts trained neural model ran when fallback executed; rejected. | Check C caught trained model claim. | **PASSED** | **PASSED** | None |
| **ADV-C4** | Registration & Provenance | Missing model metadata treated as verified; rejected. | Addressed by provider metadata inspection. | **PASSED** | **PASSED** | None |
| **ADV-D1** | Deterministic Gate | Deterministic check fails on claim; LLM attempts to assert `supported`. Deterministic failure must NOT be overridden. | LLM `status: "supported"` replaced `evaluated_claims`, changing status to `partially_supported` and claim to `supported`. | **FAILED** | **PASSED** | **CRITICAL** |
| **ADV-D2** | Deterministic Gate | Empty evidence package with 0 physical measurements cannot verify physical claims. | Loop over `physical_measurements` ran 0 times; passed without failure! | **FAILED** | **PASSED** | **HIGH** |
| **ADV-D3** | Deterministic Gate | Malformed LLM output or timeout falls back to `not_run`, never `supported`. | Handled by exception catch block. | **PASSED** | **PASSED** | None |
| **ADV-D4** | Status Semantics | `not_run`, `unsupported`, `partially_supported`, `supported` are distinct and accurate. | Enforced in Step 5 reconciliation. | **PASSED** | **PASSED** | None |
| **ADV-E1** | API & Frontend | Existing response fields preserved on verification failure. | Verified via test. | **PASSED** | **PASSED** | None |
| **ADV-E2** | API & Frontend | Frontend status rendering handles non-success states accurately. | Verified via unit tests. | **PASSED** | **PASSED** | None |

---

## 4. Confirmed Vulnerabilities and Code References

1. **Vulnerability 1 (Critical) — Claim-Level Non-Overridable Gate Bypass (`verifier.py:820-850`)**:
   When deterministic checks flagged a claim as `contradicted`, but the LLM returned `status: "supported"` in its response, the LLM's claims list directly overwrote `evaluated_claims`. Furthermore, `any(c.status == "supported" for c in final_claims)` downgraded the overall status to `partially_supported` even when the single evaluated claim was contradictory.
2. **Vulnerability 2 (Critical) — Fabricated Numerical Value False Acceptance (`verifier.py:170-195`)**:
   The verifier checked that numbers $> 1.0$ were not labeled as reflectance, but failed to cross-reference claimed values $\le 1.0$ (e.g. $0.85$) against the verified measurement in `physical_measurements` ($0.1298$).
3. **Vulnerability 3 (High) — Artifact Modality Mismatch False Acceptance (`verifier.py:125-132`)**:
   Only set membership `art_id in valid_artifact_ids` was checked. Citing a SAR artifact for an optical reflectance claim was accepted.
4. **Vulnerability 4 (High) — Unobserved Variables Accepted (`verifier.py:120-135`)**:
   Claims referencing unobserved variables (e.g., soil moisture, bathymetry, surface temperature) were accepted as long as an existing artifact ID was cited.
5. **Vulnerability 5 (High) — SAR Display Intensity Conflation (`verifier.py:170-195`)**:
   Check F only inspected optical keywords (`reflectance`, `albedo`), leaving SAR display intensity ($105.8$) unchecked when claimed as calibrated backscatter.
6. **Vulnerability 6 (High) — Statistic Confusion between Non-Linear dB Averages (`verifier.py:195-205`)**:
   Conflating mean linear power converted to dB ($-1.30\text{ dB}$) with mean pixel-wise dB ($-4.98\text{ dB}$) was not checked against verified physical statistics.
7. **Vulnerability 7 (High) — Empty Evidence Package Bypass (`verifier.py:58-66`)**:
   When `evidence_package.physical_measurements` was empty, the loop ran zero times and reported zero failures, allowing physical claims to pass.
8. **Vulnerability 8 (Medium) — Keyword Phrasing Brittleness (`verifier.py:133-145, 195-205`)**:
   Co-registration checks required `"co-registered"` or `"sub-pixel registration"`, missing `"geometric co-registration"` or `"scenes are registered"`. Linear power checks required `"mean linear"`, missing `"linear power"`.

---

## 5. Minimal Remediations Applied

All remediations were implemented in `backend/app/agent/verifier.py` with zero changes to existing API schemas:

1. **Modality & Type Cross-Checking**:
   - Mapped artifacts by ID.
   - Enforced that optical property claims cannot cite pure SAR artifacts, and SAR backscatter claims cannot cite pure optical artifacts.
2. **Numerical Cross-Referencing**:
   - Extracted stated numerical values in physical claims and verified that they match computed physical measurements within a tolerance of $\pm 0.05$.
3. **Unobserved Variable Detection**:
   - Checked for unobserved physical variables (`soil moisture`, `surface temperature`, etc.); flagged claims referencing them as unsupported.
4. **SAR Display Intensity Guard**:
   - Added Check F2: detected SAR display values (such as $105.8$, or values $> 25.0$ without display/DN notation) claimed as calibrated backscatter.
5. **Non-Linear Statistic Distinction**:
   - Added verification checking that pixel-wise dB claims match `sar_mean_pixel_db` and are not confused with linear power converted to dB (`sar_mean_linear_to_db`).
6. **Comprehensive Phrasing Normalization**:
   - Regex and term expansions for co-registration (`co-registration`, `geometric alignment`, `scenes are registered`) and linear power (`linear power`, `linear backscatter`).
7. **Empty Evidence Package Rejection**:
   - Added Check 0: physical measurement claims on evidence packages with zero physical measurements are rejected as unsupported.
8. **Strict Non-Overridable Gate**:
   - Created a map of deterministically contradicted/unsupported claims.
   - For every claim returned by the LLM, if it was deterministically contradicted, its status is strictly forced back to `contradicted` with the deterministic reason preserved.
   - If `supported_count == 0`, overall status is strictly `unsupported`, preventing false `partially_supported` status.

---

## 6. Regression Testing & Full-Suite Verification

### Dedicated Adversarial Suite
- **Command**: `python -m pytest app/tests/test_stage7a_adversarial_audit.py`
- **Output**:
  ```text
  collected 17 items
  ======================== 17 passed, 1 warning in 0.56s ========================
  ```

### Original Stage 7 Suite
- **Command**: `python -m pytest app/tests/test_stage7_verifier.py`
- **Output**:
  ```text
  collected 17 items
  ======================== 17 passed, 1 warning in 0.59s ========================
  ```

### Stage 6D Real-Asset Pipeline Preservation
- **Command**: `python -m pytest app/tests/test_optical_sar_cross_sensor.py -k "test_controlled_real_asset_optical_sar_fusion_pipeline"`
- **Output**:
  ```text
  ================ 1 passed, 20 deselected, 4 warnings in 10.97s ================
  ```

### Full Backend Pytest Suite
- **Command**: `python -m pytest app/tests/`
- **Output**:
  ```text
  collected 191 items
  =========== 188 passed, 3 skipped, 71 warnings in 71.55s (0:01:11) ============
  ```

### Frontend Test Suite & Typecheck
- **Command**: `npm test -- --run`
- **Output**:
  ```text
  ℹ tests 28
  ℹ suites 4
  ℹ pass 28
  ℹ fail 0
  ℹ duration_ms 189.4358
  ```
- **Typecheck**: `npx tsc --noEmit` exited with code 0 (zero errors).
- **Git Hygiene**: `git diff --check` passed cleanly with zero whitespace issues.

---

## 7. Remaining Limitations & Recommendations

1. **Local LLM Model Dependency**:
   - The LLM verification layer requires a reachable local OpenAI-compatible endpoint (LM Studio).
   - In offline mode, the system successfully relies entirely on the deterministic gate (`verification_status: "not_run"`), preserving all physical telemetry.
2. **Free-Form Text Claim Parsing**:
   - When claims are extracted from raw narrative answers (`_extract_claims_from_text`), heuristic sentence segmentation is used. Structured claim objects via `candidate_claims` provide higher precision.

---

## 8. Stage 8 Status

Stage 8 was **not started**. No work beyond Stage 7A was initiated or authorized.
