"""
SatQuery AI Dedicated Chatbot Engine.
Orchestrates prompt assembly, conversation history, evidence injection,
and dispatch to the Hugging Face Gradio Space running Qwen2.5-VL-3B.
"""

import logging
from typing import Any, Dict, List, Optional, Union

from app.chatbot.schemas import ChatMessage, ChatResponse
from app.chatbot.gradio_space_client import (
    GradioSpaceClient,
    GradioSpaceError,
    GradioSpaceConnectionError,
    GradioSpaceTimeoutError,
    GradioSpaceUnavailableError
)
from app.chatbot.prompts import SATQUERY_SYSTEM_PROMPT, format_evidence_context

logger = logging.getLogger("satquery.chatbot")


class SatQueryChatbot:
    """
    Dedicated SatQuery AI Chatbot powered by Qwen2.5-VL-3B-Instruct hosted on Hugging Face Spaces.
    Replaces local-only LM Studio endpoints with a resilient public inference microservice.
    """

    def __init__(self, client: Optional[GradioSpaceClient] = None):
        self.client = client or GradioSpaceClient()

    def is_available(self) -> bool:
        """
        Lightweight check returning True if the Hugging Face Space is RUNNING.
        Does NOT trigger GPU prediction.
        """
        probe = self.client.probe_space_status()
        return bool(probe.get("available", False))

    def get_health_status(self) -> Dict[str, Any]:
        """
        Comprehensive health status for /api/v1/chat/health without triggering GPU execution.
        """
        probe = self.client.probe_space_status()
        return {
            "status": probe.get("status", "offline"),
            "available": probe.get("available", False),
            "provider": self.client.provider_name,
            "base_url": f"https://huggingface.co/spaces/{self.client.space_id}",
            "space_id": self.client.space_id,
            "configured_model": self.client.model_name,
            "stage": probe.get("stage", "UNKNOWN"),
        }

    def _assemble_prompt(
        self,
        message: str,
        history: Optional[List[Union[ChatMessage, Dict[str, str]]]] = None,
        evidence: Optional[Union[Dict[str, Any], List[Any]]] = None,
        workspace_context: Optional[Union[Dict[str, Any], List[Any]]] = None,
    ) -> str:
        """
        Synthesizes user query, conversation history, and satellite telemetry into a cohesive prompt.
        """
        prompt_parts: List[str] = []

        # 1. Format evidence or workspace context if attached
        evidence_str = format_evidence_context(evidence=evidence, workspace_context=workspace_context)
        has_active_evidence = (
            "[EVIDENCE STATUS: NO ACTIVE RASTER EVIDENCE SUPPLIED]" not in evidence_str
            or "[WORKSPACE STATUS: SCENES IMPORTED" in evidence_str
        )

        if has_active_evidence:
            prompt_parts.append(evidence_str.strip())

        # 2. Add multi-turn history (limit to last 6 turns to keep prompt token-efficient)
        if history:
            history_lines: List[str] = []
            recent_history = history[-6:]
            for item in recent_history:
                if isinstance(item, ChatMessage):
                    role_name = "User" if item.role == "user" else "Assistant"
                    history_lines.append(f"{role_name}: {item.content}")
                elif isinstance(item, dict) and "role" in item and "content" in item:
                    role_name = "User" if item["role"] == "user" else "Assistant"
                    history_lines.append(f"{role_name}: {item['content']}")

            if history_lines:
                prompt_parts.append("Prior conversation context:\n" + "\n".join(history_lines))

        # 3. Add active user question
        if prompt_parts:
            prompt_parts.append(f"User Query: {message}")
            return "\n\n".join(prompt_parts)

        # Standalone question without prior context or attached evidence
        return message

    def chat(
        self,
        message: str,
        history: Optional[List[Union[ChatMessage, Dict[str, str]]]] = None,
        evidence: Optional[Union[Dict[str, Any], List[Any]]] = None,
        workspace_context: Optional[Union[Dict[str, Any], List[Any]]] = None,
        model: Optional[str] = None,
        conversation_id: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None
    ) -> ChatResponse:
        """
        Executes a conversational turn with the Hugging Face Space model.
        
        Args:
            message: User query or follow-up question.
            history: Prior conversation turns.
            evidence: Optional structured SatQuery telemetry.
            workspace_context: Optional structured metadata summary of workspace scenes.
            model: Optional model override.
            conversation_id: Session identifier.
            temperature: Sampling temperature (for documentation / compatibility).
            max_tokens: Token generation limit (for documentation / compatibility).
            
        Returns:
            ChatResponse with natural-language text and execution provenance.
        """
        target_model = model or self.client.model_name
        provider_name = self.client.provider_name

        cleaned_message = (message or "").strip()
        if not cleaned_message:
            return ChatResponse(
                response="Please enter a valid satellite or remote sensing question.",
                model=target_model,
                provider=provider_name,
                status="error",
                conversation_id=conversation_id,
                error="Empty message payload."
            )

        # Assemble full input prompt
        synthesized_prompt = self._assemble_prompt(
            message=cleaned_message,
            history=history,
            evidence=evidence,
            workspace_context=workspace_context
        )

        try:
            answer = self.client.predict(synthesized_prompt)
            return ChatResponse(
                response=answer,
                model=target_model,
                provider=provider_name,
                status="success",
                conversation_id=conversation_id
            )

        except GradioSpaceUnavailableError as ue:
            logger.warning("Space unavailable error: %s", ue)
            return ChatResponse(
                response=(
                    "The SatQuery Qwen-2.5-VL model Space is currently waking up or queued on ZeroGPU. "
                    "Please wait a few moments and click 'Retry'."
                ),
                model=target_model,
                provider=provider_name,
                status="unavailable",
                conversation_id=conversation_id,
                error=str(ue)
            )

        except GradioSpaceTimeoutError as te:
            logger.warning("Space timeout: %s", te)
            return ChatResponse(
                response=(
                    "The model request timed out waiting for GPU resources. "
                    "ZeroGPU resources may be under high load. Please retry in a moment."
                ),
                model=target_model,
                provider=provider_name,
                status="unavailable",
                conversation_id=conversation_id,
                error=str(te)
            )

        except GradioSpaceConnectionError as ce:
            logger.error("Space connection error: %s", ce)
            return ChatResponse(
                response=(
                    f"Unable to reach the Hugging Face model Space ({self.client.space_id}). "
                    "Please verify network connectivity and ensure the Space is active."
                ),
                model=target_model,
                provider=provider_name,
                status="unavailable",
                conversation_id=conversation_id,
                error=str(ce)
            )

        except GradioSpaceError as ge:
            logger.error("Gradio general error: %s", ge)
            return ChatResponse(
                response=(
                    "The satellite intelligence assistant encountered an error while processing your query. "
                    "Please try again or rephrase your question."
                ),
                model=target_model,
                provider=provider_name,
                status="error",
                conversation_id=conversation_id,
                error=str(ge)
            )

        except Exception as e:
            logger.error("Unexpected error in SatQueryChatbot: %s", e)
            return ChatResponse(
                response=(
                    "An unexpected error occurred while communicating with the remote sensing model."
                ),
                model=target_model,
                provider=provider_name,
                status="error",
                conversation_id=conversation_id,
                error="Internal model dispatch error."
            )


# Global default chatbot instance
satquery_chatbot = SatQueryChatbot()
