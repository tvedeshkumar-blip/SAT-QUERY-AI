# SAT-QUERY-AI — Stage 7B: Targeted Verification Hardening Audit Report

## Executive Summary

This report documents the Stage 7B Targeted Verification Hardening Audit conducted on the scientific verification subsystem remediated in commit `b1ddeca`. The audit focused on four primary vectors:
1. **Numeric tolerance safety and unit compatibility** (the reported $\pm 0.05$ threshold, physical quantity attribution, and display vs. physical statistics).
2. **Claim-level status aggregation** (deterministic gate interaction with LLM output, partial support aggregation, empty and malformed input handling).
3. **Artifact provenance and modality integrity** (modality mismatches, missing or ambiguous calibration metadata, artifact cross-attribution).
4. **False rejection risks** (scientific equivalence in phrasing, explicit disclaimers of unobserved variables, and qualified heuristic indicators).

Through code inspection and a dedicated test suite (`test_stage7b_hardening_audit.py` with 29 targeted test cases), specific vulnerabilities and false-rejection defects were identified in the baseline `b1ddeca` implementation. A minimal, surgical remediation was applied strictly within `backend/app/agent/verifier.py`. All 29 Stage 7B hardening tests, all 17 Stage 7A adversarial tests, all 17 Stage 7 verifier tests, the Stage 6D real-asset fusion pipeline, the full backend pytest suite (217 passed, 3 skipped), and all frontend unit tests (28 passed) now pass without regression.

---

## 1. Baseline Repository State

- **Branch**: `main`
- **Initial Working Tree**: Clean
- **Baseline Commit**: `b1ddeca` (`fix(verifier): remediate Stage 7A adversarial verification vulnerabilities and add adversarial test suite`)
- **Prior Commit in History**: `ee39e17` (`feat(stage7): implement evidence-grounded LLM scientific verification layer`)
- **Baseline Test Execution**:
  - `python -m pytest app/tests/test_stage7_verifier.py app/tests/test_stage7a_adversarial_audit.py app/tests/test_api.py` $\rightarrow$ 39 passed in 8.75s.
  - `npm test -- --run` $\rightarrow$ 28 passed in 189.68ms.
  - `npx tsc --noEmit` $\rightarrow$ 0 errors (clean typecheck).
  - Stage 6D real-asset pipeline (`test_controlled_real_asset_optical_sar_fusion_pipeline`) $\rightarrow$ 1 passed in 10.97s.

---

## 2. Files and Functions Inspected

1. `backend/app/schemas/verification.py`:
   - `PhysicalMeasurementItem`: Validated fields `unit`, `statistic_type`, `mask_applied`, `calibration_quantity`.
   - `DisplayStatisticItem`: Verified `scale` and mandatory `purpose="visualization_only"`.
   - `HeuristicIndicatorItem`: Verified mandatory `is_certified_classification=False`.
   - `EvidenceArtifactItem`: Verified `artifact_id`, `artifact_type`, `statistics`.
   - `ClaimVerificationItem`: Inspected status values (`supported`, `partially_supported`, `unsupported`, `contradicted`).
   - `VerificationResponseSchema`: Inspected deterministic failure isolation and interpretive statement.
2. `backend/app/agent/verifier.py`:
   - `DeterministicVerifier.verify()`:
     - Check 0: Zero physical measurements check.
     - Check A: Modality compatibility and artifact existence.
     - Check A2: Unobserved environmental variable detection and negation handling.
     - Check B: Co-registration status cross-referencing.
     - Check C: Trained model vs heuristic baseline metadata check.
     - Check D: Heuristic classification qualification vs certification check.
     - Check E: Calibration provenance (Gamma-0 vs Sigma-0 and uncalibrated DN).
     - Check F: BOA surface reflectance numerical cross-referencing and decibel rejection.
     - Check F2: SAR linear power cross-referencing and display intensity guard.
     - Check G: Non-linear decibel statistics vs linear power converted to dB.
   - `LLMScientificVerifier.verify()`:
     - Reachability probe (`client.is_reachable`).
     - Prompt serialization and schema validation.
     - Non-overridable deterministic gate enforcement.
     - Fallback / offline claim-level aggregation reconciliation.
     - Claim status normalization and deduplication.

