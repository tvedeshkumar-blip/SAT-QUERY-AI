/**
 * dateValidation.ts
 * Utility for verifying bi-temporal date windows and chronological ordering
 * in the automated satellite AOI analysis workflow.
 */

export interface BiTemporalValidationResult {
  isValid: boolean;
  error: string | null;
  t1DeltaDays?: number;
  t2DeltaDays?: number;
  gapDays?: number;
}

/**
 * Validates that:
 * 1. All pre-event (T1) and post-event (T2) dates are specified and valid.
 * 2. T1 start date <= T1 end date.
 * 3. T2 start date <= T2 end date.
 * 4. T1 end date < T2 start date (post-event window is strictly later than pre-event window).
 */
export function validateBiTemporalDateRanges(
  t1Start: string,
  t1End: string,
  t2Start: string,
  t2End: string
): BiTemporalValidationResult {
  if (!t1Start || !t1End || !t2Start || !t2End) {
    return {
      isValid: false,
      error: "All pre-event (T1) and post-event (T2) start and end dates must be specified."
    };
  }

  const d1s = new Date(t1Start);
  const d1e = new Date(t1End);
  const d2s = new Date(t2Start);
  const d2e = new Date(t2End);

  if (isNaN(d1s.getTime()) || isNaN(d1e.getTime()) || isNaN(d2s.getTime()) || isNaN(d2e.getTime())) {
    return {
      isValid: false,
      error: "Invalid date format encountered. Dates must be valid ISO YYYY-MM-DD strings."
    };
  }

  if (d1s > d1e) {
    return {
      isValid: false,
      error: `Pre-event start date (${t1Start}) must precede or equal pre-event end date (${t1End}).`
    };
  }

  if (d2s > d2e) {
    return {
      isValid: false,
      error: `Post-event start date (${t2Start}) must precede or equal post-event end date (${t2End}).`
    };
  }

  if (d1e >= d2s) {
    return {
      isValid: false,
      error: `Post-event window start (${t2Start}) must be strictly later than pre-event window end (${t1End}).`
    };
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  const t1Delta = Math.round((d1e.getTime() - d1s.getTime()) / msPerDay);
  const t2Delta = Math.round((d2e.getTime() - d2s.getTime()) / msPerDay);
  const gap = Math.round((d2s.getTime() - d1e.getTime()) / msPerDay);

  return {
    isValid: true,
    error: null,
    t1DeltaDays: t1Delta,
    t2DeltaDays: t2Delta,
    gapDays: gap
  };
}
