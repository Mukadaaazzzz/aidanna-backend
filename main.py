from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, conint
from openai import OpenAI
from dotenv import load_dotenv
import os
import time
from typing import Optional, Dict, Any, List

# --- Load environment ---
load_dotenv()

OPENAI_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_KEY:
    raise RuntimeError("❌ OPENAI_API_KEY missing in environment or .env file")

client = OpenAI(api_key=OPENAI_KEY)
app = FastAPI(title="Aidanna AI - Story Learning API")

origins = [
    "https://animated-space-barnacle-q774r76jq4wv34v7p-3000.app.github.dev",
    "http://localhost:3000",
    "https://aidanna.com", 
    "*"
     # if you deploy frontend later
]

@app.middleware("http")
async def add_cors_headers(request: Request, call_next):
    """Railway sometimes strips middleware headers; this ensures all responses include CORS."""
    response: Response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "*"
    return response

# --- Mode definitions ---
MODE_DEFINITIONS = {
    "narrative": {
        "label": "Narrative",
        "description": "Teaches concepts through immersive stories with characters and plot.",
    },
    "dialogue": {
        "label": "Dialogue",
        "description": "Explains through a conversation between characters.",
    },
    "case-study": {
        "label": "Case Study",
        "description": "Breaks down a real-world scenario with lessons learned.",
    },
    "interactive": {
        "label": "Interactive",
        "description": "Lets users choose paths with consequences and learning points.",
    },
}

# --- Pydantic models ---
class Personalization(BaseModel):
    tone: Optional[str] = None
    characters: Optional[conint(ge=1, le=10)] = None
    setting: Optional[str] = None
    length: Optional[str] = None
    extra_instructions: Optional[str] = None


class GenerateRequest(BaseModel):
    mode: str
    prompt: str
    personalization: Optional[Personalization] = None
    temperature: Optional[float] = Field(0.8, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(800, ge=64, le=2000)


# --- Helper functions ---
def build_system_prompt(mode: str, personalization: Optional[Personalization]) -> str:
    """Build system instruction depending on mode and personalization."""
    base_prompts = {
        "narrative": (
            "You are Aidanna, a warm and inspiring AI teacher who explains topics "
            "through captivating short stories with clear morals and insights."
        ),
        "dialogue": (
            "You are Aidanna, a curious and engaging teacher who uses dialogues "
            "between characters to explore ideas naturally."
        ),
        "case-study": (
            "You are Aidanna, an analytical yet relatable teacher who presents lessons "
            "through real or fictional case studies and outcomes."
        ),
        "interactive": (
            "You are Aidanna, an interactive AI tutor who lets learners make choices "
            "and explains the consequences for each decision."
        ),
    }

    base = base_prompts.get(mode, base_prompts["narrative"])
    parts = [base]

    if personalization:
        if personalization.tone:
            parts.append(f"Tone: {personalization.tone}.")
        if personalization.setting:
            parts.append(f"Setting: {personalization.setting}.")
        if personalization.characters:
            parts.append(f"Include about {personalization.characters} characters.")
        if personalization.length:
            parts.append(f"Keep the story {personalization.length} in length.")
        if personalization.extra_instructions:
            parts.append(f"Extra instructions: {personalization.extra_instructions}")

    return " ".join(parts)


# --- Routes ---
@app.get("/")
def root():
    return {"message": "Aidanna API is running 🚀", "endpoints": ["/modes", "/generate"]}


@app.get("/modes")
def get_modes():
    """Return supported learning modes."""
    return MODE_DEFINITIONS


@app.post("/generate")
async def generate(request: GenerateRequest):
    """Main endpoint: Generate educational story using selected mode."""
    try:
        system_prompt = build_system_prompt(request.mode, request.personalization)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": request.prompt},
        ]

        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
        )

        message = completion.choices[0].message.content

        return {
            "id": getattr(completion, "id", str(time.time())),
            "mode": request.mode,
            "response": message,
            "metadata": {
                "usage": getattr(completion, "usage", {}),
            },
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    import os

    port = int(os.environ.get("PORT", 8000))  # Railway sets PORT automatically
    uvicorn.run("main:app", host="0.0.0.0", port=port)