---

## 3. Audit Test Matrix & Empirical Findings

The audit suite `backend/app/tests/test_stage7b_hardening_audit.py` (29 items) evaluated the four core sections:

| Case ID | Category | Expected Behavior | Baseline (`b1ddeca`) Behavior | Test Result (Pre-Fix) | Hardened Status | Defect Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **NUM-1** | Numeric / Units | Exact physical value (0.1298) with matching units and statistic accepted. | Handled correctly by Check F. | **PASSED** | **PASSED** | None |
| **NUM-2** | Numeric / Units | Small rounding difference (0.13 vs 0.1298) within declared precision accepted. | Difference 0.0002 within threshold. | **PASSED** | **PASSED** | None |
| **NUM-3A** | Numeric / Units | Materially fabricated optical reflectance (0.35 vs 0.1298) rejected. | Caught by absolute threshold check. | **PASSED** | **PASSED** | None |
| **NUM-3B** | Numeric / Units | Materially fabricated SAR linear power (0.20 vs 0.7417) rejected. | **Defect**: SAR linear power was never checked against `sar_mean_linear_power`; accepted as supported! | **FAILED** | **PASSED** | **CRITICAL** |
| **NUM-4** | Numeric / Units | Numerically close value with wrong unit (e.g. 0.13 dB reflectance, 0.7417 dB linear power) rejected. | **Defect**: Reflectance with dB was not checked for dB unit incompatibility; accepted! | **FAILED** | **PASSED** | **HIGH** |
| **NUM-5** | Numeric / Units | Numerically close value from wrong sensor/artifact rejected. | Caught by modality check. | **PASSED** | **PASSED** | None |
| **NUM-6** | Numeric / Units | Pixel-wise dB (-4.98) not conflated with linear power converted to dB (-1.30). | Caught by Check G. | **PASSED** | **PASSED** | None |
| **NUM-7** | Numeric / Units | Missing units, statistic type, or mask in physical measurements rejected. | Caught by Check 1. | **PASSED** | **PASSED** | None |
| **NUM-8** | Numeric / Units | Display values (92.8 albedo, 105.8 intensity) rejected as physical measurements. | Caught by Checks F & F2. | **PASSED** | **PASSED** | None |
| **AGG-1** | Aggregation | 1 supported claim + 1 contradicted claim yields `partially_supported`. | In offline fallback, returned `unsupported` ignoring supported claim. | **FAILED** | **PASSED** | **MEDIUM** |
| **AGG-2** | Aggregation | 1 supported claim + 1 unsupported claim yields `partially_supported`. | In offline fallback, returned `unsupported` ignoring supported claim. | **FAILED** | **PASSED** | **MEDIUM** |
| **AGG-3** | Aggregation | All claims contradicted yields overall `unsupported`. | Verified. | **PASSED** | **PASSED** | None |
| **AGG-4** | Aggregation | All claims unsupported yields overall `unsupported`. | Verified. | **PASSED** | **PASSED** | None |
| **AGG-5** | Aggregation | Zero claims submitted yields `not_run` or `unsupported`, never `supported`. | Verified. | **PASSED** | **PASSED** | None |
| **AGG-6** | Aggregation | LLM asserts `supported` on deterministically failed claim; non-overridable gate forces `contradicted`. | Verified. | **PASSED** | **PASSED** | None |
| **AGG-7** | Aggregation | Malformed claim statuses from LLM normalized to `unsupported`; no crash or false success. | Sanitized to `unsupported`. | **PASSED** | **PASSED** | None |
| **AGG-8** | Aggregation | Duplicate claims or duplicated artifact IDs deduplicated cleanly. | Cleanly deduplicated. | **PASSED** | **PASSED** | None |
| **PROV-1** | Provenance | Optical reflectance citing optical artifact accepted. | Supported. | **PASSED** | **PASSED** | None |
| **PROV-2** | Provenance | Optical reflectance citing pure SAR artifact rejected. | Modality mismatch caught. | **PASSED** | **PASSED** | None |
| **PROV-3** | Provenance | SAR backscatter citing optical artifact rejected. | Modality mismatch caught. | **PASSED** | **PASSED** | None |
| **PROV-4** | Provenance | Mask artifact (`joint_valid_mask`) cited for physical reflectance measurement rejected. | **Defect**: Mask artifact cited for physical measurement without valid-pixel context passed. | **FAILED** | **PASSED** | **HIGH** |
| **PROV-5** | Provenance | Missing calibration metadata claimed as certified gamma-0 backscatter rejected. | **Defect**: When calibration metadata was missing/empty, Check E was bypassed; passed! | **FAILED** | **PASSED** | **HIGH** |
| **PROV-6** | Provenance | Artifact IDs differing by whitespace/case normalized cleanly. | Normalized. | **PASSED** | **PASSED** | None |
| **PROV-7** | Provenance | Conflicting metadata between assets caught. | Caught. | **PASSED** | **PASSED** | None |
| **PROV-8** | Provenance | SAR value attributed to optical artifact rejected. | Caught. | **PASSED** | **PASSED** | None |
| **FALSE-1**| False Rejection | Co-registration equivalent phrases ("spatial alignment", "registered to grid") accepted when `co_registered=True`. | Accepted without false rejection. | **PASSED** | **PASSED** | None |
| **FALSE-2**| False Rejection | Scientifically accurate linear power vs decibel statements accepted. | Caught false rejection where `gamma-0` matched `0` as value. Fixed regex. | **FAILED** | **PASSED** | **MEDIUM** |
| **FALSE-3**| False Rejection | Valid scientific terms for reflectance ("bottom-of-atmosphere surface reflectance") accepted. | Accepted without false rejection. | **PASSED** | **PASSED** | None |
| **FALSE-4**| False Rejection | Heuristic proxy explicitly qualified ("...is not a certified classification") accepted. | **Defect**: Naive substring match on `"certified"` flagged explicitly qualified disclaimers! | **FAILED** | **PASSED** | **HIGH** |
| **FALSE-5**| False Rejection | Explicitly disclaiming unobserved variables ("soil moisture was not observed...") accepted. | **Defect**: Naive check on `"soil moisture"` flagged explicit statements of absence! | **FAILED** | **PASSED** | **HIGH** |

