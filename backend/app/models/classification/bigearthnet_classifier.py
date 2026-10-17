import os
import logging
from typing import Dict, Any, Optional, List, Union
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from app.models.base import BaseModel

logger = logging.getLogger("satquery.models.bigearthnet")

# Official BigEarthNet v2.0 (reBEN) 10 Sentinel-2 bands in standard ESA/reBEN order
BAND_NAMES: List[str] = [
    "B02",  # Blue (10m)
    "B03",  # Green (10m)
    "B04",  # Red (10m)
    "B05",  # Vegetation Red Edge 1 (20m)
    "B06",  # Vegetation Red Edge 2 (20m)
    "B07",  # Vegetation Red Edge 3 (20m)
    "B08",  # NIR (10m)
    "B8A",  # Narrow NIR (20m)
    "B11",  # SWIR-1 (20m)
    "B12",  # SWIR-2 (20m)
]

BAND_DESCRIPTIONS: Dict[str, str] = {
    "B02": "Blue (10m, 490 nm)",
    "B03": "Green (10m, 560 nm)",
    "B04": "Red (10m, 665 nm)",
    "B05": "Vegetation Red Edge 1 (20m, 705 nm)",
    "B06": "Vegetation Red Edge 2 (20m, 740 nm)",
    "B07": "Vegetation Red Edge 3 (20m, 783 nm)",
    "B08": "NIR (10m, 842 nm)",
    "B8A": "Narrow NIR (20m, 865 nm)",
    "B11": "SWIR-1 (20m, 1610 nm)",
    "B12": "SWIR-2 (20m, 2190 nm)",
}

# Official BigEarthNet v2.0 channel normalization statistics for the 10 bands
# Computed across the official training split at 120x120 resolution (reBEN benchmark)
CHANNEL_MEANS: np.ndarray = np.array(
    [438.3721, 614.0557, 588.4096, 942.8433, 1769.9316, 2049.5515, 2193.2920, 2235.5566, 1568.2268, 997.7325],
    dtype=np.float32,
)

CHANNEL_STDS: np.ndarray = np.array(
    [607.0269, 603.2968, 684.5688, 738.4327, 1100.4561, 1275.8054, 1369.3717, 1356.5441, 1070.1613, 813.5276],
    dtype=np.float32,
)

# Standard CORINE Land Cover (CLC) 19-class nomenclature, lexicographically sorted
# Matches the exact 19 multi-label output logits of BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.2.0
BIGEARTHNET_19_CLASSES: List[str] = [
    "Agro-forestry areas",
    "Arable land",
    "Beaches, dunes, sands",
    "Broad-leaved forest",
    "Coastal wetlands",
    "Complex cultivation patterns",
    "Coniferous forest",
    "Industrial or commercial units",
    "Inland waters",
    "Inland wetlands",
    "Land principally occupied by agriculture, with significant areas of natural vegetation",
    "Marine waters",
    "Mixed forest",
    "Moors, heathland and sclerophyllous vegetation",
    "Natural grassland and sparsely vegetated areas",
    "Pastures",
    "Permanent crops",
    "Transitional woodland, shrub",
    "Urban fabric",
]

TARGET_SPATIAL_SIZE = (120, 120)


def build_resnet50_s2_architecture() -> nn.Module:
    """
    Constructs the exact ResNet-50 architecture matching BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.2.0:
    - 10-channel Conv2d input layer (kernel=7, stride=2, padding=3, bias=False)
    - ResNet-50 convolutional backbone (Bottleneck layers 1-4)
    - 19-class linear head (Linear(2048, 19))
    """
    import torchvision.models as tv_models

    model = tv_models.resnet50(weights=None)
    model.conv1 = nn.Conv2d(10, 64, kernel_size=7, stride=2, padding=3, bias=False)
    model.fc = nn.Linear(2048, 19)
    return model


