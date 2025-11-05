import { NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const MODE_DEFINITIONS = {
  "narrative": { "label": "Narrative", "description": "Teaches concepts through immersive stories." },
  "dialogue": { "label": "Dialogue", "description": "Explains via character conversations." },
  "case-study": { "label": "Case Study", "description": "Realistic scenario with outcomes and lessons." },
  "interactive": { "label": "Interactive", "description": "Choice-based learning with consequences." },
};

export async function GET() {
  return NextResponse.json(MODE_DEFINITIONS, {
    headers: corsHeaders
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders
  });
}