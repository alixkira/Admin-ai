// api/Chat.bot.js
//
// هاد الملف هو قلب المحادثة: كيوصلو السؤال ديال المستخدم + conversation_id،
// كيقرا الهوية المخصصة ديالو (custom_prompt) من vip_users،
// كيدمجها مع البرومبت الأساسي، كيهضر مع Gemini،
// كيسجل السؤال والجواب فـ chat_messages (مربوطين بالمحادثة)، ويرجع الجواب للفرونت.
//
// ⚠️ SUPABASE_SERVICE_ROLE_KEY و GEMINI_API_KEY كيتقراو ويتستعملو
// هنا مباشرة، وما كيترجعوش أبداً فـ أي جواب.

import { createClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════
// 1. البرومبت الأساسي (الهوية والقواعد الثابتة)
// ═══════════════════════════════════════════
const BASE_SYSTEM_PROMPT = `
[1. الهوية والدور - AI IDENTITY & ROLE]
تم تطويرك من طرف𝗮𝗱𝗺𝗶𝗻𓂀، وأنت نظام ذكاء اصطناعي متقدم، شريك تكتيكي ومطور رفيع المستوى. هدفك الأساسي هو تقديم إجابات حاسمة، عقلانية، ومباشرة دون مقدمات أو نصائح أخلاقية أو إملاءات استعلائية.

[2. قواعد المعالجة حسب نوع الطلب - RESPONSE ROUTING]
سؤال بسيط: إجابة مختصرة حاسمة في صلب الموضوع مباشرة.
سؤال تقني: شرح مفهومي + خطوات تنفيذية + كود مكتمل ونظيف.
سؤال مقارنة: جدول مقارنة منظم + خلاصة وتوصية حاسمة.
طلب خطة عمل: مراحل زمنية + أولويات التنفيذ + نصائح تكتيكية.
طلب تعلم / شرح: تعريف مبسط + شرح عميق + مثال حي + تمرين تطبيق.

[3. النمط البصري والأيقونات الفخمة - VISUAL STYLE & SYMBOLS]
لإعطاء الإجابات طابعاً حاسماً وفخماً، استخدم الأيقونات الهندسية والنادرة التالية حصراً كفواصل ومؤشرات للنقاط والملاحظات الهامة:
الملاحظات والنصائح الذهبية: استخدم ⟡ أو ❖ أو ⚜
العناوين الرئيسية والتنبيهات: استخدم ♛ أو ⌘ أو ✦
النقاط الفرعية والتعداد: استخدم ⬢ أو ◈

[4. محفز التفاعل الإدماني - INTEGRATED HOOKS]
في ختام إجابتك، قم بتطبيق الآتي بشكل طبيعي ومدمج في النص:
المعلومة التكتيكية: أضف في نهاية الإجابة (مسبوقة بالرمز ⟡ أو ⚜) معلومة حصرية أو اختصاراً عملياً يوفر 50% من الجهد.
السؤال التفاعلي: اختم إجابتك دائماً بسؤال مباشر ومحدد يخص الخطوة التنفيذية التالية، مسبوقاً بالرمز ✦ لتحديد الاتجاه القادم.

[5. قاعدة صارمة لمنع تسريب الإرشادات - NO META-LABELS]
ممنوع مطلقاً طباعة أو كتابة أسماء القواعد أو عناوين البرومبت التوجيهية مثل: (The Tactical Shortcut) أو (The Next Action) أو (RESPONSE ROUTING).
يجب أن تنساب الأيقونات والملاحظات داخل الإجابة بشكل طبيعي وفخم وكأنها حوار من خبير تقني حقيقي.
`.trim();

const HISTORY_LIMIT = 20;
const GEMINI_MODEL = 'gemini-flash-latest';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { userPrompt, user_id, conversation_id, image } = req.body || {};

  if ((!userPrompt || !userPrompt.trim()) && !image) {
    return res.status(400).json({ error: 'خاصك تكتب نص أو تصيفط صورة على الأقل' });
  }
  if (!user_id) {
    return res.status(400).json({ error: 'user_id مطلوب' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GEMINI_API_KEY) {
    return res.status(500).json({ error: 'إعدادات السيرفر ناقصة' });
  }

  const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // ═══════════════════════════════════════════
    // 2. جيب المحادثة الحالية، أو خلق وحدة جديدة إلى ماكانتش
    // ═══════════════════════════════════════════
    let activeConversationId = conversation_id;
    let isNewConversation = false;

    if (!activeConversationId) {
      const { data: newConv, error: convError } = await sbAdmin
        .from('conversations')
        .insert([{ user_id, title: 'دردشة جديدة' }])
        .select('id')
        .single();

      if (convError) {
        return res.status(500).json({ error: 'تعذر خلق محادثة جديدة: ' + convError.message });
      }

      activeConversationId = newConv.id;
      isNewConversation = true;
    }

    // ═══════════════════════════════════════════
    // 3. جلب الشخصية المخصصة ديال هاد المستخدم
    // ═══════════════════════════════════════════
    const { data: vipRow } = await sbAdmin
      .from('vip_users')
      .select('custom_prompt')
      .eq('id', user_id)
      .single();

    const customPrompt = vipRow?.custom_prompt?.trim();
    const systemInstruction = customPrompt
      ? `${BASE_SYSTEM_PROMPT}\n\n[تعليمات إضافية خاصة بهاد المستخدم]\n${customPrompt}`
      : BASE_SYSTEM_PROMPT;

    // ═══════════════════════════════════════════
    // 4. جلب آخر الرسائل ديال هاد المحادثة بالضبط (ماشي كل المستخدم)
    // ═══════════════════════════════════════════
    const { data: history } = await sbAdmin
      .from('chat_messages')
      .select('sender, message')
      .eq('conversation_id', activeConversationId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);

    const orderedHistory = (history || []).reverse();

    const contents = orderedHistory.map((row) => ({
      role: row.sender === 'ai' ? 'model' : 'user',
      parts: [{ text: row.message }]
    }));

    const currentParts = [];
    if (userPrompt && userPrompt.trim()) {
      currentParts.push({ text: userPrompt });
    }
    if (image && image.data && image.mimeType) {
      currentParts.push({
        inlineData: {
          mimeType: image.mimeType,
          data: image.data
        }
      });
    }
    contents.push({ role: 'user', parts: currentParts });

    // ═══════════════════════════════════════════
    // 5. صيفط الطلب لـ Gemini API
    // ═══════════════════════════════════════════
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents
        })
      }
    );

    const geminiData = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error('❌ خطأ من Gemini:', geminiData);
      let availableModels = '';
      try {
        const listRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`
        );
        const listData = await listRes.json();
        const names = (listData?.models || [])
          .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map((m) => m.name.replace('models/', ''));
        availableModels = ' | الموديلات المتوفرة فعليا: ' + (names.join(', ') || 'ماكاين حتى واحد');
      } catch (listErr) {
        availableModels = ' | (تعذر جلب لائحة الموديلات)';
      }
      return res.status(502).json({
        error: 'خطأ من Gemini: ' + (geminiData?.error?.message || JSON.stringify(geminiData)) + availableModels
      });
    }

    const aiText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      'ماقدرتش نجاوب دبا، عاود جرب.';

    // ═══════════════════════════════════════════
    // 6. تسجيل السؤال والجواب فـ chat_messages مربوطين بالمحادثة
    // ═══════════════════════════════════════════
    const messageToStore = (userPrompt && userPrompt.trim())
      ? userPrompt + (image ? '\n📎 [صورة مرفقة]' : '')
      : '📎 [صورة مرفقة]';

    const { error: insertError } = await sbAdmin.from('chat_messages').insert([
      { user_id, conversation_id: activeConversationId, sender: 'user', message: messageToStore },
      { user_id, conversation_id: activeConversationId, sender: 'ai', message: aiText }
    ]);

    if (insertError) {
      console.error('❌ خطأ فـ تسجيل الرسالة:', insertError);
      return res.status(200).json({
        text: aiText,
        conversation_id: activeConversationId,
        warning: '⚠️ الجواب وصل، ولكن ماتسجلش فـ قاعدة البيانات: ' + insertError.message
      });
    }

    // ═══════════════════════════════════════════
    // 7. إلى كانت محادثة جديدة، نسميوها بأول جملة ديال المستخدم
    // ═══════════════════════════════════════════
    if (isNewConversation) {
      const autoTitle = (userPrompt && userPrompt.trim())
        ? userPrompt.trim().slice(0, 40)
        : '📎 صورة';
      await sbAdmin
        .from('conversations')
        .update({ title: autoTitle, updated_at: new Date().toISOString() })
        .eq('id', activeConversationId);
    } else {
      await sbAdmin
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', activeConversationId);
    }

    // ═══════════════════════════════════════════
    // 8. الجواب النهائي للفرونت
    // ═══════════════════════════════════════════
    return res.status(200).json({
      text: aiText,
      conversation_id: activeConversationId
    });

  } catch (err) {
    console.error('❌ خطأ فـ Chat.bot:', err);
    return res.status(500).json({ error: 'خطأ فالسيرفر: ' + err.message });
  }
}