---

## 4. Assessment of Numeric Tolerance ($\pm 0.05$) and Limitations

### Empirical Findings
1. **Scope of the $\pm 0.05$ Tolerance**:
   - In `verifier.py`, the $\pm 0.05$ threshold is applied to `optical_mean_boa_reflectance`.
   - Surface reflectance is a unitless ratio bounded in $[0, 1]$. An absolute tolerance of $\pm 0.05$ corresponds to $5\%$ absolute reflectance.
   - For an observed reflectance of $0.1298$, a claim of $0.179$ (a relative error of $+38\%$) falls within $0.05$ and is accepted.
   - Conversely, for SAR linear power (actual $0.7417$), pre-fix code had **no numerical cross-referencing**, permitting fabricated values such as $0.20$ to pass unchecked.
2. **Unit Compatibility Defect**:
   - The pre-fix verifier only inspected numeric magnitude without verifying the compatible unit. Stating "mean surface reflectance is 0.13 dB" passed because $0.13 \le 1.0$ and $|0.13 - 0.1298| \le 0.05$, despite decibels being physically invalid for BOA reflectance.
3. **Statistic Type Matching**:
   - The verifier assumes extracted values represent spatial means based on the telemetry schema. If a claim asserts median or standard deviation, the current schema lacks separate fields for those statistics.
