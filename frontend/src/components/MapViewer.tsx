import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { 
  Layers, 
  RotateCcw, 
  Trash2, 
  Square, 
  Check, 
  AlertTriangle, 
  Globe2, 
  Loader2, 
  Compass, 
  Maximize2,
  Info,
  Calendar,
  Cloud,
  Clock,
  ChevronDown,
  ChevronUp,
  Sliders,
  CheckCircle2
} from 'lucide-react';
import { AOIBounds, AOIAnalysisConfig, MapOverlayConfig } from '../types';
import { 
  DEMO_REGIONS, 
  DemoRegion, 
  validateBBox, 
  formatBBox, 
  normalizeLongitude,
  calculateSphericalAreaKm2 
} from '../utils/geoBounds';
import { validateBiTemporalDateRanges } from '../utils/dateValidation';

export interface MapViewerProps {
  selectedAOI: AOIBounds | null;
  onAOIChange: (aoi: AOIBounds | null) => void;
  aoiConfig?: AOIAnalysisConfig;
  onAOIConfigChange?: (config: AOIAnalysisConfig) => void;
  activeOverlay?: MapOverlayConfig | null;
  onClearOverlay?: () => void;
  className?: string;
}

type BasemapType = 'streets' | 'satellite';

const BASEMAP_CONFIGS = {
  streets: {
    name: 'OpenStreetMap (Streets)',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      maxZoom: 19,
      subdomains: ['a', 'b', 'c']
    }
  },
  satellite: {
    name: 'Esri World Imagery (Satellite)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and GIS User Community',
      maxZoom: 18
    }
  }
};

