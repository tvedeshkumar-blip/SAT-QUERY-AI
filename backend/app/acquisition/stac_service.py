import os
import re
import time
import base64
import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
import httpx
import numpy as np
import rasterio
from rasterio.io import MemoryFile

from app.schemas.acquisition import (
    STACSearchRequest,
    STACSearchResponse,
    STACSceneSummary,
    STACAssetSummary,
    STACRetrieveRequest,
    STACRetrieveResponse,
    STACWindowedRetrieveRequest,
    STACValidateAssetResponse
)
from app.remote_sensing.geotiff import parse_geotiff_or_image
from app.acquisition.asset_validator import AssetValidator
from app.acquisition.windowed_reader import SafeWindowedCOGReader, WindowedRetrievalError

logger = logging.getLogger("satquery.acquisition")

class STACAcquisitionService:
    """
    Modular STAC Satellite Imagery Acquisition Service.
    Connects to open public catalogs (Element84 Earth Search AWS)
    with strict asset validation, rate/timeout safety, and offline demonstration fallback.
    """

    DEFAULT_CATALOG_URL = "https://earth-search.aws.element84.com/v1"
    MAX_DOWNLOAD_BYTES = int(os.getenv("MAX_RETRIEVAL_BYTES", str(35 * 1024 * 1024)))  # 35 MB configurable limit
    REQUEST_TIMEOUT_SECONDS = 20.0


    ALLOWED_DOWNLOAD_HOSTS = {
        "earth-search.aws.element84.com",
        "sentinel-cogs.s3.us-west-2.amazonaws.com",
        "sentinel-s1-l1c.s3.amazonaws.com",
        "sentinel-s2-l2a.s3.amazonaws.com",
        "landsat-pds.s3.amazonaws.com",
        "s3.us-west-2.amazonaws.com",
        "s3.amazonaws.com"
    }

    def __init__(self, catalog_url: Optional[str] = None):
        self.catalog_url = catalog_url or os.getenv("STAC_CATALOG_URL", self.DEFAULT_CATALOG_URL).rstrip("/")
        # In-memory session cache of recently discovered scenes to prevent arbitrary URL injection
        self._scene_cache: Dict[str, Dict[str, Any]] = {}
        
        # Ensure persistent retrieval directory exists
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        self.retrieval_dir = os.path.join(base_dir, "data", "retrieved")
        self.samples_dir = os.path.join(base_dir, "data", "samples")
        os.makedirs(self.retrieval_dir, exist_ok=True)

    def search(self, req: STACSearchRequest) -> STACSearchResponse:
        """
        Executes a spatial-temporal search against the configured STAC catalog.
        """
        # 1. Validate Bounding Box
        min_lon, min_lat, max_lon, max_lat = req.bbox
        if min_lat > max_lat:
            return STACSearchResponse(
                status="error",
                catalog_url=self.catalog_url,
                search_bbox=req.bbox,
                collection_requested=req.collection or "all",
                total_results=0,
                error="Invalid bounding box: min_lat cannot be greater than max_lat."
            )

        # 2. Map collection filter
        collections = []
        col_req = (req.collection or "").lower().strip()
        if col_req in ("sentinel-2", "sentinel-2-l2a", "optical"):
            collections = ["sentinel-2-l2a"]
        elif col_req in ("sentinel-1", "sentinel-1-grd", "sar"):
            collections = ["sentinel-1-grd"]
        elif col_req == "all":
            collections = ["sentinel-2-l2a", "sentinel-1-grd"]
        else:
            collections = [req.collection] if req.collection else ["sentinel-2-l2a"]

        # 3. Format temporal window
        datetime_str = None
        if req.start_date and req.end_date:
            datetime_str = f"{req.start_date}T00:00:00Z/{req.end_date}T23:59:59Z"
        elif req.start_date:
            datetime_str = f"{req.start_date}T00:00:00Z/.."
        elif req.end_date:
            datetime_str = f"../{req.end_date}T23:59:59Z"

        # 4. Construct STAC payload
        payload: Dict[str, Any] = {
            "collections": collections,
            "bbox": [min_lon, min_lat, max_lon, max_lat],
            "limit": req.limit or 10
        }
        if datetime_str:
            payload["datetime"] = datetime_str

        # Add cloud cover query filter if requested and searching optical
        if "sentinel-2-l2a" in collections and req.max_cloud_cover is not None:
            payload["query"] = {
                "eo:cloud_cover": {"lte": float(req.max_cloud_cover)}
            }

        # 5. Query Live Catalog
        try:
            search_url = f"{self.catalog_url}/search"
            with httpx.Client(timeout=self.REQUEST_TIMEOUT_SECONDS) as client:
                resp = client.post(search_url, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    features = data.get("features", [])
                    return self._process_stac_features(features, req, datetime_str)
                else:
                    logger.warning(f"STAC search returned HTTP {resp.status_code}: {resp.text}")
                    return self._handle_catalog_error(req, f"STAC server error HTTP {resp.status_code}", datetime_str)

        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.NetworkError) as ne:
            logger.info(f"External STAC connection unavailable ({ne}). Checking offline sample catalog fallback.")
            return self._fallback_local_search(req, datetime_str, reason=str(ne))
        except Exception as e:
            logger.warning(f"Error querying STAC catalog ({e}). Falling back to offline verified sample catalog.")
            return self._fallback_local_search(req, datetime_str, reason=str(e))

    def _process_stac_features(
        self, 
        features: List[Dict[str, Any]], 
        req: STACSearchRequest, 
        datetime_str: Optional[str]
    ) -> STACSearchResponse:
        """
        Parses genuine STAC GeoJSON features into verified STACSceneSummary objects.
        """
        if not features:
            return STACSearchResponse(
                status="zero_results",
                catalog_url=self.catalog_url,
                search_bbox=req.bbox,
                search_datetime=datetime_str,
                collection_requested=req.collection or "all",
                total_results=0,
                message="No satellite acquisitions matched the specified spatial and temporal filters.",
                scenes=[]
            )

        scenes: List[STACSceneSummary] = []
        for feat in features:
            scene_id = feat.get("id", "unknown_scene")
            props = feat.get("properties", {})
            col = feat.get("collection") or "unknown_collection"
            geom = feat.get("geometry")
            bbox = feat.get("bbox") or req.bbox

            # Detect modality
            is_sar = "sentinel-1" in col.lower() or "sar" in col.lower()
            modality = "SAR" if is_sar else "OPTICAL"
            sensor = props.get("platform") or ("Sentinel-1" if is_sar else "Sentinel-2")
            cloud_cover = None if is_sar else props.get("eo:cloud_cover")

            # Assets extraction
            raw_assets = feat.get("assets", {})
            assets_dict: Dict[str, STACAssetSummary] = {}
            thumbnail_url = None

            for key, val in raw_assets.items():
                if not isinstance(val, dict):
                    continue
                href = val.get("href", "")
                mime = val.get("type", "application/octet-stream")
                roles = val.get("roles", [])

                # Classify category
                category = "unsupported"
                if "thumbnail" in roles or key in ("thumbnail", "preview", "quick-look"):
                    category = "visual_preview"
                    if not thumbnail_url and href:
                        thumbnail_url = self._format_accessible_href(href)
                elif "image/tiff" in mime or "geotiff" in mime or href.endswith(".tif") or href.endswith(".tiff"):
                    category = "scientific_raster"
                elif "visual" in roles or key == "visual":
                    category = "scientific_raster" if href.endswith(".tif") else "visual_preview"

                assets_dict[key] = STACAssetSummary(
                    key=key,
                    title=val.get("title") or key.capitalize(),
                    type=mime,
                    roles=roles,
                    category=category,
                    href=href,
                    size_bytes=val.get("file:size")
                )

            scene_summary = STACSceneSummary(
                id=scene_id,
                collection=col,
                datetime=props.get("datetime") or datetime.utcnow().isoformat() + "Z",
                bbox=bbox,
                geometry=geom,
                cloud_cover=round(float(cloud_cover), 2) if cloud_cover is not None else None,
                modality=modality,
                sensor=sensor,
                platform=props.get("platform"),
                thumbnail_url=thumbnail_url,
                assets=assets_dict,
                provenance={
                    "catalog": "Element84 Earth Search",
                    "license": "Copernicus Open Access / CC-BY-4.0",
                    "provider_url": self.catalog_url
                }
            )

            # Cache scene for safe retrieval
            self._scene_cache[scene_id] = {
                "summary": scene_summary,
                "raw_assets": raw_assets
            }
            scenes.append(scene_summary)

        return STACSearchResponse(
            status="success",
            catalog_url=self.catalog_url,
            search_bbox=req.bbox,
            search_datetime=datetime_str,
            collection_requested=req.collection or "all",
            total_results=len(scenes),
            scenes=scenes
        )

    def retrieve(self, req: STACRetrieveRequest) -> STACRetrieveResponse:
        """
        Safely retrieves a validated STAC asset for a given scene.
        Inspects asset category and extracts genuine raster or preview metadata.
        """
        # Directly handle local sample rasters
        if req.scene_id.startswith("local_sample_"):
            return self._retrieve_local_sample(req)

        cached = self._scene_cache.get(req.scene_id)
        if not cached:
            return STACRetrieveResponse(
                status="error",
                scene_id=req.scene_id,
                asset_key=req.asset_key,
                category="unsupported",
                filename="none",
                mime_type="none",
                size_bytes=0,
                data_base64="",
                error=f"Scene '{req.scene_id}' not found in active STAC search session. Please execute a search first."
            )

        raw_assets = cached.get("raw_assets", {})
        asset_info = raw_assets.get(req.asset_key)
        if not asset_info:
            # Strict integrity: Never substitute requested asset key silently with thumbnail
            available_keys = ", ".join(raw_assets.keys()) if raw_assets else "none"
            return STACRetrieveResponse(
                status="error",
                scene_id=req.scene_id,
                asset_key=req.asset_key,
                category="unsupported",
                filename="none",
                mime_type="none",
                size_bytes=0,
                data_base64="",
                error=f"Requested asset key '{req.asset_key}' is not available for scene '{req.scene_id}' (available assets: {available_keys})."
            )

        href = asset_info.get("href", "")
        clean_url = self._format_accessible_href(href)
        mime_type = asset_info.get("type", "application/octet-stream")

        provenance_data = {
            "provider": cached.get("provider", "Element84 Earth Search (AWS)"),
            "catalog_url": self.catalog_url,
            "collection": cached.get("collection", req.collection or "unknown"),
            "scene_id": req.scene_id,
            "datetime": cached.get("datetime"),
            "sensor": cached.get("sensor", "MSI"),
            "platform": cached.get("platform"),
            "modality": cached.get("modality", "OPTICAL"),
            "asset_key": req.asset_key,
            "asset_href": clean_url
        }

        # Check if asset metadata reports file size exceeding the safety cap
        reported_size = asset_info.get("file:size") or asset_info.get("size")
        if reported_size and reported_size > self.MAX_DOWNLOAD_BYTES:
            max_mb = self.MAX_DOWNLOAD_BYTES / (1024 * 1024)
            size_mb = reported_size / (1024 * 1024)
            return STACRetrieveResponse(
                status="error",
                scene_id=req.scene_id,
                asset_key=req.asset_key,
                category="unsupported",
                filename="none",
                mime_type=mime_type,
                size_bytes=reported_size,
                data_base64="",
                provenance=provenance_data,
                error=(
                    f"Asset size ({size_mb:.1f}MB) exceeds the configured retrieval safety limit of {max_mb:.0f}MB. "
                    "Full-tile Sentinel COG rasters require bounded sub-windowing or increasing MAX_RETRIEVAL_BYTES."
                )
            )

        # Security check: validate host
        if not self._is_safe_download_url(clean_url):
            return STACRetrieveResponse(
                status="error",
                scene_id=req.scene_id,
                asset_key=req.asset_key,
                category="unsupported",
                filename="none",
                mime_type="none",
                size_bytes=0,
                data_base64="",
                provenance=provenance_data,
                error=f"Asset URL domain is not in the whitelist of trusted satellite repositories."
            )

        # Download asset with streaming size guard
        try:
            with httpx.Client(timeout=self.REQUEST_TIMEOUT_SECONDS, follow_redirects=True) as client:
                with client.stream("GET", clean_url) as stream_resp:
                    if stream_resp.status_code != 200:
                        return STACRetrieveResponse(
                            status="error",
                            scene_id=req.scene_id,
                            asset_key=req.asset_key,
                            category="unsupported",
                            filename="none",
                            mime_type=mime_type,
                            size_bytes=0,
                            data_base64="",
                            provenance=provenance_data,
                            error=f"Failed to download asset: HTTP {stream_resp.status_code}"
                        )

                    content_chunks = []
                    total_bytes = 0
                    for chunk in stream_resp.iter_bytes(chunk_size=65536):
                        total_bytes += len(chunk)
                        if total_bytes > self.MAX_DOWNLOAD_BYTES:
                            max_mb = self.MAX_DOWNLOAD_BYTES / (1024 * 1024)
                            return STACRetrieveResponse(
                                status="error",
                                scene_id=req.scene_id,
                                asset_key=req.asset_key,
                                category="unsupported",
                                filename="none",
                                mime_type=mime_type,
                                size_bytes=total_bytes,
                                data_base64="",
                                provenance=provenance_data,
                                error=f"Asset download halted: size exceeds safe download limit ({total_bytes / (1024*1024):.1f}MB > {max_mb:.0f}MB)."
                            )
                        content_chunks.append(chunk)

            raw_bytes = b"".join(content_chunks)

        except Exception as dl_err:
            logger.error(f"Error downloading asset from {clean_url}: {dl_err}")
            return STACRetrieveResponse(
                status="error",
                scene_id=req.scene_id,
                asset_key=req.asset_key,
                category="unsupported",
                filename="none",
                mime_type=mime_type,
                size_bytes=0,
                data_base64="",
                provenance=provenance_data,
                error=f"Network error downloading asset: {str(dl_err)}"
            )

        # Determine extension and safe local filename
        ext = ".jpg" if "jpeg" in mime_type else (".png" if "png" in mime_type else ".tif")
        safe_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', f"{req.scene_id}_{req.asset_key}{ext}")
        local_path = os.path.join(self.retrieval_dir, safe_name)

        # Collision handling: do not overwrite silently
        if os.path.exists(local_path):
            if os.path.getsize(local_path) != len(raw_bytes):
                safe_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', f"{req.scene_id}_{req.asset_key}_{int(datetime.utcnow().timestamp())}{ext}")
                local_path = os.path.join(self.retrieval_dir, safe_name)

        with open(local_path, "wb") as f:
            f.write(raw_bytes)

        # Encode to Base64 for instant frontend display and workspace ingestion
        b64_data = base64.b64encode(raw_bytes).decode("utf-8")
        prefix = f"data:{mime_type};base64,"
        full_b64 = prefix + b64_data

        # Physical Asset Validation: inspect actual binary on disk
        validation_report = AssetValidator.validate_asset(
            local_path,
            filename=safe_name,
            provenance=provenance_data
        )

        raw_cat = validation_report["asset_category"]
        category = "scientific_raster" if raw_cat in ("scientific_raster", "rgb_visual_raster", "single_band_spectral", "multispectral_cube") else raw_cat
        limitations = validation_report["scientific_limitations"]
        raster_meta = validation_report["raster_metadata"]

        return STACRetrieveResponse(
            status="success",
            scene_id=req.scene_id,
            asset_key=req.asset_key,
            category=category,

            filename=safe_name,
            mime_type=mime_type,
            size_bytes=len(raw_bytes),
            data_base64=full_b64,
            metadata=raster_meta,
            scientific_limitations=limitations,
            validation=validation_report,
            provenance=provenance_data
        )

    @staticmethod
    def _array_to_geotiff_bytes(arr: np.ndarray, meta: Dict[str, Any]) -> bytes:
        """
        Serializes an in-memory numpy array and georeferencing metadata into standard GeoTIFF bytes.
        """
        mem = MemoryFile()
        transform = rasterio.Affine(*meta["transform"][:6])
        count = 1 if arr.ndim == 2 else arr.shape[2]
        dtype = arr.dtype
        h, w = arr.shape[:2]
        with mem.open(
            driver="GTiff",
            height=h,
            width=w,
            count=count,
            dtype=dtype,
            crs=meta["crs"],
            transform=transform,
            nodata=meta.get("nodata")
        ) as dst:
            if count == 1:
                dst.write(arr if arr.ndim == 2 else arr[:, :, 0], 1)
            else:
                for b in range(count):
                    dst.write(arr[:, :, b], b + 1)
            if "tags" in meta and meta["tags"]:
                dst.update_tags(**meta["tags"])
        return bytes(mem.getbuffer())

    def retrieve_window(self, req: STACWindowedRetrieveRequest) -> STACRetrieveResponse:
        """
        Stage 9: Safely retrieves a bounded spatial window (AOI crop) from a remote COG
        using HTTP 206 Range requests via SafeWindowedCOGReader.
        Serializes the resulting array into an in-memory GeoTIFF and validates it.
        """
        # Directly handle local sample rasters
        if req.scene_id.startswith("local_sample_"):
            return self._retrieve_local_sample_window(req)

        cached = self._scene_cache.get(req.scene_id)
        clean_url = None

        if cached:
            raw_assets = cached.get("raw_assets", {})
            asset_info = raw_assets.get(req.asset_key)
            if asset_info:
                clean_url = self._format_accessible_href(asset_info.get("href", ""))
            elif req.asset_url:
                clean_url = self._format_accessible_href(req.asset_url)
            else:
                available_keys = ", ".join(raw_assets.keys()) if raw_assets else "none"
                return STACRetrieveResponse(
                    status="error",
                    scene_id=req.scene_id,
                    asset_key=req.asset_key,
                    category="unsupported",
                    filename="none",
                    mime_type="none",
                    size_bytes=0,
                    data_base64="",
                    error=f"Requested asset key '{req.asset_key}' is not available for scene '{req.scene_id}' (available assets: {available_keys})."
                )
        elif req.asset_url:
            clean_url = self._format_accessible_href(req.asset_url)
        else:
            return STACRetrieveResponse(
                status="error",
                scene_id=req.scene_id,
                asset_key=req.asset_key,
                category="unsupported",
                filename="none",
                mime_type="none",
                size_bytes=0,
                data_base64="",
                error=f"Scene '{req.scene_id}' not found in active STAC search session. Please execute a search first or provide asset_url."
            )

        # Handle Planetary Computer SAS token if needed
        if "blob.core.windows.net" in clean_url or "planetarycomputer.microsoft.com" in clean_url:
            if "?" not in clean_url:
                try:
                    col = req.collection or (cached.get("collection") if cached else "sentinel-1-rtc")
                    token_url = f"https://planetarycomputer.microsoft.com/api/sas/v1/token/{col}"
                    with httpx.Client(timeout=10.0) as pc_client:
                        token_resp = pc_client.get(token_url)
                        if token_resp.status_code == 200:
                            token = token_resp.json().get("token")
                            if token:
                                clean_url = f"{clean_url}?{token}"
                except Exception as pc_err:
                    logger.warning(f"Planetary Computer SAS signing attempt warning: {pc_err}")

        # Execute safe windowed COG read
        try:
            arr, meta = SafeWindowedCOGReader.read_cog_window(
                url=clean_url,
                bbox_wgs84=req.aoi_bbox,
                max_bytes=req.max_bytes
            )
        except WindowedRetrievalError as wre:
            return STACRetrieveResponse(
                status="error",
                scene_id=req.scene_id,
                asset_key=req.asset_key,
                category="unsupported",
                filename="none",
                mime_type="image/tiff",
                size_bytes=0,
                data_base64="",
                error=f"Windowed retrieval failed: {str(wre)}"
            )
        except Exception as err:
            logger.error(f"Error during windowed COG read for {clean_url}: {err}")
            return STACRetrieveResponse(
                status="error",
                scene_id=req.scene_id,
                asset_key=req.asset_key,
                category="unsupported",
                filename="none",
                mime_type="image/tiff",
                size_bytes=0,
                data_base64="",
                error=f"Unexpected error during windowed retrieval: {str(err)}"
            )

        # Serialize cropped array to in-memory GeoTIFF
        try:
            raw_bytes = self._array_to_geotiff_bytes(arr, meta)
        except Exception as ser_err:
            return STACRetrieveResponse(
                status="error",
                scene_id=req.scene_id,
                asset_key=req.asset_key,
                category="unsupported",
                filename="none",
                mime_type="image/tiff",
                size_bytes=0,
                data_base64="",
                error=f"Failed to serialize windowed array to GeoTIFF: {str(ser_err)}"
            )

        # Determine safe local filename and persist for validation & session reuse
        safe_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', f"{req.scene_id}_{req.asset_key}_window_{int(time.time())}.tif")
        local_path = os.path.join(self.retrieval_dir, safe_name)
        with open(local_path, "wb") as f:
            f.write(raw_bytes)

        # Encode to Base64 data URI
        b64_data = base64.b64encode(raw_bytes).decode("utf-8")
        full_b64 = f"data:image/tiff;base64,{b64_data}"

        # Build provenance
        prov_summary = cached.get("summary") if cached else None
        provenance_data = {
            "provider": cached.get("provider", "Element84 Earth Search (AWS)") if cached else "STAC Provider",
            "catalog_url": self.catalog_url,
            "collection": req.collection or (cached.get("collection") if cached else "unknown"),
            "scene_id": req.scene_id,
            "datetime": getattr(prov_summary, "datetime", None) or (cached.get("datetime") if cached else None),
            "sensor": getattr(prov_summary, "sensor", None) or (cached.get("sensor") if cached else meta.get("tags", {}).get("SENSOR")),
            "modality": getattr(prov_summary, "modality", None) or (cached.get("modality") if cached else ("SAR" if "vv" in req.asset_key.lower() or "rtc" in req.asset_key.lower() else "OPTICAL")),
            "asset_key": req.asset_key,
            "asset_href": clean_url,
            "windowed_crop": True,
            "aoi_bbox": req.aoi_bbox,
            "target_role": req.target_role or "primary",
            "retrieval_method": "http_range_windowed_cog"
        }

        # Physical Asset Validation: inspect actual binary on disk
        validation_report = AssetValidator.validate_asset(
            local_path,
            filename=safe_name,
            provenance=provenance_data
        )

        raw_cat = validation_report.get("asset_category", "scientific_raster")
        category = "scientific_raster" if raw_cat in ("scientific_raster", "rgb_visual_raster", "single_band_spectral", "multispectral_cube") else raw_cat
        limitations = validation_report.get("scientific_limitations", [])
        raster_meta = validation_report.get("raster_metadata", {})

        return STACRetrieveResponse(
            status="success",
            scene_id=req.scene_id,
            asset_key=req.asset_key,
            category=category,
            filename=safe_name,
            mime_type="image/tiff",
            size_bytes=len(raw_bytes),
            data_base64=full_b64,
            metadata=raster_meta,
            scientific_limitations=limitations,
            validation=validation_report,
            provenance=provenance_data
        )

    def _retrieve_local_sample_window(self, req: STACWindowedRetrieveRequest) -> STACRetrieveResponse:
        """
        Handles local sample GeoTIFF window retrieval for offline testing.
        """
        name_part = req.scene_id.replace("local_sample_", "") + ".tif"
        sample_path = os.path.join(self.samples_dir, name_part)
        if not os.path.exists(sample_path):
            return STACRetrieveResponse(
                status="error",
                scene_id=req.scene_id,
                asset_key=req.asset_key,
                category="unsupported",
                filename=name_part,
                mime_type="image/tiff",
                size_bytes=0,
                data_base64="",
                error=f"Local sample raster '{name_part}' not found on disk."
            )

        from rasterio.windows import from_bounds
        from rasterio.warp import transform_bounds

        try:
            with rasterio.open(sample_path) as src:
                if str(src.crs) != "EPSG:4326":
                    target_bounds = transform_bounds("EPSG:4326", src.crs, *req.aoi_bbox)
                else:
                    target_bounds = req.aoi_bbox

                raw_win = from_bounds(*target_bounds, transform=src.transform)
                col_off = max(0, min(src.width - 1, int(np.floor(raw_win.col_off))))
                row_off = max(0, min(src.height - 1, int(np.floor(raw_win.row_off))))
                w_px = max(1, min(src.width - col_off, int(np.ceil(raw_win.width))))
                h_px = max(1, min(src.height - row_off, int(np.ceil(raw_win.height))))

                clamped_win = rasterio.windows.Window(col_off, row_off, w_px, h_px)
                data = src.read(window=clamped_win)
                if src.count == 1:
                    data = data[0]
                else:
                    data = np.transpose(data, (1, 2, 0))

                win_transform = src.window_transform(clamped_win)
                meta = {
                    "crs": str(src.crs),
                    "transform": list(win_transform)[:6],
                    "nodata": src.nodata,
                    "bands": src.count,
                    "tags": dict(src.tags()) if hasattr(src, "tags") else {}
                }

            raw_bytes = self._array_to_geotiff_bytes(data, meta)
            safe_name = f"{req.scene_id}_{req.asset_key}_window_{int(time.time())}.tif"
            local_path = os.path.join(self.retrieval_dir, safe_name)
            with open(local_path, "wb") as f:
                f.write(raw_bytes)

            full_b64 = "data:image/tiff;base64," + base64.b64encode(raw_bytes).decode("utf-8")
            prov_data = {
                "provider": "Local In-Repository GeoTIFF Catalog (Offline Fallback)",
                "catalog_url": "local://data/samples",
                "scene_id": req.scene_id,
                "asset_key": req.asset_key,
                "windowed_crop": True,
                "aoi_bbox": req.aoi_bbox,
                "target_role": req.target_role or "primary",
                "retrieval_method": "local_sample_windowed"
            }
            validation_report = AssetValidator.validate_asset(local_path, filename=safe_name, provenance=prov_data)
            return STACRetrieveResponse(
                status="success",
                scene_id=req.scene_id,
                asset_key=req.asset_key,
                category="scientific_raster",
                filename=safe_name,
                mime_type="image/tiff",
                size_bytes=len(raw_bytes),
                data_base64=full_b64,
                metadata=validation_report.get("raster_metadata", {}),
                scientific_limitations=validation_report.get("scientific_limitations", []),
                validation=validation_report,
                provenance=prov_data
            )
        except Exception as e:
            return STACRetrieveResponse(
                status="error",
                scene_id=req.scene_id,
                asset_key=req.asset_key,
                category="unsupported",
                filename=name_part,
                mime_type="image/tiff",
                size_bytes=0,
                data_base64="",
                error=f"Error reading local sample window: {str(e)}"
            )



    def _fallback_local_search(
        self, 
        req: STACSearchRequest, 
        datetime_str: Optional[str], 
        reason: str = ""
    ) -> STACSearchResponse:
        """
        Authentic local offline demonstration catalog.
        Exposes genuine pre-packaged GeoTIFF test rasters from data/samples/
        when the external cloud STAC provider cannot be reached.
        """
        scenes: List[STACSceneSummary] = []
        samples_available = [
            {
                "id": "local_sample_cartosat_optical_bengaluru",
                "collection": "cartosat-optical-l2",
                "datetime": "2024-03-15T05:30:00Z",
                "bbox": [77.4500, 12.8500, 77.7500, 13.1500],
                "cloud_cover": 0.0,
                "modality": "OPTICAL",
                "sensor": "Cartosat-2S / LISS-4",
                "file": "cartosat_optical_bengaluru.tif"
            },
            {
                "id": "local_sample_risat_sar_mumbai",
                "collection": "risat-c-band-sar",
                "datetime": "2024-03-20T01:15:00Z",
                "bbox": [72.7500, 18.8800, 73.0500, 19.2500],
                "cloud_cover": None,
                "modality": "SAR",
                "sensor": "RISAT-1A (C-Band FRS)",
                "file": "risat_sar_mumbai.tif"
            },
            {
                "id": "local_sample_temporal_t1_pre_monsoon",
                "collection": "cartosat-multitemporal",
                "datetime": "2023-04-10T05:30:00Z",
                "bbox": [77.4500, 12.8500, 77.7500, 13.1500],
                "cloud_cover": 1.2,
                "modality": "OPTICAL",
                "sensor": "Cartosat-2A",
                "file": "temporal_t1_pre_monsoon.tif"
            },
            {
                "id": "local_sample_temporal_t2_post_monsoon",
                "collection": "cartosat-multitemporal",
                "datetime": "2023-11-05T05:30:00Z",
                "bbox": [77.4500, 12.8500, 77.7500, 13.1500],
                "cloud_cover": 2.5,
                "modality": "OPTICAL",
                "sensor": "Cartosat-2A",
                "file": "temporal_t2_post_monsoon.tif"
            }
        ]

        target_col = (req.collection or "all").lower()
        for s in samples_available:
            if target_col in ("sentinel-1-grd", "sar") and s["modality"] != "SAR":
                continue
            if target_col in ("sentinel-2-l2a", "optical") and s["modality"] != "OPTICAL":
                continue

            summary = STACSceneSummary(
                id=s["id"],
                collection=s["collection"],
                datetime=s["datetime"],
                bbox=s["bbox"],
                cloud_cover=s["cloud_cover"],
                modality=s["modality"],
                sensor=s["sensor"],
                assets={
                    "visual": STACAssetSummary(
                        key="visual",
                        title="Authentic GeoTIFF Raster",
                        type="image/tiff",
                        roles=["data", "visual"],
                        category="scientific_raster",
                        href=s["file"]
                    )
                },
                provenance={
                    "catalog": "Local Offline Verified EO Repository",
                    "note": f"Cloud STAC offline ({reason}). Providing verified in-repository sample GeoTIFF."
                }
            )
            self._scene_cache[s["id"]] = {"summary": summary, "file": s["file"]}
            scenes.append(summary)

        return STACSearchResponse(
            status="success",
            catalog_url="local://data/samples",
            provider="Local In-Repository GeoTIFF Catalog (Offline Fallback)",
            search_bbox=req.bbox,
            search_datetime=datetime_str,
            collection_requested=req.collection or "all",
            total_results=len(scenes),
            scenes=scenes,
            message="Cloud STAC catalog was unreachable. Displaying authentic local verified GeoTIFF acquisitions."
        )

    def _retrieve_local_sample(self, req: STACRetrieveRequest) -> STACRetrieveResponse:
        """
        Loads pre-packaged sample GeoTIFF files from data/samples/.
        """
        cached = self._scene_cache.get(req.scene_id, {})
        filename = cached.get("file")
        if not filename:
            # Map filename from id
            name_part = req.scene_id.replace("local_sample_", "") + ".tif"
            filename = name_part

        sample_path = os.path.join(self.samples_dir, filename)
        if not os.path.exists(sample_path):
            return STACRetrieveResponse(
                status="error",
                scene_id=req.scene_id,
                asset_key=req.asset_key,
                category="unsupported",
                filename=filename,
                mime_type="image/tiff",
                size_bytes=0,
                data_base64="",
                error=f"Local sample raster '{filename}' not found on disk."
            )

        with open(sample_path, "rb") as f:
            raw_bytes = f.read()

        b64_str = "data:image/tiff;base64," + base64.b64encode(raw_bytes).decode("utf-8")
        
        prov_data = {
            "provider": "Local In-Repository GeoTIFF Catalog (Offline Fallback)",
            "catalog_url": "local://data/samples",
            "collection": "local-samples",
            "scene_id": req.scene_id,
            "datetime": "2024-03-20T00:00:00Z",
            "asset_key": req.asset_key,
            "filename": filename
        }

        validation_report = AssetValidator.validate_asset(
            sample_path,
            filename=filename,
            provenance=prov_data,
            reported_category="scientific_raster"
        )

        raw_cat = validation_report["asset_category"]
        category = "scientific_raster" if raw_cat in ("scientific_raster", "rgb_visual_raster", "single_band_spectral", "multispectral_cube") else raw_cat

        return STACRetrieveResponse(
            status="success",
            scene_id=req.scene_id,
            asset_key=req.asset_key,
            category=category,
            filename=filename,

            mime_type="image/tiff",
            size_bytes=len(raw_bytes),
            data_base64=b64_str,
            metadata=validation_report["raster_metadata"],
            scientific_limitations=validation_report["scientific_limitations"],
            validation=validation_report,
            provenance=prov_data
        )


    def _format_accessible_href(self, href: str) -> str:
        """
        Converts S3 protocol URLs to public HTTPS endpoints where applicable.
        """
        if href.startswith("s3://"):
            # E.g. s3://sentinel-s1-l1c/... -> https://sentinel-s1-l1c.s3.amazonaws.com/...
            clean = href.replace("s3://", "")
            bucket, key = clean.split("/", 1)
            return f"https://{bucket}.s3.amazonaws.com/{key}"
        return href

    def _is_safe_download_url(self, url: str) -> bool:
        """
        Validates that URL points to trusted remote sensing data providers.
        """
        if not url.startswith("https://") and not url.startswith("http://"):
            return False
        from urllib.parse import urlparse
        hostname = urlparse(url).hostname or ""
        return any(hostname == allowed or hostname.endswith("." + allowed) for allowed in self.ALLOWED_DOWNLOAD_HOSTS)

    def _handle_catalog_error(self, req: STACSearchRequest, error_msg: str, dt_str: Optional[str]) -> STACSearchResponse:
        return STACSearchResponse(
            status="error",
            catalog_url=self.catalog_url,
            search_bbox=req.bbox,
            search_datetime=dt_str,
            collection_requested=req.collection or "all",
            total_results=0,
            error=error_msg,
            scenes=[]
        )

# Global Acquisition Service Instance
stac_service = STACAcquisitionService()
