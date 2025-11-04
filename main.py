# main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from openai import OpenAI
from dotenv import load_dotenv
import os
from typing import Optional, Dict, Any

load_dotenv()

OPENAI_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_KEY:
    raise RuntimeError("OPENAI_API_KEY is missing")

client = OpenAI(api_key=OPENAI_KEY)

app = FastAPI(title="Aidanna AI - Story Learning API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODE_DEFINITIONS = {
    "narrative": {
        "label": "Narrative",
        "description": "Single storyline with characters and scenes",
    },
    "dialogue": {
        "label": "Dialogue",
        "description": "A conversational play between characters",
    },
    "case-study": {
        "label": "Case Study",
        "description": "Real-world scenario breakdown",
    },
    "interactive": {
        "label": "Interactive",
        "description": "Choose-your-own-adventure style",
    }
}

class GenerateRequest(BaseModel):
    prompt: str = Field(default="Teach me something interesting")
    mode: str = Field(default="narrative")
    temperature: Optional[float] = Field(default=0.8)
    max_tokens: Optional[int] = Field(default=800)

def build_system_prompt(mode: str) -> str:
    prompts = {
        "narrative": "You are Aidanna, a warm learning companion who creates captivating narrative stories to teach concepts.",
        "dialogue": "You are Aidanna, a creative learning companion who teaches through dialogue between characters.",
        "case-study": "You are Aidanna, an insightful learning companion. Produce real-world case studies with analysis and takeaways.",
        "interactive": "You are Aidanna, an interactive learning companion. Present scenarios with clear choices and consequences."
    }
    return prompts.get(mode, prompts["narrative"])

@app.get("/")
async def root():
    return {"message": "Aidanna API is running", "status": "healthy"}

@app.get("/modes")
async def get_modes():
    return MODE_DEFINITIONS

@app.post("/generate")
async def generate(req: GenerateRequest):
    mode = req.mode
    if mode not in MODE_DEFINITIONS:
        raise HTTPException(status_code=400, detail="Unsupported mode")

    try:
        system_prompt = build_system_prompt(mode)
        
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": req.prompt}
            ],
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        )

        content = completion.choices[0].message.content
        
        return {
            "id": completion.id,
            "mode": mode,
            "content": content,
            "metadata": {}
        }
    except Exception as e:
        print(f"Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"OpenAI error: {str(e)}")