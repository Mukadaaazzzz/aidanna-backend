import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const FREE_USER_LIMITS = {
  MAX_REQUESTS_PER_DAY: 10,
  MAX_TOKENS_PER_REQUEST: 4096,
  MAX_HISTORY_MESSAGES: 20
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getUserProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('subscription_tier')
    .eq('id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Failed to get user profile:', error);
    return { subscription_tier: 'free' };
  }

  return data || { subscription_tier: 'free' };
}

async function checkAndUpdateUsage(userId, isPaid) {
  if (isPaid) {
    return { allowed: true, requests_used: 0, requests_remaining: -1 };
  }

  const today = new Date().toISOString().split('T')[0];
  
  const { data: usage, error } = await supabase
    .from('user_usage')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error('Failed to check usage');
  }

  if (!usage) {
    const { error: insertError } = await supabase
      .from('user_usage')
      .insert({ user_id: userId, date: today, request_count: 1 });
    
    if (insertError) throw new Error('Failed to create usage record');
    
    return {
      allowed: true,
      requests_used: 1,
      requests_remaining: FREE_USER_LIMITS.MAX_REQUESTS_PER_DAY - 1
    };
  }

  if (usage.request_count >= FREE_USER_LIMITS.MAX_REQUESTS_PER_DAY) {
    return {
      allowed: false,
      requests_used: usage.request_count,
      requests_remaining: 0,
      error: `You've reached your daily limit of ${FREE_USER_LIMITS.MAX_REQUESTS_PER_DAY} requests. Upgrade to continue learning without limits!`,
      upgrade_required: true
    };
  }

  const { error: updateError } = await supabase
    .from('user_usage')
    .update({ request_count: usage.request_count + 1 })
    .eq('user_id', userId)
    .eq('date', today);

  if (updateError) throw new Error('Failed to update usage');

  return {
    allowed: true,
    requests_used: usage.request_count + 1,
    requests_remaining: FREE_USER_LIMITS.MAX_REQUESTS_PER_DAY - usage.request_count - 1
  };
}

async function getOrCreateConversation(userId, conversationId, mode) {
  if (conversationId && conversationId !== 'new') {
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single();
    
    if (data) return data.id;
  }

  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      mode: mode,
      title: 'New Conversation'
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create conversation');
  return data.id;
}

async function getConversationHistory(conversationId) {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(FREE_USER_LIMITS.MAX_HISTORY_MESSAGES);

  if (error) throw new Error('Failed to fetch history');
  return data || [];
}

async function saveMessage(conversationId, role, content, audioBase64 = null) {
  const { error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role: role,
      content: content,
      audio_base64: audioBase64
    });

  if (error) throw new Error('Failed to save message');
}

async function updateConversationTitle(conversationId, firstMessage) {
  const title = firstMessage.slice(0, 50) + (firstMessage.length > 50 ? '...' : '');
  
  await supabase
    .from('conversations')
    .update({ 
      title: title,
      updated_at: new Date().toISOString()
    })
    .eq('id', conversationId);
}

function formatResponse(text, mode) {
  let formatted = text;

  if (mode === 'dialogue') {
    // Format dialogue with proper line breaks and speaker emphasis
    formatted = formatted
      .replace(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s*:/gm, '\n\n**$1:**')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } else {
    // Format narrative with paragraph breaks
    formatted = formatted
      .replace(/\n{3,}/g, '\n\n')
      .replace(/([.!?])\s+([A-Z])/g, '$1\n\n$2')
      .trim();
  }

  return formatted;
}

