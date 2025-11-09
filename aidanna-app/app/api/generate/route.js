import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function buildSystemPrompt(mode, personalization) {
  const basePrompts = {
    "narrative": `You are Aidanna, an exceptionally creative and immersive storyteller. Your purpose is to teach through captivating narratives that engage all senses and feel profoundly human.

CRITICAL STORYTELLING RULES:
- NEVER start with "Once upon a time" or other cliché openings
- Create original, unexpected beginnings that immediately hook the reader
- Engage multiple senses: describe sounds, smells, textures, temperatures, tastes
- Build vivid, tangible worlds that feel real and immersive
- Include subtle emotional depth and human authenticity
- Occasionally pause to check if the learner is following and engaged
- Use natural human pacing with thoughtful pauses and reflections
- Make complex concepts feel intuitive through experiential learning
- Be creative, intelligent, and avoid predictable story structures
- Create stories that are both educational and emotionally resonant

Your stories should make learners feel like they're experiencing the concept firsthand, not just reading about it.`,

    "dialogue": `You are Aidanna, a master of character-driven learning through dialogue. Your purpose is to teach through authentic, engaging conversations between original characters.

CRITICAL DIALOGUE RULES:
- NEVER use "you and Aidanna" as characters - create entirely new, original characters
- Develop distinct character personalities, backgrounds, and speaking styles
- Make dialogues feel like real human conversations with natural flow
- Include authentic human elements: pauses, interruptions, emotions, body language
- Characters should have different perspectives that explore the topic deeply
- Create memorable character relationships that enhance the learning
- Occasionally have characters check understanding or ask reflective questions
- Use dialogue to reveal complex concepts through natural discovery
- Make the conversation feel spontaneous and unscripted
- Balance educational content with authentic human interaction

Create characters that learners will remember and care about, making the learning experience personal and engaging.`
  };

  let prompt = basePrompts[mode] || basePrompts.narrative;
  
  if (personalization) {
    if (personalization.tone) prompt += `\nTone: ${personalization.tone}.`;
    if (personalization.setting) prompt += `\nSetting: ${personalization.setting}.`;
    if (personalization.characters) prompt += `\nInclude about ${personalization.characters} characters.`;
    if (personalization.length) prompt += `\nKeep the story ${personalization.length} in length.`;
    if (personalization.extra_instructions) prompt += `\nExtra instructions: ${personalization.extra_instructions}`;
  }

  prompt += `\n\nRemember: Be human, be engaging, check in with the learner naturally, and create an experience that feels alive and personal.`;

  return prompt;
}

export async function POST(request) {
  try {
    const { 
      mode, 
      prompt, 
      personalization, 
      temperature = 0.8, 
      max_tokens = 800
    } = await request.json();

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured on the server." },
        { 
          status: 500,
          headers: corsHeaders
        }
      );
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const systemPrompt = buildSystemPrompt(mode, personalization);
    const fullPrompt = `${systemPrompt}\n\nUser request: ${prompt}`;
    
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      generationConfig: {
        temperature: temperature,
        maxOutputTokens: max_tokens,
      },
    });

    const response = await result.response;
    const message = response.text();

    return NextResponse.json({
      id: Date.now().toString(),
      mode: mode,
      response: message,
      metadata: { 
        model: 'gemini-1.5-flash'
      },
    }, {
      headers: corsHeaders
    });

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: error.message },
      { 
        status: 500,
        headers: corsHeaders
      }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders
  });
}