class BigEarthNetResNet50Classifier(BaseModel):
    """
    Specialist Land-Cover Classification Model:
    BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.2.0

    This model is a ResNet-50 multi-label image classifier pre-trained on the refined
    BigEarthNet v2.0 (reBEN) dataset using 10 Sentinel-2 spectral bands.

    Key Specifications:
    - Task: Multi-label land-cover classification (19 CORINE Land Cover classes).
    - Architecture: ResNet-50 backbone with 10-channel conv1 and 19-class output linear layer.
    - Required input bands: 10 Sentinel-2 bands in ESA/reBEN order
      ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12'].
    - Input spatial dimensions: 120 x 120 pixels (bilinearly resized if different).
    - Normalization: Per-channel standardization using official reBEN dataset statistics.
    - Output activation: Sigmoid multi-label probabilities in range [0.0, 1.0].
    - Scientific integrity: Never substitutes random weights or hallucinates predictions.
    """

    def __init__(
        self,
        model_id: str = "BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.2.0",
        checkpoint_path: Optional[str] = None,
        device: Optional[str] = None,
    ):
        super().__init__(
            model_name=model_id,
            task_type="land_cover_classification",
            implementation_status="unavailable",
            is_trained=True,
            is_remote_sensing_adapted=True,
            license="MIT",
            version="0.2.0",
        )
        self.model_id = model_id
        self.checkpoint_path = checkpoint_path
        self._device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model: Optional[nn.Module] = None
        self._load_error: Optional[str] = None

    @property
    def status(self) -> str:
        if self._is_loaded:
            return "loaded"
        if self._load_error:
            return "model_loading_error"
        return "unavailable"

    def load(self, force_reload: bool = False) -> None:
        """
        Loads official pretrained weights into the ResNet-50 architecture.
        Attempts to resolve weights from:
        1. Explicitly configured checkpoint_path
        2. Hugging Face Hub cache / download from 'BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.2.0'

        Never silently falls back to random weights or mock predictions.
        """
        if self._is_loaded and not force_reload:
            return

        logger.info(f"Loading BigEarthNet ResNet-50 model '{self.model_id}' on device '{self._device}'...")
        self._load_error = None
        self._is_loaded = False

        try:
            # 1. Resolve weight file path
            resolved_weight_path = None
            if self.checkpoint_path:
                if not os.path.isfile(self.checkpoint_path):
                    err_msg = (
                        f"Specified checkpoint file for '{self.model_id}' was not found at '{self.checkpoint_path}'. "
                        "SatQuery AI enforces scientific integrity and will never silently substitute random weights."
                    )
                    self._load_error = err_msg
                    self.implementation_status = "model_loading_error"
                    logger.error(err_msg)
                    raise FileNotFoundError(err_msg)
                resolved_weight_path = self.checkpoint_path
            else:
                try:
                    from huggingface_hub import hf_hub_download
                    resolved_weight_path = hf_hub_download(
                        repo_id=self.model_id,
                        filename="model.safetensors",
                    )
                except Exception as dl_err:
                    err_msg = (
                        f"Failed to download or locate model weights for '{self.model_id}': {dl_err}. "
                        "SatQuery AI enforces scientific integrity and will never silently substitute "
                        "random weights or fabricate classification predictions."
                    )
                    self._load_error = err_msg
                    self.implementation_status = "model_loading_error"
                    logger.error(err_msg)
                    raise RuntimeError(err_msg) from dl_err

            if not resolved_weight_path or not os.path.isfile(resolved_weight_path):
                err_msg = (
                    f"Model weights file for '{self.model_id}' was not found at '{resolved_weight_path}'. "
                    "SatQuery AI will not run uninitialized random weights."
                )
                self._load_error = err_msg
                self.implementation_status = "model_loading_error"
                logger.error(err_msg)
                raise FileNotFoundError(err_msg)

            # 2. Build exact architecture
            model = build_resnet50_s2_architecture()

            # 3. Load state dict from safetensors or PyTorch checkpoint
            if resolved_weight_path.endswith(".safetensors"):
                from safetensors import safe_open

                state_dict = {}
                with safe_open(resolved_weight_path, framework="pt", device="cpu") as f:
                    for k in f.keys():
                        clean_key = k.replace("model.vision_encoder.", "").replace("vision_encoder.", "")
                        state_dict[clean_key] = f.get_tensor(k)
            else:
                raw_state = torch.load(resolved_weight_path, map_location="cpu")
                if "state_dict" in raw_state:
                    raw_state = raw_state["state_dict"]
                state_dict = {
                    k.replace("model.vision_encoder.", "").replace("vision_encoder.", ""): v
                    for k, v in raw_state.items()
                }

            # 4. Strict load into architecture
            try:
                model.load_state_dict(state_dict, strict=True)
            except RuntimeError as align_err:
                err_msg = f"Weight alignment mismatch loading '{self.model_id}': {align_err}"
                self._load_error = err_msg
                self.implementation_status = "model_loading_error"
                logger.error(err_msg)
                raise RuntimeError(err_msg) from align_err

            model.to(self._device)
            model.eval()

            self.model = model
            self._is_loaded = True
            self.implementation_status = "pretrained_model"
            self._load_error = None
            logger.info(f"Successfully loaded '{self.model_id}' weights from '{resolved_weight_path}'.")

        except Exception as e:
            self._is_loaded = False
            self.implementation_status = "model_loading_error"
            if not self._load_error:
                self._load_error = str(e)
            logger.error(f"Error initializing '{self.model_id}': {e}")
            raise

    def preprocess(
        self,
        image: Union[np.ndarray, torch.Tensor],
        band_names: Optional[List[str]] = None,
    ) -> torch.Tensor:
        """
        Prepares raw satellite imagery for model forward pass:
        1. Formats input into tensor (1, 10, H, W)
        2. Validates that exactly 10 bands are provided (or reorders them if band_names supplied)
        3. Detects unit scale: scales reflectance [0.0, 1.0] to native Sentinel-2 DN scale [0, 10000]
        4. Bilinearly resizes spatial dimensions to (120, 120)
        5. Standardizes each channel using the official reBEN channel means and standard deviations
        """
        if isinstance(image, np.ndarray):
            tensor = torch.from_numpy(image.copy()).float()
        elif isinstance(image, torch.Tensor):
            tensor = image.clone().float()
        else:
            raise TypeError(f"Expected numpy.ndarray or torch.Tensor, got {type(image)}")

        # Handle dimensions
        if tensor.ndim == 3:
            # Check if channel-first (10, H, W) or channel-last (H, W, 10)
            if tensor.shape[0] == 10:
                tensor = tensor.unsqueeze(0)  # (1, 10, H, W)
            elif tensor.shape[2] == 10:
                tensor = tensor.permute(2, 0, 1).unsqueeze(0)  # (1, 10, H, W)
            else:
                raise ValueError(
                    f"BigEarthNet ResNet-50 requires exactly 10 Sentinel-2 bands {BAND_NAMES}. "
                    f"Received tensor with shape {list(tensor.shape)} (no dimension has 10 channels)."
                )
        elif tensor.ndim == 4:
            if tensor.shape[1] != 10:
                if tensor.shape[3] == 10:
                    tensor = tensor.permute(0, 3, 1, 2)
                else:
                    raise ValueError(
                        f"BigEarthNet ResNet-50 requires exactly 10 Sentinel-2 bands {BAND_NAMES}. "
                        f"Received batch with shape {list(tensor.shape)}."
                    )
        else:
            raise ValueError(f"Invalid input tensor dimensionality: {tensor.ndim}. Expected 3 or 4 dimensions.")

        # Reorder bands if custom band_names provided
        if band_names is not None:
            if len(band_names) != 10:
                raise ValueError(
                    f"Provided band_names list must contain exactly 10 bands {BAND_NAMES}. "
                    f"Got {band_names}."
                )
            band_name_upper = [b.upper() for b in band_names]
            for required_band in BAND_NAMES:
                if required_band not in band_name_upper:
                    raise ValueError(
                        f"Missing required Sentinel-2 band '{required_band}'. "
                        f"Required bands: {BAND_NAMES}. Provided: {band_names}."
                    )
            reorder_indices = [band_name_upper.index(b) for b in BAND_NAMES]
            tensor = tensor[:, reorder_indices, :, :]

        # Detect scale: If values are float reflectance in range [0, 2], scale to native Sentinel-2 DN [0, 10000]
        max_val = float(tensor.max())
        if max_val <= 2.0 and max_val > 0.0:
            tensor = tensor * 10000.0

        # Bilinearly resize to target spatial dimensions (120, 120)
        if tensor.shape[2:] != TARGET_SPATIAL_SIZE:
            tensor = F.interpolate(tensor, size=TARGET_SPATIAL_SIZE, mode="bilinear", align_corners=False)

        # Standardize per channel: (x - mean) / std
        means_t = torch.from_numpy(CHANNEL_MEANS).view(1, 10, 1, 1).to(tensor.device)
        stds_t = torch.from_numpy(CHANNEL_STDS).view(1, 10, 1, 1).to(tensor.device)
        tensor = (tensor - means_t) / stds_t

        return tensor

    def predict(
        self,
        images: List[np.ndarray],
        query: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        threshold: float = 0.5,
    ) -> Dict[str, Any]:
        """
        Executes multi-label land-cover classification on 10-band Sentinel-2 imagery.

        Returns:
        - predicted_classes: list of classes exceeding the probability threshold
        - class_probabilities: dictionary of all 19 CORINE classes with probabilities [0.0, 1.0]
        - top_predictions: ranked list of {label, probability}
        - metadata: provenance recording model ID, bands, spatial size, and normalization
        """
        if not self._is_loaded or self.model is None:
            err_msg = (
                f"Model '{self.model_id}' is not loaded. Cannot run inference without authentic weights. "
                f"Call load() first. (Last error: {self._load_error})"
            )
            raise RuntimeError(err_msg)

        if not images:
            raise ValueError("No input image arrays provided for prediction.")

        raw_image = images[0]
        band_names = metadata.get("band_names") if metadata else None

        input_tensor = self.preprocess(raw_image, band_names=band_names).to(self._device)

        with torch.no_grad():
            logits = self.model(input_tensor)
            probs = torch.sigmoid(logits).squeeze(0).cpu().numpy()

        class_probs = {cls_name: float(probs[i]) for i, cls_name in enumerate(BIGEARTHNET_19_CLASSES)}
        sorted_preds = sorted(class_probs.items(), key=lambda kv: kv[1], reverse=True)

        predicted_classes = [c for c, p in sorted_preds if p >= threshold]

        return {
            "model_name": self.model_name,
            "task": self.task_type,
            "implementation_status": self.implementation_status,
            "is_remote_sensing_adapted": True,
            "bands_used": BAND_NAMES,
            "input_shape": list(input_tensor.shape),
            "target_spatial_size": list(TARGET_SPATIAL_SIZE),
            "threshold": threshold,
            "predicted_classes": predicted_classes,
            "class_probabilities": class_probs,
            "top_predictions": [{"label": c, "probability": round(float(p), 6)} for c, p in sorted_preds],
            "metadata": {
                "source": f"https://huggingface.co/{self.model_id}",
                "backbone": "ResNet-50",
                "dataset": "BigEarthNet v2.0 (reBEN)",
                "normalization": "reBEN official channel means and stds",
                "weights_status": "authentic_official_checkpoint",
            },
        }
