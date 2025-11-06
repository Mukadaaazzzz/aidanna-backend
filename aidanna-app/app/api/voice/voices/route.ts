import { NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const VOICES = [
  { id: 'alloy', name: 'Alloy', description: 'Balanced and clear' },
  { id: 'echo', name: 'Echo', description: 'Warm and resonant' },
  { id: 'fable', name: 'Fable', description: 'Storytelling tone' },
  { id: 'onyx', name: 'Onyx', description: 'Deep and authoritative' },
  { id: 'nova', name: 'Nova', description: 'Bright and cheerful' },
  { id: 'shimmer', name: 'Shimmer', description: 'Soft and calming' },
];

export async function GET() {
  return NextResponse.json(
    { voices: VOICES },
    { headers: corsHeaders }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders
  });
}