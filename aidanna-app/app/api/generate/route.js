import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildSystemPrompt(mode, personalization) {
  const base = {
    "narrative": "You are Aidanna, a warm teacher who explains topics via short, captivating stories.",
    "dialogue": "You are Aidanna, an engaging teacher who uses dialogues to explore ideas.",
    "case-study": "You are Aidanna, an analytical teacher who presents lessons via case studies.",
    "interactive": "You are Aidanna, an interactive tutor letting learners make choices and see consequences.",
  }[mode] || "You are Aidanna, a warm teacher who explains topics via short, captivating stories.";
  
  const parts = [base];
  if (personalization) {
    if (personalization.tone) parts.push(`Tone: ${personalization.tone}.`);
    if (personalization.setting) parts.push(`Setting: ${personalization.setting}.`);
    if (personalization.characters) parts.push(`Include about ${personalization.characters} characters.`);
    if (personalization.length) parts.push(`Keep the story ${personalization.length} in length.`);
    if (personalization.extra_instructions) parts.push(`Extra instructions: ${personalization.extra_instructions}`);
  }
  return parts.join(' ');
}

export async function POST(request) {
  try {
    const { mode, prompt, personalization, temperature = 0.8, max_tokens = 800 } = await request.json();

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured on the server." },
        { 
          status: 500,
          headers: corsHeaders
        }
      );
    }

    const systemPrompt = buildSystemPrompt(mode, personalization);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: temperature,
      max_tokens: max_tokens,
    });

    const message = completion.choices[0].message.content;
    
    return NextResponse.json({
      id: completion.id || Date.now().toString(),
      mode: mode,
      response: message,
      metadata: { usage: completion.usage || {} },
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