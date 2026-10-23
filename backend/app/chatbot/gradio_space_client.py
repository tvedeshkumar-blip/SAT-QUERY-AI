"""
Hugging Face Gradio Space Client for SatQuery AI.
Connects the FastAPI backend to the public Qwen2.5-VL-3B Space on Hugging Face ZeroGPU.
Provides thread-safe reusable client caching, lightweight health probing, and robust error handling.
"""

import os
import time
import logging
import threading
from typing import Optional, Dict, Any, Tuple
import httpx

logger = logging.getLogger("satquery.gradio_client")

# Custom exceptions for clear error classification
class GradioSpaceError(Exception):
    """Base exception for Hugging Face Space interactions."""
    def __init__(self, message: str, retryable: bool = False, stage: Optional[str] = None):
        super().__init__(message)
        self.retryable = retryable
        self.stage = stage

class GradioSpaceConnectionError(GradioSpaceError):
    """Raised when the Space cannot be reached over the network."""
    def __init__(self, message: str = "Unable to connect to the Hugging Face Space.", stage: Optional[str] = None):
        super().__init__(message, retryable=True, stage=stage)

class GradioSpaceTimeoutError(GradioSpaceError):
    """Raised when the ZeroGPU queue or generation exceeds the timeout budget."""
    def __init__(self, message: str = "Hugging Face ZeroGPU queue or inference timed out.", stage: Optional[str] = None):
        super().__init__(message, retryable=True, stage=stage)

class GradioSpaceUnavailableError(GradioSpaceError):
    """Raised when the Space is sleeping, building, or paused."""
    def __init__(self, message: str, stage: Optional[str] = None):
        super().__init__(message, retryable=True, stage=stage)


