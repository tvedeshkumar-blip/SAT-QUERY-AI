import os
import sys
import pytest
import numpy as np
import torch
from unittest.mock import patch

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.models.classification.bigearthnet_classifier import (
    BigEarthNetResNet50Classifier,
    BAND_NAMES,
    BIGEARTHNET_19_CLASSES,
    CHANNEL_MEANS,
    CHANNEL_STDS,
    TARGET_SPATIAL_SIZE,
)
from app.agent.registry import model_registry
from app.evaluation.dataset_adapter import BigEarthNetAdapter


class TestBigEarthNetModelSpecification:
    """Validates the official BigEarthNet v2.0 (reBEN) Sentinel-2 model contracts."""

    def test_official_band_specifications(self):
        assert len(BAND_NAMES) == 10
        expected_bands = ["B02", "B03", "B04", "B05", "B06", "B07", "B08", "B8A", "B11", "B12"]
        assert BAND_NAMES == expected_bands

    def test_official_corine_classes(self):
        assert len(BIGEARTHNET_19_CLASSES) == 19
        # Must be lexicographically sorted
        assert BIGEARTHNET_19_CLASSES == sorted(BIGEARTHNET_19_CLASSES)
        assert "Urban fabric" in BIGEARTHNET_19_CLASSES
        assert "Coniferous forest" in BIGEARTHNET_19_CLASSES
        assert "Inland waters" in BIGEARTHNET_19_CLASSES
        assert "Arable land" in BIGEARTHNET_19_CLASSES

    def test_channel_statistics_shapes(self):
        assert CHANNEL_MEANS.shape == (10,)
        assert CHANNEL_STDS.shape == (10,)
        assert np.all(CHANNEL_STDS > 0)
        assert TARGET_SPATIAL_SIZE == (120, 120)


class TestBigEarthNetModelLoadingAndInference:
    """Validates real model loading, genuine neural inference, and output contracts."""

    @pytest.fixture(scope="class")
    def loaded_classifier(self):
        classifier = BigEarthNetResNet50Classifier()
        classifier.load()
        return classifier

    def test_successful_model_loading_architecture(self, loaded_classifier):
        assert loaded_classifier.is_loaded is True
        assert loaded_classifier.status == "loaded"
        assert loaded_classifier.implementation_status == "pretrained_model"
        assert loaded_classifier.is_remote_sensing_adapted is True
        assert loaded_classifier.model is not None

        # Verify internal layer dimensions
        assert loaded_classifier.model.conv1.in_channels == 10
        assert loaded_classifier.model.conv1.out_channels == 64
        assert loaded_classifier.model.fc.out_features == 19
        assert loaded_classifier.model.fc.in_features == 2048

    def test_real_sample_inference_with_genuine_weights(self, loaded_classifier):
        # Create realistic 10-band synthetic test raster (10, 120, 120) in Sentinel-2 DN scale
        np.random.seed(42)
        # Reflectance scaled to DN: B02~400, B03~600, B04~550, B08~2200
        synthetic_scene = np.zeros((10, 120, 120), dtype=np.float32)
        for c in range(10):
            synthetic_scene[c, :, :] = CHANNEL_MEANS[c] + np.random.randn(120, 120).astype(np.float32) * 50.0

        result = loaded_classifier.predict([synthetic_scene], threshold=0.3)

        assert result["model_name"] == "BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.2.0"
        assert result["task"] == "land_cover_classification"
        assert result["implementation_status"] == "pretrained_model"
        assert result["is_remote_sensing_adapted"] is True
        assert result["bands_used"] == BAND_NAMES
        assert result["target_spatial_size"] == [120, 120]
        assert len(result["class_probabilities"]) == 19

        # Verify all 19 classes have valid probabilities in [0.0, 1.0]
        for cls_name in BIGEARTHNET_19_CLASSES:
            assert cls_name in result["class_probabilities"]
            prob = result["class_probabilities"][cls_name]
            assert isinstance(prob, float)
            assert 0.0 <= prob <= 1.0

        # Verify top predictions are sorted descending
        top_preds = result["top_predictions"]
        assert len(top_preds) == 19
        for i in range(len(top_preds) - 1):
            assert top_preds[i]["probability"] >= top_preds[i + 1]["probability"]

    def test_reflectance_scale_auto_detection(self, loaded_classifier):
        # Test input in [0.0, 1.0] reflectance scale (e.g. max value ~0.4)
        reflectance_scene = np.random.uniform(0.01, 0.45, size=(10, 120, 120)).astype(np.float32)
        result = loaded_classifier.predict([reflectance_scene])
        assert len(result["class_probabilities"]) == 19
        for prob in result["class_probabilities"].values():
            assert 0.0 <= prob <= 1.0

    def test_arbitrary_spatial_dimension_resizing(self, loaded_classifier):
        # Test input with spatial size other than 120x120 (e.g. 64x64 or 256x256)
        arbitrary_scene = np.full((10, 64, 64), 500.0, dtype=np.float32)
        result = loaded_classifier.predict([arbitrary_scene])
        assert result["input_shape"] == [1, 10, 120, 120]
        assert len(result["class_probabilities"]) == 19


