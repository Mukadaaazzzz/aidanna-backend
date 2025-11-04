# main.py
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, HTMLResponse, StreamingResponse
from pydantic import BaseModel, Field, conint
from openai import OpenAI
from dotenv import load_dotenv
import os
import asyncio
import json
import time
from typing import List, Optional, Dict, Any

load_dotenv()

# --- Config & client ---
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_KEY:
    raise RuntimeError("OPENAI_API_KEY is missing. Set it in environment or .env")

client = OpenAI(api_key=OPENAI_KEY)
app = FastAPI(title="Aidanna AI - Story Learning API")

# --- Mode definitions (exposed by /modes) ---
MODE_DEFINITIONS = {
    "narrative": {
        "label": "Narrative",
        "description": "Single storyline with characters and scenes to teach concepts via story",
        "defaults": {"tone": "warm, encouraging", "length": "medium"}
    },
    "dialogue": {
        "label": "Dialogue",
        "description": "A conversational play between characters exploring a topic",
        "defaults": {"tone": "curious, probing", "characters": 2}
    },
    "case-study": {
        "label": "Case Study",
        "description": "Real-world scenario breakdown with root cause analysis and outcomes",
        "defaults": {"tone": "analytic", "depth": "detailed"}
    },
    "interactive": {
        "label": "Interactive",
        "description": "Choose-your-own-adventure style simulation where choices affect outcomes",
        "defaults": {"tone": "engaging", "choices": 3}
    }
}

# --- Pydantic models for validation ---
class Personalization(BaseModel):
    title: Optional[str] = None
    tone: Optional[str] = None
    characters: Optional[conint(ge=1, le=10)] = None
    setting: Optional[str] = None
    length: Optional[str] = Field(None, description="short | medium | long")
    choices: Optional[conint(ge=1, le=6)] = None
    extra_instructions: Optional[str] = None

class GenerateRequest(BaseModel):
    user_id: Optional[str] = None
    mode: str = Field(..., description="narrative | dialogue | case-study | interactive")
    prompt: Optional[str] = Field(None, description="Optional user's seed prompt or topic")
    personalization: Optional[Personalization] = None
    temperature: Optional[float] = Field(0.8, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(800, ge=64, le=2000)

class GenerateResponse(BaseModel):
    id: str
    mode: str
    content: str
    metadata: Dict[str, Any] = {}

# --- Helpers: build system prompt & payload ---
def build_system_prompt(mode: str, personalization: Optional[Personalization]) -> str:
    base = {
        "narrative": (
            "You are Aidanna, a warm and enthusiastic learning companion who transforms topics into "
            "captivating narrative stories. Create clear story arcs, relatable characters, and "
            "embed the learning goal so the reader learns while entertained."
        ),
        "dialogue": (
            "You are Aidanna, a creative learning companion who teaches through dialogue. Create natural, "
            "educational conversations between characters that progressively uncover the topic."
        ),
        "case-study": (
            "You are Aidanna, an insightful learning companion. Produce a real-world case study: context, "
            "problem statement, analysis, decisions, and outcomes with practical takeaways."
        ),
        "interactive": (
            "You are Aidanna, an interactive learning companion. Present a scenario with clear choices, "
            "and for each choice, describe consequences and learning points. Allow users to make decisions."
        )
    }.get(mode, "")

    # apply personalization
    parts = [base]
    if personalization:
        if personalization.tone:
            parts.append(f"Tone: {personalization.tone}.")
        if personalization.setting:
            parts.append(f"Setting: {personalization.setting}.")
        if personalization.characters:
            parts.append(f"Use approximately {personalization.characters} characters.")
        if personalization.length:
            parts.append(f"Target length: {personalization.length}.")
        if personalization.choices:
            parts.append(f"Interactive choices: {personalization.choices}.")
        if personalization.extra_instructions:
            parts.append(f"Extra: {personalization.extra_instructions}")
    parts.append("Be concise but clear. Use examples and explicit learning takeaways.")
    return " ".join(parts)

def build_user_message(prompt: Optional[str]) -> List[Dict[str, str]]:
    if not prompt or not prompt.strip():
        return [{"role":"user","content":"Please teach me something interesting in an engaging way."}]
    return [{"role":"user","content":prompt}]

# --- Endpoints ---

@app.get("/modes")
async def get_modes():
    """Return supported modes and defaults for the frontend to render controls."""
    return MODE_DEFINITIONS

@app.post("/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest):
    """Synchronous generation endpoint (blocking): returns finished content."""
    mode = req.mode
    if mode not in MODE_DEFINITIONS:
        raise HTTPException(status_code=400, detail="Unsupported mode")

    system_prompt = build_system_prompt(mode, req.personalization)
    user_messages = build_user_message(req.prompt)

    # Prepare messages array
    messages = [{"role": "system", "content": system_prompt}] + user_messages

    try:
        # Use the new OpenAI client API
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )

        # Extract assistant content
        assistant_content = completion.choices[0].message.content
        response_id = getattr(completion, "id", str(time.time()))

        return GenerateResponse(
            id=response_id,
            mode=mode,
            content=assistant_content,
            metadata={"usage": getattr(completion, "usage", {})}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/stream")
async def stream_generate(request: Request):
    """
    Streaming endpoint using Server-Sent Events (SSE).
    Expect JSON body identical to GenerateRequest.
    Frontend can listen to the SSE stream and append content as it arrives.
    """
    body = await request.json()
    # Basic validation
    mode = body.get("mode")
    if mode not in MODE_DEFINITIONS:
        raise HTTPException(status_code=400, detail="Unsupported mode")

    personalization = body.get("personalization")
    prompt = body.get("prompt")
    temperature = float(body.get("temperature", 0.8))
    max_tokens = int(body.get("max_tokens", 800))

    system_prompt = build_system_prompt(mode, Personalization(**(personalization or {})) if personalization else None)
    user_messages = build_user_message(prompt)
    messages = [{"role":"system","content":system_prompt}] + user_messages

    # Create stream with OpenAI client
    try:
        # `stream=True` returns an iterator of events for many SDKs; adapt to SDK behavior
        stream = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI error: {e}")

    async def event_generator():
        # The SDK stream may be synchronous; wrap in thread if needed. Here we handle both sync/async iterables.
        try:
            # If stream is an async iterator:
            if hasattr(stream, "__aiter__"):
                async for chunk in stream:
                    # chunk usually contains delta in chunk.choices[0].delta or content
                    # Normalize message piece:
                    piece = ""
                    # try multiple possible shapes:
                    try:
                        piece = chunk.choices[0].delta.get("content", "")
                    except Exception:
                        try:
                            piece = chunk.choices[0].message.content
                        except Exception:
                            piece = str(chunk)
                    if piece:
                        yield f"data: {json.dumps({'delta': piece})}\n\n"
            else:
                # synchronous iterator
                for chunk in stream:
                    piece = ""
                    try:
                        piece = chunk.choices[0].delta.get("content", "")
                    except Exception:
                        try:
                            piece = chunk.choices[0].message.content
                        except Exception:
                            piece = str(chunk)
                    if piece:
                        yield f"data: {json.dumps({'delta': piece})}\n\n"
                    # small pause to yield to client
                    await asyncio.sleep(0)
            # final event
            yield f"data: {json.dumps({'done': True})}\n\n"
        except GeneratorExit:
            return
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
