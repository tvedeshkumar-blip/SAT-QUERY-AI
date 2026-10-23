import logging
from fastapi import APIRouter, HTTPException
from app.chatbot.schemas import ChatRequest, ChatResponse
from app.chatbot.satquery_chatbot import satquery_chatbot

logger = logging.getLogger("satquery.api.chat")
router = APIRouter()

@router.post("/chat", response_model=ChatResponse)
def satquery_chat(request: ChatRequest):
    """
    Dedicated SatQuery AI Chatbot endpoint powered by Qwen2.5-VL-3B-Instruct
    hosted on the Hugging Face Spaces public microservice (ZeroGPU).
    Accepts user message, multi-turn history, and optional SatQuery specialist evidence.
    Gracefully handles cold starts, GPU queue delays, and Space states without fabricating responses.
    """
    if len(request.message) > 8000:
        raise HTTPException(
            status_code=400,
            detail="User query exceeds the maximum allowed length of 8000 characters."
        )

    return satquery_chatbot.chat(
        message=request.message,
        history=request.history,
        evidence=request.evidence,
        workspace_context=request.workspace_context,
        model=request.model,
        conversation_id=request.conversation_id,
        temperature=request.temperature,
        max_tokens=request.max_tokens
    )

@router.get("/chat/health")
def satquery_chat_health():
    """
    Lightweight status probe for the Hugging Face Space model inference backend.
    Checks runtime stage and reachability without triggering GPU inference.
    """
    return satquery_chatbot.get_health_status()