export const MapViewer: React.FC<MapViewerProps> = ({
  selectedAOI,
  onAOIChange,
  aoiConfig,
  onAOIConfigChange,
  activeOverlay,
  onClearOverlay,
  className = ''
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const currentTileLayerRef = useRef<L.TileLayer | null>(null);
  const rectangleLayerRef = useRef<L.Rectangle | null>(null);
  const imageOverlayRef = useRef<L.ImageOverlay | null>(null);

  const [activeBasemap, setActiveBasemap] = useState<BasemapType>('satellite');
  const [isTileLoading, setIsTileLoading] = useState<boolean>(false);
  const [tileErrorOccurred, setTileErrorOccurred] = useState<boolean>(false);
  const [isDrawingMode, setIsDrawingMode] = useState<boolean>(false);
  const [activeDemoId, setActiveDemoId] = useState<string | null>(null);
  const [isAnalysisDrawerOpen, setIsAnalysisDrawerOpen] = useState<boolean>(true);

  const [internalConfig, setInternalConfig] = useState<AOIAnalysisConfig>({
    startDate: '2024-01-01',
    endDate: '2024-03-31',
    t1StartDate: '2023-01-01',
    t1EndDate: '2023-06-30',
    t2StartDate: '2023-07-01',
    t2EndDate: '2023-12-31',
    maxCloudCover: 20
  });

  const config = aoiConfig || internalConfig;
  const updateConfig = (patch: Partial<AOIAnalysisConfig>) => {
    const next = { ...config, ...patch };
    if (onAOIConfigChange) {
      onAOIConfigChange(next);
    } else {
      setInternalConfig(next);
    }
  };

  const bitemporalValidation = validateBiTemporalDateRanges(
    config.t1StartDate,
    config.t1EndDate,
    config.t2StartDate,
    config.t2EndDate
  );

  // Mouse drag tracking for rectangle selection
  const isMouseDownRef = useRef<boolean>(false);
  const startLatLngRef = useRef<L.LatLng | null>(null);
  const isDrawingModeRef = useRef<boolean>(false);
  isDrawingModeRef.current = isDrawingMode;

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    // Default center on global view
    const map = L.map(mapContainerRef.current, {
      center: [20, 0],
      zoom: 2,
      minZoom: 1,
      maxZoom: 19,
      worldCopyJump: true,
      zoomControl: false
    });

    // Add zoom control at top-right
    L.control.zoom({ position: 'topright' }).addTo(map);

    mapInstanceRef.current = map;

    // Force size recalculation after DOM layout settles
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Handle Basemap Layer Switching and Tile Loading / Error events
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (currentTileLayerRef.current) {
      map.removeLayer(currentTileLayerRef.current);
    }

    setTileErrorOccurred(false);
    setIsTileLoading(true);

    const config = BASEMAP_CONFIGS[activeBasemap];
    const tileLayer = L.tileLayer(config.url, config.options);

    tileLayer.on('loading', () => {
      setIsTileLoading(true);
    });

    tileLayer.on('load', () => {
      setIsTileLoading(false);
    });

    tileLayer.on('tileerror', (err) => {
      console.warn(`Tile loading error on basemap '${activeBasemap}':`, err);
      setTileErrorOccurred(true);
      setIsTileLoading(false);
    });

    tileLayer.addTo(map);
    currentTileLayerRef.current = tileLayer;
  }, [activeBasemap]);

  // Synchronize rectangle layer whenever selectedAOI changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!selectedAOI) {
      if (rectangleLayerRef.current) {
        map.removeLayer(rectangleLayerRef.current);
        rectangleLayerRef.current = null;
      }
      return;
    }

    const [minLon, minLat, maxLon, maxLat] = selectedAOI;
    const bounds = L.latLngBounds([minLat, minLon], [maxLat, maxLon]);

    if (rectangleLayerRef.current) {
      rectangleLayerRef.current.setBounds(bounds);
    } else {
      const rect = L.rectangle(bounds, {
        color: '#06b6d4',
        weight: 2,
        fillColor: '#0891b2',
        fillOpacity: 0.25,
        dashArray: '4, 4'
      });
      rect.addTo(map);
      rectangleLayerRef.current = rect;
    }
  }, [selectedAOI]);

  // Synchronize raster image overlay when activeOverlay changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!activeOverlay) {
      if (imageOverlayRef.current) {
        map.removeLayer(imageOverlayRef.current);
        imageOverlayRef.current = null;
      }
      return;
    }

    const [minLon, minLat, maxLon, maxLat] = activeOverlay.bounds;
    const latLngBounds = L.latLngBounds([minLat, minLon], [maxLat, maxLon]);

    if (imageOverlayRef.current) {
      imageOverlayRef.current.setUrl(activeOverlay.imageUrl);
      imageOverlayRef.current.setBounds(latLngBounds);
      imageOverlayRef.current.setOpacity(activeOverlay.opacity);
    } else {
      const overlay = L.imageOverlay(activeOverlay.imageUrl, latLngBounds, {
        opacity: activeOverlay.opacity,
        interactive: false
      });
      overlay.addTo(map);
      imageOverlayRef.current = overlay;
    }
  }, [activeOverlay?.imageUrl, activeOverlay?.bounds]);

  // Synchronize opacity dynamically without reloading image
  useEffect(() => {
    if (imageOverlayRef.current && activeOverlay) {
      imageOverlayRef.current.setOpacity(activeOverlay.opacity);
    }
  }, [activeOverlay?.opacity]);

  // Click & Drag AOI Drawing Logic
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (isDrawingMode) {
      map.dragging.disable();
      if (mapContainerRef.current) {
        mapContainerRef.current.style.cursor = 'crosshair';
      }
    } else {
      map.dragging.enable();
      if (mapContainerRef.current) {
        mapContainerRef.current.style.cursor = '';
      }
    }

    const onMouseDown = (e: L.LeafletMouseEvent) => {
      if (!isDrawingModeRef.current) return;
      isMouseDownRef.current = true;
      startLatLngRef.current = e.latlng;
      setActiveDemoId(null);

      const zeroBounds = L.latLngBounds(e.latlng, e.latlng);
      if (rectangleLayerRef.current) {
        rectangleLayerRef.current.setBounds(zeroBounds);
      } else {
        const rect = L.rectangle(zeroBounds, {
          color: '#06b6d4',
          weight: 2,
          fillColor: '#0891b2',
          fillOpacity: 0.25,
          dashArray: '4, 4'
        });
        rect.addTo(map);
        rectangleLayerRef.current = rect;
      }
    };

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (!isDrawingModeRef.current || !isMouseDownRef.current || !startLatLngRef.current) return;
      const currentBounds = L.latLngBounds(startLatLngRef.current, e.latlng);
      if (rectangleLayerRef.current) {
        rectangleLayerRef.current.setBounds(currentBounds);
      }
    };

    const onMouseUp = (e: L.LeafletMouseEvent) => {
      if (!isDrawingModeRef.current || !isMouseDownRef.current || !startLatLngRef.current) return;
      isMouseDownRef.current = false;

      const p1 = startLatLngRef.current;
      const p2 = e.latlng;
      startLatLngRef.current = null;

      const minLat = Math.min(p1.lat, p2.lat);
      const maxLat = Math.max(p1.lat, p2.lat);
      const minLon = Math.min(p1.lng, p2.lng);
      const maxLon = Math.max(p1.lng, p2.lng);

      // Require meaningful non-zero selection
      if (Math.abs(maxLat - minLat) < 0.0005 && Math.abs(maxLon - minLon) < 0.0005) {
        return;
      }

      const normMinLon = normalizeLongitude(minLon);
      const normMaxLon = normalizeLongitude(maxLon);

      const rawAOI: AOIBounds = [
        Number(normMinLon.toFixed(4)),
        Number(Math.max(-90, Math.min(90, minLat)).toFixed(4)),
        Number(normMaxLon.toFixed(4)),
        Number(Math.max(-90, Math.min(90, maxLat)).toFixed(4))
      ];

      const validation = validateBBox(rawAOI);
      if (validation.isValid) {
        onAOIChange(rawAOI);
      } else {
        console.warn('Invalid drawn AOI:', validation.error);
      }

      // Automatically exit draw mode once selection completes
      setIsDrawingMode(false);
    };

    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', onMouseUp);

    return () => {
      map.off('mousedown', onMouseDown);
      map.off('mousemove', onMouseMove);
      map.off('mouseup', onMouseUp);
    };
  }, [isDrawingMode, onAOIChange]);

  // Clear AOI Handler
  const handleClearAOI = useCallback(() => {
    setActiveDemoId(null);
    onAOIChange(null);
    if (rectangleLayerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(rectangleLayerRef.current);
      rectangleLayerRef.current = null;
    }
  }, [onAOIChange]);

  // Reset Map View to Global
  const handleResetView = useCallback(() => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.setView([20, 0], 2, { animate: true });
  }, []);

  // Select Demo Region
  const handleSelectDemoRegion = useCallback((region: DemoRegion) => {
    setActiveDemoId(region.id);
    onAOIChange(region.bounds);

    if (mapInstanceRef.current) {
      const [minLon, minLat, maxLon, maxLat] = region.bounds;
      mapInstanceRef.current.fitBounds(
        [[minLat, minLon], [maxLat, maxLon]],
        { padding: [50, 50], maxZoom: 13, animate: true }
      );
    }
  }, [onAOIChange]);

  // Derived validation details
  const aoiValidation = selectedAOI ? validateBBox(selectedAOI) : null;

  return (
    <div className={`glass-panel rounded-2xl border border-slate-800 bg-slate-900/80 shadow-2xl flex flex-col overflow-hidden ${className}`}>
      
      {/* Top Map Header & Controls */}
      <div className="p-3.5 border-b border-slate-800/80 bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800/80">
            <Globe2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-mono font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
              INTERACTIVE GLOBAL SATELLITE MAP & AOI SELECTOR
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                EPSG:4326 (WGS84)
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Pan, zoom, switch basemaps, and click-and-drag to select your Area of Interest
            </p>
          </div>
        </div>

        {/* Primary Controls Toolbar */}
        <div className="flex flex-wrap items-center gap-1.5">
          
          {/* Basemap Switcher */}
          <div className="flex items-center bg-slate-900 border border-slate-800 p-0.5 rounded-xl">
            <button
              onClick={() => setActiveBasemap('satellite')}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${
                activeBasemap === 'satellite'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Satellite
            </button>
            <button
              onClick={() => setActiveBasemap('streets')}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${
                activeBasemap === 'streets'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              Streets
            </button>
          </div>

          {/* Draw AOI Toggle */}
          <button
            onClick={() => setIsDrawingMode(!isDrawingMode)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all flex items-center gap-1.5 ${
              isDrawingMode
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 animate-pulse shadow-md'
                : 'bg-slate-800/80 hover:bg-slate-800 text-slate-200 border-slate-700'
            }`}
          >
            <Square className="w-3.5 h-3.5" />
            {isDrawingMode ? 'Drawing... (Drag on Map)' : 'Draw AOI'}
          </button>

          {/* Clear AOI */}
          {selectedAOI && (
            <button
              onClick={handleClearAOI}
              className="px-2.5 py-1.5 text-xs font-medium rounded-xl bg-slate-800/80 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-800/80 border border-slate-700 text-slate-300 transition-all flex items-center gap-1"
              title="Clear selected AOI rectangle"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          )}

          {/* Active Raster Overlay Badge & Controls */}
          {activeOverlay && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-cyan-950/80 border border-cyan-800 text-cyan-200 text-xs shadow-sm">
              <span className="font-mono text-[10px] font-bold text-cyan-400 uppercase tracking-wider">
                Overlay: {activeOverlay.title} ({Math.round(activeOverlay.opacity * 100)}%)
              </span>
              <button
                onClick={() => {
                  if (mapInstanceRef.current && activeOverlay.bounds) {
                    const [minLon, minLat, maxLon, maxLat] = activeOverlay.bounds;
                    mapInstanceRef.current.fitBounds(
                      [[minLat, minLon], [maxLat, maxLon]],
                      { padding: [40, 40], maxZoom: 14, animate: true }
                    );
                  }
                }}
                className="hover:text-cyan-100 underline text-[11px] ml-1 font-semibold"
                title="Fit map view to active raster overlay"
              >
                Fit
              </button>
              {onClearOverlay && (
                <button
                  onClick={onClearOverlay}
                  className="hover:text-rose-400 ml-1 text-slate-400 font-bold"
                  title="Remove overlay from map"
                >
                  &times;
                </button>
              )}
            </div>
          )}

          {/* Reset View */}
          <button
            onClick={handleResetView}
            className="px-2.5 py-1.5 text-xs font-medium rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700 transition-all flex items-center gap-1"
            title="Reset to global view"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset View
          </button>

        </div>
      </div>

      {/* Preset Demo Region Shortcuts Bar */}
      <div className="px-3.5 py-2 border-b border-slate-800/60 bg-slate-950/40 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-slate-400 font-mono text-[11px]">
          <span>VERIFIED DEMO REGIONS:</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {DEMO_REGIONS.map((region) => (
            <button
              key={region.id}
              onClick={() => handleSelectDemoRegion(region)}
              className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all border ${
                activeDemoId === region.id
                  ? 'bg-teal-500/20 text-teal-300 border-teal-500/50 shadow-sm'
                  : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border-slate-800 hover:border-slate-700'
              }`}
              title={`${region.description} — ${region.notes}`}
            >
              {region.name}
            </button>
          ))}
        </div>
      </div>

      {/* Map Viewport Area */}
      <div className="relative w-full h-[440px] bg-slate-950">
        
        {/* Leaflet Map Root */}
        <div ref={mapContainerRef} className="w-full h-full z-0" />

        {/* Tile Loading Indicator */}
        {isTileLoading && (
          <div className="absolute top-3 left-3 z-[1000] bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800 text-slate-300 text-xs flex items-center gap-2 shadow-lg">
            <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
            <span>Loading map tiles...</span>
          </div>
        )}

        {/* Tile Error Warning Banner */}
        {tileErrorOccurred && (
          <div className="absolute top-3 left-3 z-[1000] bg-amber-950/90 backdrop-blur-md px-3.5 py-2 rounded-xl border border-amber-800/80 text-amber-200 text-xs flex items-center gap-3 shadow-xl">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <span className="font-bold">Tile loading error:</span>
              <span className="text-amber-300/90 ml-1">
                {activeBasemap === 'satellite' ? 'Esri Satellite service unreachable.' : 'OpenStreetMap service unreachable.'}
              </span>
            </div>
            {activeBasemap === 'satellite' && (
              <button
                onClick={() => setActiveBasemap('streets')}
                className="px-2 py-0.5 rounded bg-amber-900/80 hover:bg-amber-800 text-amber-100 text-[11px] font-semibold transition-all border border-amber-700"
              >
                Switch to Streets
              </button>
            )}
          </div>
        )}

        {/* Drawing Mode Hint Overlay */}
        {isDrawingMode && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] bg-slate-950/90 backdrop-blur-md px-4 py-2 rounded-xl border border-amber-500/60 text-amber-200 text-xs font-mono shadow-2xl flex items-center gap-2">
            <Square className="w-4 h-4 text-amber-400 animate-pulse" />
            <span>Click and drag on the map to define the bounding rectangle</span>
          </div>
        )}

      </div>

      {/* Selected AOI Bounds Footer & Telemetry */}
      <div className="p-3.5 border-t border-slate-800/80 bg-slate-950/90 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs font-mono">
        
        {/* Bounds Display */}
        <div className="flex flex-wrap items-center gap-3 text-slate-300">
          <span className="text-slate-400 font-bold uppercase tracking-wider text-[11px]">
            Selected AOI (EPSG:4326):
          </span>

          {selectedAOI ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-cyan-950/80 text-cyan-300 border border-cyan-800 font-bold">
                {formatBBox(selectedAOI)}
              </span>

              <span className="text-slate-400 text-[11px]">
                [min_lon, min_lat, max_lon, max_lat]
              </span>

              {aoiValidation?.approxAreaKm2 && (
                <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800 text-[11px]">
                  ~{aoiValidation.approxAreaKm2.toLocaleString()} km²
                </span>
              )}

              {aoiValidation?.crossesAntimeridian && (
                <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[11px] flex items-center gap-1 font-sans">
                  <AlertTriangle className="w-3 h-3" />
                  Crosses Antimeridian (180°)
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-500 italic">
              No AOI selected. Click "Draw AOI" or pick a verified demo region above.
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto">
          {/* Toggle Analysis Parameters Drawer Button */}
          <button
            onClick={() => setIsAnalysisDrawerOpen(!isAnalysisDrawerOpen)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all flex items-center gap-1.5 ${
              isAnalysisDrawerOpen
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-sm'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
            }`}
            title="Configure bi-temporal date windows and optical cloud filter"
          >
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span>AOI Analysis Settings</span>
            {isAnalysisDrawerOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {/* Network & Offline Disclaimer Notice */}
          <div className="text-[10px] text-slate-500 font-sans flex items-center gap-1.5">
            <Info className="w-3 h-3 text-slate-600 shrink-0" />
            <span>Online tiles require internet.</span>
          </div>
        </div>

      </div>

      {/* AOI Analysis Parameters Drawer: Bi-Temporal Dates & Optical Cloud Filter */}
      {isAnalysisDrawerOpen && (
        <div className="border-t border-slate-800 bg-slate-950/95 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wider">
                Automated AOI Analysis Settings
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                STAC Search &amp; Bounded Acquisition
              </span>
            </div>
            
            {/* Live Chronological Status Indicator */}
            {bitemporalValidation.isValid ? (
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-800/60">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Valid Bi-Temporal Chronology</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-rose-300 bg-rose-950/60 px-2.5 py-1 rounded-lg border border-rose-800/80">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                <span>{bitemporalValidation.error}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Window 1: Pre-Event (T1) */}
            <div className="md:col-span-4 p-3 rounded-xl bg-slate-900/70 border border-cyan-900/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-cyan-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  PRE-EVENT (T1 - BASELINE)
                </span>
                <span className="text-[10px] text-slate-500 font-mono">Reference</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">START DATE</label>
                  <input
                    type="date"
                    value={config.t1StartDate}
                    onChange={(e) => updateConfig({ t1StartDate: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">END DATE</label>
                  <input
                    type="date"
                    value={config.t1EndDate}
                    onChange={(e) => updateConfig({ t1EndDate: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500 text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Window 2: Post-Event (T2) */}
            <div className="md:col-span-4 p-3 rounded-xl bg-slate-900/70 border border-indigo-900/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-indigo-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-indigo-400" />
                  POST-EVENT (T2 - CHANGED)
                </span>
                <span className="text-[10px] text-slate-500 font-mono">Impact state</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">START DATE</label>
                  <input
                    type="date"
                    value={config.t2StartDate}
                    onChange={(e) => updateConfig({ t2StartDate: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">END DATE</label>
                  <input
                    type="date"
                    value={config.t2EndDate}
                    onChange={(e) => updateConfig({ t2EndDate: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Cloud Cover Threshold Slider */}
            <div className="md:col-span-4 p-3 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-slate-300 flex items-center gap-1.5">
                  <Cloud className="w-3.5 h-3.5 text-cyan-400" />
                  MAX OPTICAL CLOUD COVER
                </span>
                <span className="text-xs font-mono font-bold text-cyan-300 px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-800">
                  {config.maxCloudCover}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={config.maxCloudCover}
                onChange={(e) => updateConfig({ maxCloudCover: Number(e.target.value) })}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
              <p className="text-[10px] text-slate-500 font-mono">
                Filters out Sentinel-2 scenes with cloud cover exceeding {config.maxCloudCover}% during STAC search.
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
