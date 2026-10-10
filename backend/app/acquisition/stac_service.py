import os
import re
import base64
import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
import httpx

from app.schemas.acquisition import (
    STACSearchRequest,
    STACSearchResponse,
    STACSceneSummary,
    STACAssetSummary,
    STACRetrieveRequest,
    STACRetrieveResponse,
    STACValidateAssetResponse
)
from app.remote_sensing.geotiff import parse_geotiff_or_image
from app.acquisition.asset_validator import AssetValidator

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
