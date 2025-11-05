# main.py
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, conint
from typing import Optional
from dotenv import load_dotenv
import os
import time

# OpenAI is optional at boot so the app never crashes
try:
    from openai import OpenAI
except Exception:  # if openai isn't installed yet during build
    OpenAI = None  # type: ignore

load_dotenv()

OPENAI_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_KEY) if (OpenAI and OPENAI_KEY) else None

app = FastAPI(title="Aidanna AI - Story Learning API")

# --- CORS (handles preflight automatically) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://animated-space-barnacle-q774r76jq4wv34v7p-3000.app.github.dev",
        "https://aidanna.com",
    ],
    allow_origin_regex=r"^https://.*\.app\.github\.dev$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=3600,
)

# --- Models & config ---
MODE_DEFINITIONS = {
    "narrative": {"label": "Narrative", "description": "Teaches concepts through immersive stories."},
    "dialogue": {"label": "Dialogue", "description": "Explains via character conversations."},
    "case-study": {"label": "Case Study", "description": "Realistic scenario with outcomes and lessons."},
    "interactive": {"label": "Interactive", "description": "Choice-based learning with consequences."},
}

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

def build_system_prompt(mode: str, p: Optional[Personalization]) -> str:
    base = {
        "narrative": "You are Aidanna, a warm teacher who explains topics via short, captivating stories.",
        "dialogue": "You are Aidanna, an engaging teacher who uses dialogues to explore ideas.",
        "case-study": "You are Aidanna, an analytical teacher who presents lessons via case studies.",
        "interactive": "You are Aidanna, an interactive tutor letting learners make choices and see consequences.",
    }.get(mode, "You are Aidanna, a warm teacher who explains topics via short, captivating stories.")
    parts = [base]
    if p:
        if p.tone: parts.append(f"Tone: {p.tone}.")
        if p.setting: parts.append(f"Setting: {p.setting}.")
        if p.characters: parts.append(f"Include about {p.characters} characters.")
        if p.length: parts.append(f"Keep the story {p.length} in length.")
        if p.extra_instructions: parts.append(f"Extra instructions: {p.extra_instructions}")
    return " ".join(parts)

# --- Routes ---
@app.get("/health")
def health(request: Request):
    return {
        "status": "ok",
        "origin": request.headers.get("origin"),
        "has_openai_key": bool(OPENAI_KEY),
        "env_port": os.getenv("PORT"),
    }

@app.get("/")
def root():
    return {"message": "Aidanna API is running 🚀", "endpoints": ["/health", "/modes", "/generate"]}

@app.get("/modes")
def get_modes():
    return MODE_DEFINITIONS

@app.post("/generate")
async def generate(req: GenerateRequest):
    if not client:
        # Respond with JSON—never crash the process
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured on the server.")
    try:
        system_prompt = build_system_prompt(req.mode, req.personalization)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": req.prompt},
        ]
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )
        msg = completion.choices[0].message.content
        return {
            "id": getattr(completion, "id", str(time.time())),
            "mode": req.mode,
            "response": msg,
            "metadata": {"usage": getattr(completion, "usage", {})},
        }
    except Exception as e:
        # Always JSON back so the browser sees the message
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)