4. **Policy Determination**:
   - An ad-hoc universal relative or absolute tolerance across heterogeneous remote-sensing quantities (e.g. unitless reflectance vs linear backscatter ratio vs logarithmic dB) must **not** be invented.
   - For physical cross-referencing, tolerances must be tied to declared variable scales (e.g. unitless ratio $[0, 1]$ vs linear power) and unit compatibility must be strictly verified prior to numeric comparison.

---

## 5. Claim-Level Aggregation Policy

The aggregation policy reconciles deterministic integrity gates and LLM interpretive outputs:

1. **Deterministic Dominance**:
   - If deterministic checks flag a claim as `contradicted` or `unsupported`, this outcome is permanent. An LLM assertion of `status="supported"` is strictly overwritten back to the deterministic status with reason prefix `"Deterministic gate: ..."`.
2. **Status Normalization**:
   - Every evaluated claim status is validated against `{"supported", "partially_supported", "unsupported", "contradicted"}`. Unrecognized strings or malformed statuses are normalized to `"unsupported"`.
3. **Aggregation Rules**:
   - **Zero claims**: Verification status is `not_run` (if deterministic checks passed and candidate claims were empty) or `unsupported` (if deterministic checks failed). It can **never** be `supported`.
   - **All claims supported**: `verification_status="supported"` only if all claims are `supported`, zero claims are `contradicted`/`unsupported`, and `det_passed=True`.
   - **Mixed claim outcomes**: If at least 1 claim is `supported` and at least 1 claim is `contradicted` or `unsupported`, `verification_status="partially_supported"`.
   - **All claims contradicted or unsupported**: `verification_status="unsupported"`.
4. **Offline / Fallback Reconciliation**:
   - When the LLM service is offline or encounters an error, the deterministic evaluation across claims is aggregated identically (e.g., 1 supported + 1 contradicted yields `partially_supported`, not a blind downgrade to `unsupported`).

---

## 6. Artifact Modality and Provenance Findings

1. **Cross-Modality Incompatibility**:
   - Optical property claims (reflectance, NDVI, B04) citing pure SAR artifacts (`sar_input`, RTC) are rejected with `Modality mismatch`.
   - SAR backscatter claims (gamma-0, sigma-0, linear power) citing optical artifacts (`optical_input`) are rejected with `Modality mismatch`.
2. **Artifact Type Mismatch**:
   - Mask artifacts (e.g., `joint_valid_mask`) lack physical measurement arrays. Citing a mask artifact for physical reflectance or backscatter measurements without mask/pixel-count context is rejected with `Quantity/type mismatch`.
3. **Missing Calibration Provenance**:
   - Assets lacking calibration provenance metadata (`calibration=""`, `measurement=""`) cannot support certified backscatter claims (gamma-0 or sigma-0). The verifier now flags missing calibration provenance as an explicit contradiction.
4. **Formatting Normalization**:
   - Artifact IDs with whitespace padding or case variations are normalized against the known evidence package artifacts, preventing spurious rejections.

---

## 7. False-Positive and False-Negative Risk Analysis

1. **False-Positive Risks (Accepting Invalid Claims)**:
   - *Mitigated*: Fabricated SAR linear power claims (e.g. 0.20 vs 0.7417) are now caught.
   - *Mitigated*: Reflectance claimed in decibels (dB) is now caught.
   - *Mitigated*: Mask artifacts cited for physical measurements are now caught.
   - *Mitigated*: Assets with missing calibration metadata claimed as certified backscatter are now caught.
2. **False-Negative Risks (Rejecting Scientifically Valid Claims)**:
   - *Mitigated*: Claims properly stating that a heuristic is *not* a certified classification (e.g., "preliminary heuristic proxy, not a certified classification") were previously falsely rejected. Negation detection resolves this.
   - *Mitigated*: Claims disclaiming unobserved variables (e.g., "soil moisture was not observed by the sensors and is absent from the evidence package") were previously falsely rejected. Absence detection resolves this.
   - *Mitigated*: Claims stating "linear gamma-0 power is 0.7417" were previously misparsed due to the digit `0` in `gamma-0`. Regex hardening resolves this.

