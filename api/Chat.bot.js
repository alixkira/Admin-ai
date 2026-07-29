// api/Chat.bot.js
//
// هاد الملف هو قلب المحادثة: كيوصلو السؤال ديال المستخدم،
// كيقرا الهوية المخصصة ديالو (custom_prompt) من vip_users،
// كيدمجها مع البرومبت الأساسي، كيهضر مع Gemini،
// كيسجل السؤال والجواب فـ chat_messages، ويرجع الجواب فقط للفرونت.
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

// عدد الرسائل السابقة لي كنجيبوها باش نعطيو للـ AI سياق المحادثة
const HISTORY_LIMIT = 20;

// اسم موديل Gemini - تأكد من الاسم الصحيح والمتوفر فـ حساب Google AI Studio ديالك
const GEMINI_MODEL = 'gemini-2.0-flash';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { userPrompt, user_id } = req.body || {};

  if (!userPrompt || !user_id) {
    return res.status(400).json({ error: 'userPrompt و user_id مطلوبين' });
  }

  // ═══════════════════════════════════════════
  // 2. قراءة المفاتيح الحساسة - سيرفر-سايد فقط
  // ═══════════════════════════════════════════
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GEMINI_API_KEY) {
    return res.status(500).json({ error: 'إعدادات السيرفر ناقصة' });
  }

  // عميل Supabase بصلاحيات كاملة (service_role) - يتخدم غير هنا
  const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // ═══════════════════════════════════════════
    // 3. جلب الشخصية المخصصة ديال هاد المستخدم
    // ═══════════════════════════════════════════
    const { data: vipRow } = await sbAdmin
      .from('vip_users')
      .select('custom_prompt')
      .eq('id', user_id)
      .single();

    const customPrompt = vipRow?.custom_prompt?.trim();

    // دمج البرومبت الأساسي مع الشخصية المخصصة (إلى كانت موجودة)
    const systemInstruction = customPrompt
      ? `${BASE_SYSTEM_PROMPT}\n\n[تعليمات إضافية خاصة بهاد المستخدم]\n${customPrompt}`
      : BASE_SYSTEM_PROMPT;

    // ═══════════════════════════════════════════
    // 4. جلب آخر الرسائل باش نعطيو سياق للمحادثة
    // ═══════════════════════════════════════════
    const { data: history } = await sbAdmin
      .from('chat_messages')
      .select('sender, message')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);

    const orderedHistory = (history || []).reverse();

    // تحويل السياق لصيغة Gemini (contents array)
    const contents = orderedHistory.map((row) => ({
      role: row.sender === 'ai' ? 'model' : 'user',
      parts: [{ text: row.message }]
    }));

    // زيادة الرسالة الجديدة ديال المستخدم فآخر السياق
    contents.push({
      role: 'user',
      parts: [{ text: userPrompt }]
    });

    // ═══════════════════════════════════════════
    // 5. صيفط الطلب لـ Gemini API
    // ═══════════════════════════════════════════
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          contents
        })
      }
    );

    const geminiData = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error('❌ خطأ من Gemini:', geminiData);
      return res.status(502).json({ error: 'تعذر الحصول على جواب من الذكاء الاصطناعي' });
    }

    const aiText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      'ماقدرتش نجاوب دبا، عاود جرب.';

    // ═══════════════════════════════════════════
    // 6. تسجيل السؤال والجواب فـ chat_messages
    // ═══════════════════════════════════════════
    await sbAdmin.from('chat_messages').insert([
      { user_id, sender: 'user', message: userPrompt },
      { user_id, sender: 'ai', message: aiText }
    ]);

    // ═══════════════════════════════════════════
    // 7. الجواب النهائي للفرونت - النص فقط
    // ═══════════════════════════════════════════
    return res.status(200).json({ text: aiText });

  } catch (err) {
    console.error('❌ خطأ فـ Chat.bot:', err);
    return res.status(500).json({ error: 'وقع خطأ غير متوقع فـ السيرفر' });
  }
}

