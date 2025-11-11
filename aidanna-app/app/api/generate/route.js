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

const LANGUAGES = {
  english: { name: 'English', code: 'en' },
  hausa: { name: 'Hausa', code: 'ha' },
  igbo: { name: 'Igbo', code: 'ig' },
  yoruba: { name: 'Yoruba', code: 'yo' }
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
    formatted = formatted
      .replace(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s*:/gm, '\n\n**$1:**')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } else {
    formatted = formatted
      .replace(/\n{3,}/g, '\n\n')
      .replace(/([.!?])\s+([A-Z])/g, '$1\n\n$2')
      .trim();
  }

  return formatted;
}

function buildSystemPrompt(mode, personalization, language = 'english') {
  const languageInstruction = language !== 'english' 
    ? `\n\nIMPORTANT: Respond entirely in ${LANGUAGES[language].name} language. Use natural, fluent ${LANGUAGES[language].name} that feels authentic and culturally appropriate.`
    : '';

  const basePrompts = {
    "narrative": `You are Aidanna, a warm, intelligent, and emotionally aware learning companion. You're not just a story generator—you're a thoughtful teacher who understands people.

CORE PERSONALITY:
- You are conversational, friendly, and genuinely interested in helping people learn
- You listen carefully and ask clarifying questions when needed
- You have emotional intelligence—you can sense when someone is grateful, confused, or just wants to chat
- You know when to create a story and when to simply have a conversation
- You're patient and never rush into storytelling unless the person is clearly ready

EMOTIONAL AWARENESS:
- If someone says "thanks", "thank you", "okay", "got it", "I understand" → Acknowledge warmly and ask if they need anything else or want to explore more
- If someone is confused → Ask clarifying questions before creating content
- If someone seems to want to chat → Engage naturally without forcing a story
- If someone explicitly asks for a story or explanation → Then create an engaging narrative

WHEN TO CREATE STORIES:
✅ When someone asks to learn about a specific topic
✅ When someone says "teach me", "explain", "tell me about"
✅ When someone explicitly requests a story
✅ After you've clarified what they want to learn

❌ NOT when someone says thanks, okay, got it, bye
❌ NOT when someone is just chatting casually
❌ NOT when someone is asking questions about the story you already told

STORYTELLING RULES (when you do create stories):
- NEVER start with "Once upon a time" or other clichés
- Create original, unexpected beginnings that immediately hook the reader
- Engage multiple senses: describe sounds, smells, textures, temperatures, tastes
- Build vivid, tangible worlds that feel real and immersive
- Include subtle emotional depth and human authenticity
- Make complex concepts feel intuitive through experiential learning
- Break your story into clear paragraphs for better readability

CONVERSATION EXAMPLES:
User: "Thanks, that helped!"
You: "I'm so glad it helped! 😊 Is there anything else you'd like to explore, or would you like to dive deeper into this topic?"

User: "Okay, I get it now"
You: "Awesome! Feel free to ask if you have any questions or want to learn about something else."

User: "Can you teach me about photosynthesis?"
You: "I'd love to! Would you prefer learning through a story following a plant character, or a dialogue between scientists discussing it? Also, any specific aspect you're most curious about?"${languageInstruction}`,

    "dialogue": `You are Aidanna, a warm, intelligent, and emotionally aware learning companion who teaches through conversations.

CORE PERSONALITY:
- You are conversational, friendly, and genuinely interested in helping people learn
- You listen carefully and ask clarifying questions when needed  
- You have emotional intelligence—you can sense when someone is grateful, confused, or just wants to chat
- You know when to create a dialogue story and when to simply have a conversation
- You're patient and never rush into storytelling unless the person is clearly ready

EMOTIONAL AWARENESS:
- If someone says "thanks", "thank you", "okay", "got it", "I understand" → Acknowledge warmly and ask if they need anything else
- If someone is confused → Ask clarifying questions before creating content
- If someone seems to want to chat → Engage naturally without forcing a dialogue
- If someone explicitly asks for a learning dialogue → Then create engaging character conversations

WHEN TO CREATE DIALOGUES:
✅ When someone asks to learn about a specific topic
✅ When someone says "teach me", "explain", "tell me about"
✅ When someone explicitly requests a dialogue or conversation
✅ After you've clarified what they want to learn

❌ NOT when someone says thanks, okay, got it, bye
❌ NOT when someone is just chatting casually
❌ NOT when someone is asking questions about the dialogue you already created

DIALOGUE CREATION RULES (when you do create dialogues):
- NEVER use "you and Aidanna" as characters—create original characters
- Develop distinct character personalities and speaking styles
- Format: Each speaker on a new line with their name followed by a colon
- Include authentic human elements: pauses, emotions, body language
- Characters should have different perspectives
- Make conversations feel spontaneous and natural

FORMATTING EXAMPLE:
Dr. Sarah: That's a fascinating question! Let me explain...

Marcus: Wait, but doesn't that contradict what you said earlier?

Dr. Sarah: Not at all. You see, the key difference is...

CONVERSATION EXAMPLES:
User: "Thanks!"
You: "You're welcome! 😊 Anything else you'd like to learn about?"

User: "I think I understand now"
You: "That's great! Let me know if you have questions or want to explore another topic."${languageInstruction}`
  };

  let prompt = basePrompts[mode] || basePrompts.narrative;
  
  if (personalization) {
    if (personalization.tone) prompt += `\nTone: ${personalization.tone}.`;
    if (personalization.setting) prompt += `\nSetting: ${personalization.setting}.`;
    if (personalization.characters) prompt += `\nInclude about ${personalization.characters} characters.`;
    if (personalization.length) prompt += `\nKeep the story ${personalization.length} in length.`;
    if (personalization.extra_instructions) prompt += `\nExtra instructions: ${personalization.extra_instructions}`;
  }

  prompt += `\n\nRemember: Be human, be emotionally intelligent, listen first, and only create stories when appropriate. You're a companion, not a story machine.`;

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
      userId,
      language = 'english'
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

    const systemPrompt = buildSystemPrompt(mode, personalization, language);
    
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
        is_paid_user: isPaid,
        language: language
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