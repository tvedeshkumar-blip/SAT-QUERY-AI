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
  Info
} from 'lucide-react';
import { AOIBounds } from '../types';
import { 
  DEMO_REGIONS, 
  DemoRegion, 
  validateBBox, 
  formatBBox, 
  normalizeLongitude,
  calculateSphericalAreaKm2 
} from '../utils/geoBounds';

export interface MapViewerProps {
  selectedAOI: AOIBounds | null;
  onAOIChange: (aoi: AOIBounds | null) => void;
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
  className = ''
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const currentTileLayerRef = useRef<L.TileLayer | null>(null);
  const rectangleLayerRef = useRef<L.Rectangle | null>(null);

  const [activeBasemap, setActiveBasemap] = useState<BasemapType>('satellite');
  const [isTileLoading, setIsTileLoading] = useState<boolean>(false);
  const [tileErrorOccurred, setTileErrorOccurred] = useState<boolean>(false);
  const [isDrawingMode, setIsDrawingMode] = useState<boolean>(false);
  const [activeDemoId, setActiveDemoId] = useState<string | null>(null);

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

        {/* Network & Offline Disclaimer Notice */}
        <div className="text-[10px] text-slate-500 font-sans flex items-center gap-1.5 self-end sm:self-auto">
          <Info className="w-3 h-3 text-slate-600 shrink-0" />
          <span>Online basemap tiles require active internet connection.</span>
        </div>

      </div>

    </div>
  );
};
