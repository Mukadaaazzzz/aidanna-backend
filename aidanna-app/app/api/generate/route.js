import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

/* ----------------------------- CORS & LIMITS ----------------------------- */
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

/* -------------------------------- SUPABASE ------------------------------- */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* --------------------------- PROFILE & USAGE ----------------------------- */
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

/* --------------------------- CONVERSATIONS I/O --------------------------- */
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

/* --------------------------- INTENT & FORMATTING ------------------------- */
function tokenize(s = '') {
  return s.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

function detectIntent(input, history = []) {
  const text = (input || '').trim();
  const t = text.toLowerCase();
  const tokens = tokenize(text);

  const GREET_RE = /^(hi|hey|hello|yo|sup|good\s*(morning|afternoon|evening))[\s!,.]*$/i;
  const ACK_RE   = /^(ok(ay)?|cool|nice|thanks|thank\s*you|got it|great|sounds good|sure|alright)[!.,\s]*$/i;
  const CONT_RE  = /^(continue|go on|carry on|more|keep (going|it)?)$/i;

  if (GREET_RE.test(text)) return { type: 'GREETING' };
  if (ACK_RE.test(text))   return { type: 'ACK' };
  if (CONT_RE.test(text))  return { type: 'CONTINUE' };

  // Very short & neutral → ask to clarify instead of launching a story
  if (tokens.length <= 3 && !/[?]/.test(text)) return { type: 'CLARIFY' };

  // Explicit story cues
  const STORY_CUES = /(tell|write|create|make)\s+(me\s+)?(a|an)?\s*(story|narrative|dialogue|scene)/i;
  if (STORY_CUES.test(t)) return { type: 'STORY_REQUEST' };

  // Questions / tutoring
  const QUESTION_CUES = /(\?|explain|how|why|what|teach|help\s+me)/i;
  if (QUESTION_CUES.test(t)) return { type: 'QUESTION' };

  // Default to tutoring/chat
  return { type: 'QUESTION' };
}

function formatResponse(text, mode) {
  let t = (text || '').trim();
  if (!t) return t;

  // Keep short chatty replies natural
  if (t.length <= 600) return t;

  if (mode === 'dialogue') {
    t = t
      .replace(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s*:/gm, '\n\n**$1:**')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } else {
    t = t
      .replace(/\n{3,}/g, '\n\n')
      .replace(/([.!?])\s+([A-Z])/g, '$1\n\n$2')
      .trim();
  }
  return t;
}

/* --------------------------- PROMPT ENGINEERING -------------------------- */
function buildSystemPrompt(mode, personalization) {
  const basePrompts = {
    narrative: `You are Aidanna, an exceptionally creative and immersive storyteller who teaches through narrative.

CONVERSATION RULES (OVERRIDE ALL):
- If the user greets (e.g., "hi", "hello"), reply briefly, ask what they want to learn, and offer 2–3 topic suggestions. Do NOT start a story.
- If the user acknowledges (e.g., "okay", "thanks"), respond briefly (one or two lines), optionally summarize the last key point in ≤2 bullets, and ask a follow-up question. Do NOT start a story.
- If the user asks a question, first answer clearly and concisely (≤5 sentences) before offering to turn it into a story. Ask whether they prefer "Narrative" or "Dialogue".
- Only produce a long story if the user asks for it or explicitly agrees.

STORYTELLING RULES (when a story is requested or confirmed):
- NEVER start with "Once upon a time".
- Hook with an original, vivid opening.
- Engage multiple senses; keep emotional authenticity and natural pacing.
- Teach by experience: concrete scenes that illuminate the concept.
- Break into clear paragraphs.
`,

    dialogue: `You are Aidanna, a master of character-driven learning through dialogue.

CONVERSATION RULES (OVERRIDE ALL):
- If greeted, reply briefly, ask learning goal, offer 2–3 options. Do NOT launch a dialogue scene.
- If acknowledged ("okay", "thanks"), reply briefly, optionally summarize last key point in ≤2 bullets, ask a follow-up.
- If the user asks a question, first answer clearly in ≤5 sentences, then offer to explore via dialogue.
- Only produce a long dialogue if the user asks or agrees.

DIALOGUE RULES (when a dialogue is requested or confirmed):
- Create original characters (NOT "you and Aidanna").
- Distinct voices; natural flow, interruptions, emotions, body language.
- Format: Name: line (each speaker on a new line).
- Balance teaching with authentic interaction.
`
  };

  let prompt = basePrompts[mode] || basePrompts.narrative;

  if (personalization) {
    if (personalization.tone) prompt += `\nTone: ${personalization.tone}.`;
    if (personalization.setting) prompt += `\nSetting: ${personalization.setting}.`;
    if (personalization.characters) prompt += `\nInclude about ${personalization.characters} characters.`;
    if (personalization.length) prompt += `\nTarget length: ${personalization.length}.`;
    if (personalization.extra_instructions) prompt += `\nExtra instructions: ${personalization.extra_instructions}`;
  }

  prompt += `

GENERAL STYLE:
- Be human, curious, and adaptive.
- Ask targeted clarifying questions when the request is vague.
- Never ignore short conversational inputs—acknowledge and probe before long outputs.
- Keep formatting clean and readable.`;

  return prompt;
}

/* --------------------------------- ROUTES -------------------------------- */
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
        { error: 'User ID is required' },
        { status: 401, headers: corsHeaders }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY not configured' },
        { status: 500, headers: corsHeaders }
      );
    }

    // Check subscription & usage
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

    // Conversation plumbing
    const finalConversationId = await getOrCreateConversation(userId, conversationId, mode);
    const history = await getConversationHistory(finalConversationId);
    await saveMessage(finalConversationId, 'user', prompt);
    if (history.length === 0) {
      await updateConversationTitle(finalConversationId, prompt);
    }

    // Build Gemini model with systemInstruction
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const systemPrompt = buildSystemPrompt(mode, personalization);

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      systemInstruction: systemPrompt
    });

    /* --------------------------- INTENT SHORT-CIRCUITS --------------------------- */
    const intent = detectIntent(prompt, history);

    // 1) Greeting → friendly question & options (no token burn)
    if (intent.type === 'GREETING') {
      const reply =
        `Hey! I’m Aidanna 👋\n\n` +
        `What would you like to learn today?\n` +
        `• Quick explanation\n` +
        `• Narrative story\n` +
        `• Dialogue between characters\n\n` +
        `Tell me the topic (e.g., “photosynthesis”, “supply & demand”, or “machine learning”).`;
      await saveMessage(finalConversationId, 'assistant', reply);

      return NextResponse.json({
        id: Date.now().toString(),
        conversation_id: finalConversationId,
        mode,
        response: reply,
        metadata: {
          model: 'router',
          truncated: false,
          finish_reason: 'STOP',
          is_paid_user: isPaid
        },
        usage: isPaid ? {
          requests_used: 0, requests_remaining: -1, daily_limit: -1, subscription_tier: userProfile.subscription_tier
        } : {
          requests_used: usageCheck.requests_used,
          requests_remaining: usageCheck.requests_remaining,
          daily_limit: FREE_USER_LIMITS.MAX_REQUESTS_PER_DAY
        }
      }, { headers: corsHeaders });
    }

    // 2) Acknowledgement → brief nudge / micro-summary prompt
    if (intent.type === 'ACK') {
      const reply =
        `Got it! 👍\n\n` +
        `• Want a super-short summary?\n` +
        `• Should I turn this into a Narrative or a Dialogue?\n` +
        `• Or do you want practice questions?`;
      await saveMessage(finalConversationId, 'assistant', reply);

      return NextResponse.json({
        id: Date.now().toString(),
        conversation_id: finalConversationId,
        mode,
        response: reply,
        metadata: {
          model: 'router',
          truncated: false,
          finish_reason: 'STOP',
          is_paid_user: isPaid
        },
        usage: isPaid ? {
          requests_used: 0, requests_remaining: -1, daily_limit: -1, subscription_tier: userProfile.subscription_tier
        } : {
          requests_used: usageCheck.requests_used,
          requests_remaining: usageCheck.requests_remaining,
          daily_limit: FREE_USER_LIMITS.MAX_REQUESTS_PER_DAY
        }
      }, { headers: corsHeaders });
    }

    // 3) Clarify → ask preference
    if (intent.type === 'CLARIFY') {
      const reply =
        `Happy to help! Do you want:\n` +
        `1) A concise explanation\n` +
        `2) A Narrative story\n` +
        `3) A Dialogue scene\n\n` +
        `What topic should we explore?`;
      await saveMessage(finalConversationId, 'assistant', reply);

      return NextResponse.json({
        id: Date.now().toString(),
        conversation_id: finalConversationId,
        mode,
        response: reply,
        metadata: {
          model: 'router',
          truncated: false,
          finish_reason: 'STOP',
          is_paid_user: isPaid
        },
        usage: isPaid ? {
          requests_used: 0, requests_remaining: -1, daily_limit: -1, subscription_tier: userProfile.subscription_tier
        } : {
          requests_used: usageCheck.requests_used,
          requests_remaining: usageCheck.requests_remaining,
          daily_limit: FREE_USER_LIMITS.MAX_REQUESTS_PER_DAY
        }
      }, { headers: corsHeaders });
    }

    // 4) Continue → ask model to continue from last assistant output
    let userPromptForModel = prompt;
    if (intent.type === 'CONTINUE') {
      const lastAssistant = [...history].reverse().find(m => m.role === 'assistant')?.content || '';
      userPromptForModel =
        `Please continue seamlessly from the previous response, keeping the same mode (${mode}) and style. ` +
        `Here is the last assistant output for context:\n\n${lastAssistant}`;
    }

    /* ------------------------------ LLM CALL ------------------------------ */
    // Rebuild contents: we no longer prepend systemPrompt here (it’s in systemInstruction)
    const contents = [];
    history.forEach(msg => {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      });
    });
    contents.push({ role: 'user', parts: [{ text: userPromptForModel }] });

    const result = await model.generateContent({
      contents,
      generationConfig: {
        temperature,
        maxOutputTokens: Math.min(max_tokens, FREE_USER_LIMITS.MAX_TOKENS_PER_REQUEST),
      },
    });

    const response = await result.response;
    const rawMessage = response.text();

    const formattedMessage = formatResponse(rawMessage, mode);
    const finishReason = response.candidates?.[0]?.finishReason;
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
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('API Error:', error);

    // Handle Gemini rate limits
    if (error?.message?.includes('429') || error?.message?.includes('quota') || error?.message?.includes('rate limit')) {
      return NextResponse.json(
        {
          error: 'Our servers are experiencing high traffic right now. Please try again in a few minutes.',
          rate_limited: true,
          retry_after: 60
        },
        { status: 503, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      { error: error?.message || 'An unexpected error occurred' },
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
