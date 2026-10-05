import React, { useRef } from 'react';
import { Upload, FileCode, CheckCircle2, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { AnalysisMode } from '../types';
import { isGeoTIFF, formatFileSize } from '../utils/imageHelper';

export interface UploadedFileState {
  file?: File;
  dataUrl: string;
  filename: string;
  size?: number;
  role: 'primary' | 'secondary' | 'optical' | 'sar';
  isGeoTIFF: boolean;
}

interface ImageUploaderProps {
  mode: AnalysisMode;
  setMode: (mode: AnalysisMode) => void;
  files: UploadedFileState[];
  setFiles: React.Dispatch<React.SetStateAction<UploadedFileState[]>>;
  onClear: () => void;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({
  mode,
  setMode,
  files,
  setFiles,
  onClear,
}) => {
  const fileInputRef1 = useRef<HTMLInputElement>(null);
  const fileInputRef2 = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, role: 'primary' | 'secondary') => {
    if (!e.target.files || e.target.files.length === 0) return;
    const selectedFile = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const newUpload: UploadedFileState = {
        file: selectedFile,
        dataUrl,
        filename: selectedFile.name,
        size: selectedFile.size,
        role: mode === 'optical_sar' ? (role === 'primary' ? 'optical' : 'sar') : role,
        isGeoTIFF: isGeoTIFF(selectedFile.name),
      };

      setFiles((prev) => {
        const filtered = prev.filter((f) => f.role !== newUpload.role);
        return [...filtered, newUpload];
      });
    };
    reader.readAsDataURL(selectedFile);
  };

  const getPrimaryFile = () => files.find((f) => f.role === 'primary' || f.role === 'optical');
  const getSecondaryFile = () => files.find((f) => f.role === 'secondary' || f.role === 'sar');

  const primaryFile = getPrimaryFile();
  const secondaryFile = getSecondaryFile();

  return (
    <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-slate-900/60 shadow-xl space-y-4">
      
      {/* Mode Selector Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider font-mono flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
            ANALYSIS WORKSPACE MODE
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Select image ingestion modality & analysis configuration</p>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setMode('single')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mode === 'single'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            [ Single Image ]
          </button>

          <button
            onClick={() => setMode('bitemporal')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mode === 'bitemporal'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            [ Bi-Temporal ]
          </button>

          <button
            onClick={() => setMode('optical_sar')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mode === 'optical_sar'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            [ Optical + SAR ]
          </button>
        </div>
      </div>

      {/* Upload Inputs Grid */}
      <div className={`grid grid-cols-1 ${mode !== 'single' ? 'md:grid-cols-2' : ''} gap-4`}>
        
        {/* Input Slot 1 */}
        <div className="relative group">
          <label className="block text-xs font-mono font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
            <span>
              {mode === 'single' && 'SATELLITE RASTER INPUT'}
              {mode === 'bitemporal' && 'EARLIER SCENE (TIME T1)'}
              {mode === 'optical_sar' && 'OPTICAL / MULTISPECTRAL RASTER'}
            </span>
            {primaryFile?.isGeoTIFF && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-teal-950 text-teal-300 border border-teal-800">
                GeoTIFF (CRS Ready)
              </span>
            )}
          </label>

          <div
            onClick={() => fileInputRef1.current?.click()}
            className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all min-h-[140px] ${
              primaryFile
                ? 'border-cyan-500/50 bg-slate-900/90 hover:border-cyan-400'
                : 'border-slate-800 bg-slate-950/50 hover:border-slate-700 hover:bg-slate-900/40'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef1}
              onChange={(e) => handleFileChange(e, 'primary')}
              accept=".tif,.tiff,.geotiff,.png,.jpg,.jpeg"
              className="hidden"
            />

            {primaryFile ? (
              <div className="w-full flex items-center gap-3">
                <img
                  src={primaryFile.dataUrl}
                  alt="Primary scene preview"
                  className="w-16 h-16 object-cover rounded-lg border border-slate-700 shadow-md"
                />
                <div className="text-left flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-200 truncate">{primaryFile.filename}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {primaryFile.size ? formatFileSize(primaryFile.size) : 'Ready'}
                  </p>
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono text-cyan-400 mt-1">
                    <CheckCircle2 className="w-3 h-3 text-cyan-400" />
                    Ingested for Analysis
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Upload className="w-6 h-6 text-slate-400 mx-auto group-hover:text-cyan-400 transition-colors" />
                <p className="text-xs text-slate-300 font-medium">Drop satellite image or click to browse</p>
                <p className="text-[10px] text-slate-500 font-mono">GeoTIFF (.tif, .tiff), PNG, JPEG</p>
              </div>
            )}
          </div>
        </div>

        {/* Input Slot 2 (Conditional for Bi-Temporal or Optical+SAR) */}
        {mode !== 'single' && (
          <div className="relative group">
            <label className="block text-xs font-mono font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
              <span>
                {mode === 'bitemporal' && 'LATER SCENE (TIME T2)'}
                {mode === 'optical_sar' && 'SAR (SYNTHETIC APERTURE RADAR)'}
              </span>
              {secondaryFile?.isGeoTIFF && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-teal-950 text-teal-300 border border-teal-800">
                  GeoTIFF (CRS Ready)
                </span>
              )}
            </label>

            <div
              onClick={() => fileInputRef2.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all min-h-[140px] ${
                secondaryFile
                  ? 'border-cyan-500/50 bg-slate-900/90 hover:border-cyan-400'
                  : 'border-slate-800 bg-slate-950/50 hover:border-slate-700 hover:bg-slate-900/40'
              }`}
            >
              <input
                type="file"
                ref={fileInputRef2}
                onChange={(e) => handleFileChange(e, 'secondary')}
                accept=".tif,.tiff,.geotiff,.png,.jpg,.jpeg"
                className="hidden"
              />

              {secondaryFile ? (
                <div className="w-full flex items-center gap-3">
                  <img
                    src={secondaryFile.dataUrl}
                    alt="Secondary scene preview"
                    className="w-16 h-16 object-cover rounded-lg border border-slate-700 shadow-md"
                  />
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">{secondaryFile.filename}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {secondaryFile.size ? formatFileSize(secondaryFile.size) : 'Ready'}
                    </p>
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-cyan-400 mt-1">
                      <CheckCircle2 className="w-3 h-3 text-cyan-400" />
                      Ingested for Analysis
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Upload className="w-6 h-6 text-slate-400 mx-auto group-hover:text-cyan-400 transition-colors" />
                  <p className="text-xs text-slate-300 font-medium">Drop secondary image or click to browse</p>
                  <p className="text-[10px] text-slate-500 font-mono">GeoTIFF (.tif, .tiff), PNG, JPEG</p>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {files.length > 0 && (
        <div className="flex justify-end pt-1">
          <button
            onClick={onClear}
            className="text-xs font-mono text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Clear Ingested Imagery
          </button>
        </div>
      )}

    </div>
  );
};
