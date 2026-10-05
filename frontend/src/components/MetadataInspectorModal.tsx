import React from 'react';
import { X, Globe, Layers, Cpu, Compass, Maximize2, Shield } from 'lucide-react';
import { GeoTIFFMetadata } from '../types';

interface MetadataInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  metadata: Partial<GeoTIFFMetadata> | null;
  filename?: string;
}

export const MetadataInspectorModal: React.FC<MetadataInspectorModalProps> = ({
  isOpen,
  onClose,
  metadata,
  filename,
}) => {
  if (!isOpen || !metadata) return null;

  const hasCrs = Boolean(metadata.crs);
  const crsDisplay = metadata.crs || 'CRS unavailable';
  const bounds = metadata.bounds;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="glass-panel w-full max-w-xl rounded-2xl border border-cyan-500/30 bg-slate-900/95 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="px-5 py-4 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold font-mono text-slate-100 uppercase tracking-wider">
                GEOSPATIAL RASTER METADATA INSPECTOR
              </h3>
              <p className="text-xs text-slate-400">{filename || metadata.filename || 'Satellite Scene'}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-100 border border-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 font-mono text-xs">
          
          <div className="grid grid-cols-2 gap-3">
            
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block uppercase">COORDINATE REFERENCE SYSTEM (CRS)</span>
              <span className={`font-bold text-sm block mt-1 ${hasCrs ? 'text-cyan-300' : 'text-slate-500'}`}>
                {crsDisplay}
              </span>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block uppercase">SENSOR MODALITY</span>
              <span className="text-teal-300 font-bold text-sm block mt-1">
                {metadata.modality || 'OPTICAL'}
              </span>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block uppercase">SPATIAL DIMENSIONS</span>
              <span className="text-slate-100 font-bold text-sm block mt-1">
                {metadata.width ? `${metadata.width} x ${metadata.height} px` : 'Dimension unavailable'}
              </span>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block uppercase">SPECTRAL BANDS & DTYPE</span>
              <span className="text-slate-100 font-bold text-sm block mt-1">
                {metadata.bands || 3} Band(s) ({metadata.dtype || 'uint8'})
              </span>
            </div>

          </div>

          {/* Spatial Bounds Box */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
            <span className="text-[10px] text-slate-400 block uppercase font-semibold">
              GEOGRAPHIC BOUNDING BOX EXTENT
            </span>
            {bounds && bounds.length >= 4 ? (
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                  <span className="text-[9px] text-slate-500 block">WEST (LEFT)</span>
                  <span className="text-slate-200 font-bold">{bounds[0]}</span>
                </div>
                <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                  <span className="text-[9px] text-slate-500 block">SOUTH (BOTTOM)</span>
                  <span className="text-slate-200 font-bold">{bounds[1]}</span>
                </div>
                <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                  <span className="text-[9px] text-slate-500 block">EAST (RIGHT)</span>
                  <span className="text-slate-200 font-bold">{bounds[2]}</span>
                </div>
                <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                  <span className="text-[9px] text-slate-500 block">NORTH (TOP)</span>
                  <span className="text-slate-200 font-bold">{bounds[3]}</span>
                </div>
              </div>
            ) : (
              <div className="p-3 text-center text-slate-500 text-xs italic">
                Spatial bounding box unavailable (unreferenced raster).
              </div>
            )}
          </div>

          {/* Geospatial Integrity Guarantee */}
          <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-800/60 text-slate-300 text-[11px] leading-relaxed flex items-start gap-2.5">
            <Shield className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-cyan-300">Geospatial Integrity Guarantee:</span>
              <p className="mt-0.5 text-slate-400">
                CRS and georeferencing are strictly reported from authentic raster metadata. Unreferenced images never default to guessed projections.
              </p>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
