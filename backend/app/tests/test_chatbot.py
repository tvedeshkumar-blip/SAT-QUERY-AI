"""
Comprehensive test suite for SatQuery AI Hugging Face Space Gradio Client integration.
Tests verify:
- Root & System Health endpoints
- Chat Health lightweight probe (online, standby, offline)
- Chat Request payload validation & character limits
- Successful model response from Hugging Face Space (mocked Gradio client)
- Upstream connection failures, ZeroGPU timeouts, and Space unavailable states
- Strict response schema compliance
- CORS configuration for production Vercel frontend, previews, and localhost
- Route registration integrity across all existing routers
- Grounding context & evidence injection preservation
"""

import json
from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.chatbot.schemas import ChatMessage, ChatRequest, ChatResponse
from app.chatbot.gradio_space_client import (
    GradioSpaceClient,
    GradioSpaceError,
    GradioSpaceConnectionError,
    GradioSpaceTimeoutError,
    GradioSpaceUnavailableError
)
from app.chatbot.satquery_chatbot import SatQueryChatbot, satquery_chatbot
from app.chatbot.prompts import SATQUERY_SYSTEM_PROMPT, format_evidence_context

client = TestClient(app)


def test_1_root_endpoint():
    """Verify GET / returns online status and correct API documentation metadata."""
    resp = client.get("/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "online"
    assert "SatQuery AI" in data["title"]
    assert data["docs"] == "/docs"


def test_2_system_health_endpoint():
    """Verify GET /health returns healthy status without invoking heavy model GPU inference."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert "SatQuery AI Backend" in data["service"]


def test_3_scientific_integrity_system_prompt():
    """Verify that the SatQuery system prompt strictly enforces all required integrity rules."""
    prompt = SATQUERY_SYSTEM_PROMPT
    assert "SatQuery AI, a satellite imagery analysis assistant" in prompt
    assert "Never invent satellite observations" in prompt
    assert "Never fabricate measurements" in prompt
    assert "Never claim a model ran when it did not" in prompt
    assert "Distinguish model observations from interpretation" in prompt
    assert "Preserve model provenance" in prompt
    assert "Treat neural confidence scores as uncalibrated" in prompt
    assert "If evidence is unavailable, say so" in prompt
    assert "Do not pretend to have access to imagery that was not supplied" in prompt
    assert "Do not fabricate coordinates, CRS, sensor information, dates, or detected objects" in prompt
    assert "BIT-CD" in prompt
    assert "OWL-ViT" in prompt
    assert "SAR" in prompt


def test_4_chat_health_lightweight_probe_online():
    """Verify /api/v1/chat/health reports online when Space runtime stage is RUNNING."""
    mock_probe = {
        "status": "online",
        "available": True,
        "stage": "RUNNING",
        "space_id": "Astro406/satquery-qwen-vl",
        "provider": "Hugging Face Space (ZeroGPU)",
        "model": "Qwen/Qwen2.5-VL-3B-Instruct",
        "api_name": "/predict",
    }
    with patch.object(satquery_chatbot.client, "probe_space_status", return_value=mock_probe):
        resp = client.get("/api/v1/chat/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "online"
        assert data["available"] is True
        assert data["stage"] == "RUNNING"
        assert data["space_id"] == "Astro406/satquery-qwen-vl"
        assert "Qwen" in data["configured_model"]


def test_5_chat_health_lightweight_probe_standby():
    """Verify /api/v1/chat/health reports standby when Space runtime stage is SLEEPING."""
    mock_probe = {
        "status": "standby",
        "available": False,
        "stage": "SLEEPING",
        "space_id": "Astro406/satquery-qwen-vl",
        "provider": "Hugging Face Space (ZeroGPU)",
        "model": "Qwen/Qwen2.5-VL-3B-Instruct",
        "api_name": "/predict",
    }
    with patch.object(satquery_chatbot.client, "probe_space_status", return_value=mock_probe):
        resp = client.get("/api/v1/chat/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "standby"
        assert data["available"] is False
        assert data["stage"] == "SLEEPING"


def test_6_successful_model_response():
    """Verify successful end-to-end chat completion when Hugging Face Space returns an answer."""
    hf_client = GradioSpaceClient(space_id="Astro406/satquery-qwen-vl")
    bot = SatQueryChatbot(client=hf_client)

    sample_answer = "Cartosat-2S provides high-resolution panchromatic and multispectral imagery at 0.65m GSD."

    with patch.object(hf_client, "predict", return_value=sample_answer):
        res = bot.chat(
            message="Explain the spatial resolution of Cartosat-2S.",
            conversation_id="conv-201"
        )

        assert isinstance(res, ChatResponse)
        assert res.status == "success"
        assert res.provider == "Hugging Face Space (ZeroGPU)"
        assert res.model == "Qwen/Qwen2.5-VL-3B-Instruct"
        assert "Cartosat-2S provides" in res.response
        assert res.conversation_id == "conv-201"
        assert res.error is None


def test_7_empty_message_validation():
    """Verify that an empty message produces a clear validation error without calling the model."""
    hf_client = GradioSpaceClient()
    bot = SatQueryChatbot(client=hf_client)

    with patch.object(hf_client, "predict") as mock_predict:
        res = bot.chat(message="   ")
        assert res.status == "error"
        assert "valid satellite or remote sensing question" in res.response
        assert res.error == "Empty message payload."
        mock_predict.assert_not_called()


def test_8_upstream_connection_failure():
    """Verify graceful handling when Hugging Face Space is unreachable."""
    hf_client = GradioSpaceClient()
    bot = SatQueryChatbot(client=hf_client)

    with patch.object(hf_client, "predict", side_effect=GradioSpaceConnectionError("Connection timed out.")):
        res = bot.chat(message="What is Cartosat?")
        assert res.status == "unavailable"
        assert "Unable to reach the Hugging Face model Space" in res.response
        assert res.error is not None
        assert "Analysis reveals" not in res.response


def test_9_upstream_timeout_and_queue_delay():
    """Verify handling when ZeroGPU inference exceeds the timeout budget."""
    hf_client = GradioSpaceClient()
    bot = SatQueryChatbot(client=hf_client)

    with patch.object(hf_client, "predict", side_effect=GradioSpaceTimeoutError("GPU queue timeout.")):
        res = bot.chat(message="Analyze optical and SAR backscatter.")
        assert res.status == "unavailable"
        assert "timed out waiting for GPU resources" in res.response
        assert res.error is not None


def test_10_space_sleeping_state():
    """Verify friendly retry guidance when Space was sleeping and is waking up."""
    hf_client = GradioSpaceClient()
    bot = SatQueryChatbot(client=hf_client)

    with patch.object(hf_client, "predict", side_effect=GradioSpaceUnavailableError("Space sleeping", stage="SLEEPING")):
        res = bot.chat(message="Identify ships.")
        assert res.status == "unavailable"
        assert "waking up or queued on ZeroGPU" in res.response
        assert "Retry" in res.response


def test_11_chat_endpoint_schema_via_fastapi():
    """Verify POST /api/v1/chat adheres to the ChatResponse schema expected by the frontend."""
    with patch.object(satquery_chatbot.client, "predict", return_value="Mangrove canopy detected."):
        chat_req = {
            "message": "Describe coastal vegetation.",
            "conversation_id": "test-fastapi-conv",
            "history": [
                {"role": "user", "content": "What is the study area?"},
                {"role": "assistant", "content": "The study area is the Sundarbans delta."}
            ]
        }
        resp = client.post("/api/v1/chat", json=chat_req)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert data["provider"] == "Hugging Face Space (ZeroGPU)"
        assert data["model"] == "Qwen/Qwen2.5-VL-3B-Instruct"
        assert data["conversation_id"] == "test-fastapi-conv"
        assert data["response"] == "Mangrove canopy detected."
        assert data.get("error") is None


def test_12_oversized_message_rejected():
    """Verify that requests exceeding 8000 characters are rejected with HTTP 400."""
    huge_message = "A" * 8005
    resp = client.post("/api/v1/chat", json={"message": huge_message})
    assert resp.status_code == 400
    assert "exceeds the maximum allowed length" in resp.json()["detail"]


def test_13_cors_headers_production_and_previews():
    """Verify CORS headers for production Vercel frontend, preview domains, and rejection of disallowed origins."""
    # Production Vercel Origin
    prod_origin = "https://sat-query-gamma.vercel.app"
    resp = client.options(
        "/api/v1/chat",
        headers={
            "Origin": prod_origin,
            "Access-Control-Request-Method": "POST",
        }
    )
    assert resp.headers.get("access-control-allow-origin") == prod_origin
    assert resp.headers.get("access-control-allow-credentials") == "true"

    # Preview Vercel Subdomain Origin
    preview_origin = "https://sat-query-preview-pr12.vercel.app"
    resp_preview = client.options(
        "/api/v1/chat",
        headers={
            "Origin": preview_origin,
            "Access-Control-Request-Method": "POST",
        }
    )
    assert resp_preview.headers.get("access-control-allow-origin") == preview_origin

    # Disallowed third-party origin
    bad_origin = "https://malicious-satellite-site.com"
    resp_bad = client.options(
        "/api/v1/chat",
        headers={
            "Origin": bad_origin,
            "Access-Control-Request-Method": "POST",
        }
    )
    assert resp_bad.headers.get("access-control-allow-origin") is None


def test_14_existing_api_routers_preserved():
    """Verify that all existing routers remain registered under /api/v1."""
    registered_routes = list(app.openapi()["paths"].keys())

    # Verify Health
    assert "/api/v1/health" in registered_routes
    assert "/api/v1/models" in registered_routes

    # Verify Analysis
    assert "/api/v1/analyze" in registered_routes
    assert "/api/v1/analyze/spectral-indices" in registered_routes

    # Verify Evaluation
    assert "/api/v1/evaluation" in registered_routes

    # Verify Reports
    assert "/api/v1/reports/scientific" in registered_routes
    assert "/api/v1/reports/pdf" in registered_routes

    # Verify Chat
    assert "/api/v1/chat" in registered_routes
    assert "/api/v1/chat/health" in registered_routes

    # Verify Acquisition
    assert "/api/v1/acquisition/search" in registered_routes
    assert "/api/v1/acquisition/retrieve" in registered_routes


def test_15_evidence_and_workspace_grounding_preservation():
    """Verify that specialist evidence and workspace metadata are correctly synthesized into prompt."""
    evidence_data = {
        "model": "BIT-CD",
        "task": "change_detection",
        "changed_area_percent": 14.5,
        "change_detected": True
    }
    workspace_ctx = {
        "mode": "bitemporal",
        "scene_count": 2,
        "scenes": [
            {"role": "primary", "scene_id": "T1_SCENE_001"},
            {"role": "secondary", "scene_id": "T2_SCENE_002"}
        ]
    }

    hf_client = GradioSpaceClient()
    bot = SatQueryChatbot(client=hf_client)

    captured_prompt = []
    def mock_predict(prompt):
        captured_prompt.append(prompt)
        return "Analysis grounded in empirical telemetry."

    with patch.object(hf_client, "predict", side_effect=mock_predict):
        res = bot.chat(
            message="Explain the change percentage.",
            evidence=evidence_data,
            workspace_context=workspace_ctx
        )
        assert res.status == "success"
        assert len(captured_prompt) == 1
        sent_prompt = captured_prompt[0]

        assert "VERIFIED SATQUERY SPECIALIST EVIDENCE" in sent_prompt
        assert "BIT-CD" in sent_prompt
        assert "14.5" in sent_prompt
        assert "ACTIVE WORKSPACE SCENE METADATA" in sent_prompt
        assert "T1_SCENE_001" in sent_prompt
        assert "User Query: Explain the change percentage." in sent_prompt
