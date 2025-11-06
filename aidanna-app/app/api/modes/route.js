import { NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const MODE_DEFINITIONS = {
  "narrative": { 
    "label": "Narrative", 
    "description": "Learn through immersive, multi-sensory stories that engage your imagination and make concepts come alive." 
  },
  "dialogue": { 
    "label": "Dialogue", 
    "description": "Discover ideas through authentic conversations between original characters with unique personalities and perspectives." 
  },
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