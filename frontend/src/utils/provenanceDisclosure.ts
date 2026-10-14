import type { AnalysisResponse } from '../types/index.ts';

export const OFFLINE_FIXTURE_WARNING_TEXT =
  'Offline Demonstration Mode: This analysis uses pre-packaged local raster fixtures. It is not a live satellite acquisition, and the imagery may not cover the requested AOI.';

export interface FixtureProvenanceDetection {
  isOfflineFixture: boolean;
  fixtureIds: string[];
  warningMessage: string | null;
  isOutOfBoundsClamped?: boolean;
  actualFixtureBounds?: number[];
}

/**
 * Inspects an AnalysisResponse for offline demonstration local fixture provenance.
 * Detects whether any source asset IDs start with 'local_sample_'.
 *
 * Enforces:
 * - Warning is strictly conditional on actual response provenance asset IDs.
 * - Missing or malformed provenance safely defaults to isOfflineFixture = false without asserting live status.
 * - Does not trigger solely on query text (e.g. Mumbai) or orchestration mode.
 */
export function detectLocalFixtureProvenance(response?: AnalysisResponse | null): FixtureProvenanceDetection {
  if (!response) {
    return {
      isOfflineFixture: false,
      fixtureIds: [],
      warningMessage: null,
    };
  }

  const provenance = response.reproducible_report?.provenance || response.metadata?.provenance;
  const rawList =
    provenance?.source_asset_ids ||
    (response.metadata as any)?.source_asset_ids ||
    (response as any)?.provenance?.source_asset_ids;

  const sourceAssetIds: string[] = Array.isArray(rawList)
    ? rawList.filter((id): id is string => typeof id === 'string')
    : [];

  const localIds = sourceAssetIds.filter((id) => id.startsWith('local_sample_'));
  const uniqueLocalIds = Array.from(new Set(localIds));

  const aoiContainmentStatus =
    (provenance as any)?.aoi_containment_status ||
    (response.metadata as any)?.aoi_containment_status;
  const isOutOfBoundsClamped = aoiContainmentStatus === 'out_of_bounds_clamped';

  const rawBounds =
    (provenance as any)?.actual_fixture_bounds_wgs84 ||
    (response.metadata as any)?.actual_fixture_bounds_wgs84;
  const actualFixtureBounds = Array.isArray(rawBounds) ? rawBounds : undefined;

  if (uniqueLocalIds.length > 0) {
    return {
      isOfflineFixture: true,
      fixtureIds: uniqueLocalIds,
      warningMessage: OFFLINE_FIXTURE_WARNING_TEXT,
      isOutOfBoundsClamped,
      actualFixtureBounds,
    };
  }

  return {
    isOfflineFixture: false,
    fixtureIds: [],
    warningMessage: null,
  };
}