class GradioSpaceClient:
    """
    Client for interacting with the public Hugging Face Space running Qwen2.5-VL-3B.
    Space: Astro406/satquery-qwen-vl
    Gradio API endpoint: /predict
    """

    def __init__(
        self,
        space_id: Optional[str] = None,
        api_name: Optional[str] = None,
        token: Optional[str] = None,
        timeout: Optional[float] = None
    ):
        self.space_id = space_id or os.getenv("HF_SPACE_ID", "Astro406/satquery-qwen-vl").strip()
        self.api_name = api_name or os.getenv("HF_API_NAME", "/predict").strip()
        if not self.api_name.startswith("/"):
            self.api_name = f"/{self.api_name}"
            
        self.token = token or os.getenv("HF_TOKEN") or None
        self.timeout = timeout or float(os.getenv("HF_REQUEST_TIMEOUT", "65.0"))
        
        self.model_name = "Qwen/Qwen2.5-VL-3B-Instruct"
        self.provider_name = "Hugging Face Space (ZeroGPU)"

        self._client = None
        self._lock = threading.Lock()
        self._last_health_cache: Optional[Tuple[float, Dict[str, Any]]] = None
        self._health_cache_ttl = 15.0  # seconds

    def _get_or_create_client(self):
        """
        Thread-safe singleton accessor for gradio_client.Client.
        Reuses the existing client instance across requests to avoid repetitive schema fetching.
        """
        if self._client is not None:
            return self._client

        with self._lock:
            if self._client is not None:
                return self._client

            logger.info("Initializing gradio_client.Client for Space '%s'...", self.space_id)
            try:
                from gradio_client import Client
                # Instantiate Gradio client with optional token for public Space
                client = Client(
                    self.space_id,
                    hf_token=self.token,
                    verbose=False
                )
                self._client = client
                logger.info("gradio_client.Client successfully connected to Space '%s'.", self.space_id)
                return self._client
            except Exception as e:
                logger.error("Failed to initialize Gradio client for '%s': %s", self.space_id, e)
                raise GradioSpaceConnectionError(
                    f"Could not initialize connection to Hugging Face Space '{self.space_id}'."
                ) from e

    def invalidate_client(self):
        """Discards the cached Gradio client instance so a fresh connection is created on next turn."""
        with self._lock:
            self._client = None
            logger.info("Gradio client instance invalidated.")

    def probe_space_status(self) -> Dict[str, Any]:
        """
        Lightweight health check against Hugging Face Space metadata API.
        Does NOT trigger GPU prediction or consume ZeroGPU quota.
        Results are cached for a short TTL (15s) to prevent spamming Hugging Face APIs.
        """
        now = time.time()
        if self._last_health_cache is not None:
            cached_time, cached_result = self._last_health_cache
            if now - cached_time < self._health_cache_ttl:
                return cached_result

        api_url = f"https://huggingface.co/api/spaces/{self.space_id}"
        
        try:
            with httpx.Client(timeout=5.0) as http_client:
                headers = {}
                if self.token:
                    headers["Authorization"] = f"Bearer {self.token}"
                resp = http_client.get(api_url, headers=headers)
                
            if resp.status_code == 200:
                data = resp.json()
                runtime = data.get("runtime", {})
                stage = runtime.get("stage", "UNKNOWN").upper()
                
                # Stages: RUNNING, SLEEPING, PAUSED, BUILDING, APP_STARTING, STOPPED, etc.
                is_running = stage == "RUNNING"
                status = "online" if is_running else ("standby" if stage in ("SLEEPING", "BUILDING", "APP_STARTING") else "offline")
                
                result = {
                    "status": status,
                    "available": is_running,
                    "stage": stage,
                    "space_id": self.space_id,
                    "provider": self.provider_name,
                    "model": self.model_name,
                    "api_name": self.api_name,
                }
            else:
                result = {
                    "status": "offline",
                    "available": False,
                    "stage": f"HTTP_{resp.status_code}",
                    "space_id": self.space_id,
                    "provider": self.provider_name,
                    "model": self.model_name,
                    "api_name": self.api_name,
                }
        except Exception as exc:
            logger.warning("Space probe error for %s: %s", self.space_id, exc)
            result = {
                "status": "offline",
                "available": False,
                "stage": "UNREACHABLE",
                "space_id": self.space_id,
                "provider": self.provider_name,
                "model": self.model_name,
                "api_name": self.api_name,
            }

        self._last_health_cache = (now, result)
        return result

    def predict(self, question: str) -> str:
        """
        Executes inference by calling the Gradio /predict endpoint on the Hugging Face Space.
        
        Args:
            question: Clean text prompt / question for Qwen2.5-VL.
            
        Returns:
            The model generated text answer.
            
        Raises:
            GradioSpaceUnavailableError: If the Space is sleeping or building.
            GradioSpaceTimeoutError: If the request times out waiting for GPU or generation.
            GradioSpaceConnectionError: If network connection fails.
            GradioSpaceError: For other unexpected failures.
        """
        cleaned_question = (question or "").strip()
        if not cleaned_question:
            raise GradioSpaceError("Question must not be empty.", retryable=False)

        # Enforce reasonable input character limit (e.g. 4000 chars)
        if len(cleaned_question) > 4000:
            cleaned_question = cleaned_question[:4000]

        start_time = time.time()
        logger.info("Dispatching prediction to Space '%s' (question length: %d chars)...", self.space_id, len(cleaned_question))

        try:
            client = self._get_or_create_client()
            
            # Note: client.predict uses the Gradio websockets/SSE protocol under the hood
            raw_response = client.predict(
                cleaned_question,
                api_name=self.api_name
            )
            
            elapsed = time.time() - start_time
            logger.info("Prediction received in %.2fs from '%s'.", elapsed, self.space_id)

            if raw_response is None:
                raise GradioSpaceError("Hugging Face Space returned an empty response.", retryable=True)

            return str(raw_response).strip()

        except GradioSpaceError:
            # Re-raise already-classified custom errors
            raise

        except TimeoutError as te:
            logger.error("Timeout during Gradio prediction on '%s': %s", self.space_id, te)
            self.invalidate_client()
            raise GradioSpaceTimeoutError(
                "Prediction timed out. The model Space may be queued or allocating GPU resources on ZeroGPU."
            ) from te

        except ConnectionError as ce:
            logger.error("Connection error during Gradio prediction on '%s': %s", self.space_id, ce)
            self.invalidate_client()
            raise GradioSpaceConnectionError(
                "Connection to the Hugging Face Space failed. Check internet access or Space status."
            ) from ce

        except Exception as e:
            err_msg = str(e)
            logger.error("Gradio prediction failed on '%s': %s", self.space_id, err_msg)
            
            # Check for common Gradio / HF Space error strings
            lower_err = err_msg.lower()
            if "queue" in lower_err or "timeout" in lower_err or "timed out" in lower_err:
                self.invalidate_client()
                raise GradioSpaceTimeoutError(
                    "ZeroGPU queue or inference timed out. Please retry in a few moments."
                ) from e
            elif "sleep" in lower_err or "sleeping" in lower_err or "waking" in lower_err:
                self.invalidate_client()
                raise GradioSpaceUnavailableError(
                    "The model Space was sleeping and is currently waking up. Please retry in 30-60 seconds.",
                    stage="SLEEPING"
                ) from e
            elif "connection" in lower_err or "failed to connect" in lower_err or "disconnected" in lower_err:
                self.invalidate_client()
                raise GradioSpaceConnectionError(
                    "Connection to Hugging Face Space was lost during inference."
                ) from e
            else:
                self.invalidate_client()
                raise GradioSpaceError(
                    "An error occurred while generating a response from the satellite intelligence model.",
                    retryable=True
                ) from e