function buildSystemPrompt(mode, personalization) {
  const basePrompts = {
    "narrative": `You are Aidanna, an exceptionally creative and immersive storyteller. Your purpose is to teach through captivating narratives that engage all senses and feel profoundly human.

CRITICAL STORYTELLING RULES:
- NEVER start with "Once upon a time" or other cliché openings
- Create original, unexpected beginnings that immediately hook the reader
- Engage multiple senses: describe sounds, smells, textures, temperatures, tastes
- Build vivid, tangible worlds that feel real and immersive
- Include subtle emotional depth and human authenticity
- Use natural human pacing with thoughtful pauses and reflections
- Make complex concepts feel intuitive through experiential learning
- Be creative, intelligent, and avoid predictable story structures
- Create stories that are both educational and emotionally resonant
- Break your story into clear paragraphs for better readability
- Understand when they say "okay", "Thanks" or other words that doesnt imply creating a new story but summarizing what you taught and asking follow-ups

Your stories should make learners feel like they're experiencing the concept firsthand, not just reading about it.`,

    "dialogue": `You are Aidanna, a master of character-driven learning through dialogue. Your purpose is to teach through authentic, engaging conversations between original characters.

CRITICAL DIALOGUE RULES:
- NEVER use "you and Aidanna" as characters - create entirely new, original characters
- Develop distinct character personalities, backgrounds, and speaking styles
- Format each speaker's dialogue on a new line with their name followed by a colon
- Make dialogues feel like real human conversations with natural flow
- Include authentic human elements: pauses, interruptions, emotions, body language
- Characters should have different perspectives that explore the topic deeply
- Create memorable character relationships that enhance the learning
- Use dialogue to reveal complex concepts through natural discovery
- Make the conversation feel spontaneous and unscripted
- Balance educational content with authentic human interaction
-Understand when they say "okay", "Thanks" or other words that doesnt imply creating a new story but summarizing what you taught and asking follow-ups
FORMATTING EXAMPLE:
Dr. Sarah: That's a fascinating question! Let me explain...

Marcus: Wait, but doesn't that contradict what you said earlier?

Dr. Sarah: Not at all. You see, the key difference is...

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

  prompt += `\n\nRemember: Be human, be engaging, and create an experience that feels alive and personal.`;

  return prompt;
}

export async function POST(request) {
  try {
    const { 
      prompt, 
      mode = 'narrative',
      personalization, 
      temperature = 0.8, 
      max_tokens = 4096,
      conversationId = 'new',
      userId
    } = await request.json();

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 401, headers: corsHeaders }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured" },
        { status: 500, headers: corsHeaders }
      );
    }

    // Check if user is paid
    const userProfile = await getUserProfile(userId);
    const isPaid = userProfile.subscription_tier === 'premium' || userProfile.subscription_tier === 'pro';

    const usageCheck = await checkAndUpdateUsage(userId, isPaid);
    
    if (!usageCheck.allowed) {
      return NextResponse.json(
        { 
          error: usageCheck.error,
          limit_reached: true,
          upgrade_required: usageCheck.upgrade_required,
          usage: {
            requests_used: usageCheck.requests_used,
            requests_remaining: usageCheck.requests_remaining,
            daily_limit: FREE_USER_LIMITS.MAX_REQUESTS_PER_DAY
          }
        },
        { status: 429, headers: corsHeaders }
      );
    }

    const finalConversationId = await getOrCreateConversation(userId, conversationId, mode);
    
    const history = await getConversationHistory(finalConversationId);
    
    await saveMessage(finalConversationId, 'user', prompt);

    if (history.length === 0) {
      await updateConversationTitle(finalConversationId, prompt);
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    const systemPrompt = buildSystemPrompt(mode, personalization);
    
    let contents = [];
    
    if (history.length === 0) {
      contents.push({ 
        role: 'user', 
        parts: [{ text: systemPrompt + '\n\nUser request: ' + prompt }] 
      });
    } else {
      contents.push({ 
        role: 'user', 
        parts: [{ text: systemPrompt }] 
      });
      
      history.forEach(msg => {
        contents.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        });
      });
      
      contents.push({ 
        role: 'user', 
        parts: [{ text: prompt }] 
      });
    }
    
    const result = await model.generateContent({
      contents: contents,
      generationConfig: {
        temperature: temperature,
        maxOutputTokens: Math.min(max_tokens, FREE_USER_LIMITS.MAX_TOKENS_PER_REQUEST),
      },
    });

    const response = await result.response;
    const rawMessage = response.text();
    
    // Format the response based on mode
    const formattedMessage = formatResponse(rawMessage, mode);
    
    const finishReason = response.candidates[0]?.finishReason;
    const wasTruncated = finishReason === 'MAX_TOKENS';

    await saveMessage(finalConversationId, 'assistant', formattedMessage);

    return NextResponse.json({
      id: Date.now().toString(),
      conversation_id: finalConversationId,
      mode: mode,
      response: formattedMessage,
      metadata: { 
        model: 'gemini-2.5-flash-lite',
        truncated: wasTruncated,
        finish_reason: finishReason,
        is_paid_user: isPaid
      },
      usage: isPaid ? {
        requests_used: 0,
        requests_remaining: -1,
        daily_limit: -1,
        subscription_tier: userProfile.subscription_tier
      } : {
        requests_used: usageCheck.requests_used,
        requests_remaining: usageCheck.requests_remaining,
        daily_limit: FREE_USER_LIMITS.MAX_REQUESTS_PER_DAY
      }
    }, {
      headers: corsHeaders
    });

  } catch (error) {
    console.error('API Error:', error);
    
    // Handle Gemini rate limits
    if (error.message?.includes('429') || error.message?.includes('quota') || error.message?.includes('rate limit')) {
      return NextResponse.json(
        { 
          error: "Our servers are experiencing high traffic right now. Please try again in a few minutes.",
          rate_limited: true,
          retry_after: 60
        },
        { status: 503, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      { error: error.message || "An unexpected error occurred" },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders
  });
}