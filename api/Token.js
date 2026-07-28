// api/Token.js
//
// القاعدة: التوكنات الأربعة كيتقراو هنا (process.env)،
// ولكن غير SUPABASE_URL و SUPABASE_ANON_KEY هوما لي كيترجعو
// فـ الجواب (res.json) اللي كيوصل للمتصفح.
//
// ⚠️ SUPABASE_SERVICE_ROLE_KEY و GEMINI_API_KEY كيتقراو هنا
// غير للتوثيق/التنظيم، ولكن ماكيترجعوش فأي جواب.
// الاستعمال الحقيقي ديالهم غادي يكون مباشرة جوة api/Chat.bot.js.

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1. القراءة - الأربعة هنا آمنين لحد الآن (غير متغيرات جوة السيرفر)
  const config = {
    projectUrl: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY, // ماكيرجعش
    geminiApiKey: process.env.GEMINI_API_KEY               // ماكيرجعش
  };

  // تأكد أن الجوج العموميين كاينين قبل ما نكملو
  if (!config.projectUrl || !config.anonKey) {
    return res.status(500).json({
      error: 'المفاتيح العمومية ناقصة فـ Environment Variables ديال Vercel'
    });
  }

  res.setHeader('Cache-Control', 'private, max-age=300');

  // 2. الإرجاع - غير الجوج العموميين كيخرجو للمتصفح
  return res.status(200).json({
    SUPABASE_URL: config.projectUrl,
    SUPABASE_ANON_KEY: config.anonKey
    // serviceRoleKey و geminiApiKey ماكاينينش هنا عمداً
  });
}