---

## 8. Minimal Changes Made

All modifications were restricted to `backend/app/agent/verifier.py`:

1. **Unit Compatibility Guard**: Added rejection for BOA surface reflectance claims specifying decibel (`dB`) units.
2. **SAR Linear Power Numerical Validation**: Extracted claimed linear power values and cross-referenced against `sar_mean_linear_power` within scale tolerance.
3. **Mask Artifact Type Guard**: Flagged measurement claims citing mask-type artifacts without mask/coverage context.
4. **Missing Calibration Metadata Guard**: Flagged claims of certified backscatter when source assets and physical measurements lack calibration metadata.
5. **Heuristic Classification Negation Recognition**: Added negation check so scientifically qualified statements disclaiming certified status are not rejected.
6. **Unobserved Variable Absence Recognition**: Added negation check so statements noting the absence or non-observation of variables are not rejected.
7. **Consistent Status Aggregation**: Reconciled status aggregation across online, fallback, and error paths so partial support is preserved consistently.
8. **Deduplication**: Deduplicated cited artifact IDs and candidate claims cleanly.

---

## 9. Comprehensive Verification Suite Execution

### 1. Stage 7B Hardening Suite
- **Command**: `python -m pytest app/tests/test_stage7b_hardening_audit.py`
- **Output**:
  ```text
  collected 29 items
  ============================= 29 passed in 11.55s =============================
  ```

### 2. Combined Stage 7, 7A, API, and 7B Suites
- **Command**: `python -m pytest app/tests/test_stage7_verifier.py app/tests/test_stage7a_adversarial_audit.py app/tests/test_api.py app/tests/test_stage7b_hardening_audit.py`
- **Output**:
  ```text
  collected 68 items
  ======================= 68 passed, 4 warnings in 20.22s =======================
  ```

### 3. Stage 6D Real-Asset Fusion Pipeline
- **Command**: `python -m pytest app/tests/test_optical_sar_cross_sensor.py -k "test_controlled_real_asset_optical_sar_fusion_pipeline"`
- **Output**:
  ```text
  ================ 1 passed, 20 deselected, 4 warnings in 14.35s ================
  ```

### 4. Full Backend Pytest Suite
- **Command**: `python -m pytest app/tests/`
- **Output**:
  ```text
  collected 220 items
  =========== 217 passed, 3 skipped, 71 warnings in 68.42s (0:01:08) ============
  ```

### 5. Frontend Test Suite
- **Command**: `npm test -- --run`
- **Output**:
  ```text
  ℹ tests 28
  ℹ suites 4
  ℹ pass 28
  ℹ fail 0
  ℹ duration_ms 198.9793
  ```

### 6. Frontend Typecheck
- **Command**: `npx tsc --noEmit`
- **Output**: Exited with code 0 (clean).

### 7. Git Diff Hygiene
- **Command**: `git diff --check`
- **Output**: Clean (zero whitespace or formatting errors).

---

## 10. Remaining Limitations & Recommendations

1. **Relative Tolerance Specification**:
   - The current verifier uses quantity-specific absolute ranges for reflectance ($0.05$) and linear power ($0.05$). While suitable for the current physical domains ($[0, 1]$ reflectance and linear backscatter $\approx 0.74$), future stages should allow evidence items to declare explicit measurement precision (e.g. `precision: 0.001` or relative error bound).
2. **Local LLM Model Dependency**:
   - The LLM verification layer remains interpretive-only and requires a local OpenAI-compatible endpoint (LM Studio). When offline, the deterministic gate operates autonomously with full status fidelity.
3. **Stage 8 Boundary**:
   - Stage 8 was **not started**. No Stage 8 code or architecture has been created.

---

## 11. Final Gate Conclusion

Based on empirical code inspection, 29 focused hardening tests, 217 passing backend tests, and preserved real-asset fusion pipelines:

### **READY FOR STAGE 8**