class TestScientificIntegrityAndErrorHandling:
    """Verifies that failures fail clearly and never silently substitute random weights."""

    def test_predict_without_loading_raises_error(self):
        unloaded_clf = BigEarthNetResNet50Classifier()
        with pytest.raises(RuntimeError) as exc_info:
            unloaded_clf.predict([np.zeros((10, 120, 120), dtype=np.float32)])
        assert "not loaded" in str(exc_info.value)
        assert "Call load() first" in str(exc_info.value)

    def test_invalid_band_count_raises_error(self):
        clf = BigEarthNetResNet50Classifier()
        # Pass 3-band RGB image
        invalid_image = np.zeros((3, 120, 120), dtype=np.float32)
        with pytest.raises(ValueError) as exc_info:
            clf.preprocess(invalid_image)
        assert "requires exactly 10 Sentinel-2 bands" in str(exc_info.value)

    def test_missing_local_checkpoint_raises_error(self):
        nonexistent_path = "C:/nonexistent/path/weights.safetensors"
        clf = BigEarthNetResNet50Classifier(checkpoint_path=nonexistent_path)
        with pytest.raises((RuntimeError, FileNotFoundError)) as exc_info:
            clf.load()
        assert clf.is_loaded is False
        assert clf.status == "model_loading_error"
        assert "SatQuery AI" in str(exc_info.value)
        assert "random weights" in str(exc_info.value)

    def test_download_failure_raises_clear_error(self):
        clf = BigEarthNetResNet50Classifier(model_id="BIFOLD-BigEarthNetv2-0/nonexistent-model-id")
        with patch("huggingface_hub.hf_hub_download", side_effect=Exception("Connection refused (mocked offline)")):
            with pytest.raises(RuntimeError) as exc_info:
                clf.load()
            assert clf.is_loaded is False
            assert clf.status == "model_loading_error"
            assert "Failed to download or locate model weights" in str(exc_info.value)
            assert "never silently substitute random weights" in str(exc_info.value)

    def test_corrupt_state_dict_raises_error(self, tmp_path):
        corrupt_ckpt = tmp_path / "corrupt_weights.pt"
        torch.save({"unexpected_key": torch.randn(10, 10)}, str(corrupt_ckpt))

        clf = BigEarthNetResNet50Classifier(checkpoint_path=str(corrupt_ckpt))
        with pytest.raises(RuntimeError) as exc_info:
            clf.load()
        assert clf.is_loaded is False
        assert clf.status == "model_loading_error"
        assert "Weight alignment mismatch" in str(exc_info.value)


