/**
 * Deterministically formats an acquisition timestamp or extracts from scene filename.
 * Preserves authentic provenance and never fabricates dates.
 */
export function formatAcquisitionDate(dt?: string, filename?: string): { formatted: string; raw: string | null } {
  if (dt && typeof dt === 'string') {
    try {
      if (dt.includes('T')) {
        const parts = dt.split('T');
        const datePart = parts[0];
        const timePart = parts[1]?.replace('Z', '')?.slice(0, 5);
        return {
          formatted: `${datePart}${timePart ? ` (${timePart} UTC)` : ''}`,
          raw: dt
        };
      }
      return { formatted: dt, raw: dt };
    } catch {
      return { formatted: dt, raw: dt };
    }
  }

  if (filename && typeof filename === 'string') {
    // E.g. S2B_43PGQ_20230528_0_L2A_visual_window_1792262748.tif
    const match = filename.match(/(\d{4})(\d{2})(\d{2})/);
    if (match) {
      const formatted = `${match[1]}-${match[2]}-${match[3]}`;
      return { formatted, raw: formatted };
    }
  }

  return { formatted: 'Date Unavailable', raw: null };
}