class TestModelRegistryAndDatasetAdapterIntegration:
    """Verifies that the classification model integrates cleanly into SatQuery AI subsystems."""

    def test_model_registry_contains_classification(self):
        model = model_registry.get_model("classification")
        assert isinstance(model, BigEarthNetResNet50Classifier)
        assert model.task_type == "land_cover_classification"
        assert model.model_name == "BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.2.0"

    def test_model_registry_contains_land_cover_classification(self):
        model = model_registry.get_model("land_cover_classification")
        assert isinstance(model, BigEarthNetResNet50Classifier)

    def test_detailed_registry_entry(self):
        detailed = model_registry.list_models_detailed()
        classification_entries = [e for e in detailed if e["task"] == "classification"]
        assert len(classification_entries) == 1
        entry = classification_entries[0]
        assert entry["name"] == "BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.2.0"
        assert entry["is_remote_sensing_adapted"] is True
        assert entry["license"] == "MIT"

    def test_bigearthnet_dataset_adapter_contracts(self):
        adapter = BigEarthNetAdapter()
        assert adapter.dataset_name == "BigEarthNet-MM"
        assert adapter.expected_manifest == "train_manifest.json"

        # Loading from nonexistent directory returns False without crashing
        loaded = adapter.load("C:/nonexistent/bigearthnet_data")
        assert loaded is False
        assert adapter.is_loaded is False

        # Summarize reflects unmounted state truthfully
        summary = adapter.summarize()
        assert summary["loaded"] is False
        assert summary["sample_count"] == 0

        # Iterating over unmounted dataset raises RuntimeError
        with pytest.raises(RuntimeError) as exc_info:
            list(adapter.iterate())
        assert "Cannot iterate over unmounted dataset" in str(exc_info.value)


class TestBigEarthNetOrchestrationIntegration:
    """Verifies end-to-end integration of BigEarthNet land cover classification into orchestrator."""

    def test_query_parser_identifies_land_cover_intent(self):
        from app.agent.orchestrator import QueryParser

        parsed = QueryParser.parse("Classify CORINE land cover for this Sentinel-2 raster", mode="classification")
        assert parsed["task"] == "land_cover_classification"
        assert parsed["is_classification"] is True

        parsed_nl = QueryParser.parse("Identify land-cover classes in Mumbai", mode=None)
        assert parsed_nl["task"] == "land_cover_classification"
        assert parsed_nl["is_classification"] is True

    def test_orchestrator_dispatches_land_cover_classification(self, monkeypatch):
        from app.agent.orchestrator import agent_orchestrator
        from app.agent.registry import model_registry

        # Register mock model or use real classifier if weights exist
        model = model_registry.get("classification")

        # Mock predict to return deterministic result for fast regression
        mock_pred = {
            "status": "success",
            "model_id": "BIFOLD-BigEarthNetv2-0/resnet50-s2-v0.2.0",
            "predicted_classes": ["Arable land", "Complex cultivation patterns"],
            "top_predictions": [
                {"label": "Arable land", "probability": 0.88},
                {"label": "Complex cultivation patterns", "probability": 0.72},
            ],
            "class_probabilities": {
                "Arable land": 0.88,
                "Complex cultivation patterns": 0.72,
            },
            "parameters": {"threshold": 0.5, "input_bands": 10}
        }
        monkeypatch.setattr(model, "predict", lambda *args, **kwargs: mock_pred)

        sample_raster = np.random.uniform(500, 3000, (120, 120, 10)).astype(np.float32)
        resp = agent_orchestrator.orchestrate(
            query="Classify land cover using BigEarthNet ResNet-50",
            images=[sample_raster],
            mode="classification"
        )

        assert resp["status"] == "success"
        assert "Arable land" in resp["answer"]
        assert "BigEarthNet ResNet-50" in resp["answer"]
        assert any(e["type"] == "classification" for e in resp["evidence"])
        clf_ev = next(e for e in resp["evidence"] if e["type"] == "classification")
        assert clf_ev["id"] == "ev_bigearthnet_classification"
        assert len(clf_ev["statistics"]["top_predictions"]) == 2

