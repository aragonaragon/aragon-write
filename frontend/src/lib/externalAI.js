import { isNativeIOS, NativeAI } from "./native";

const ACTION_PROMPTS = {
  rewrite: (text) => `أعد صياغة النص التالي بأسلوب أفضل مع الحفاظ على المعنى الأصلي. اكتب فقط النص المُعاد صياغته بدون أي مقدمة أو شرح:\n\n${text}`,
  improve: (text) => `حسّن النص التالي من حيث الأسلوب والوضوح والتدفق الأدبي. اكتب فقط النص المحسّن بدون أي مقدمة أو شرح:\n\n${text}`,
  shorter: (text) => `اختصر النص التالي مع الحفاظ على الأفكار الرئيسية. اكتب فقط النص المختصر بدون أي مقدمة أو شرح:\n\n${text}`,
  longer: (text) => `وسّع النص التالي بإضافة تفاصيل وصفية وأدبية أكثر ثراءً. اكتب فقط النص الموسّع بدون أي مقدمة أو شرح:\n\n${text}`,
  continue: (text) => `استكمل الكتابة الأدبية التالية بنفس الأسلوب والنبرة. اكتب فقط الجزء التالي بدون أي مقدمة:\n\n${text}`,
  translate_en: (text) => `ترجم النص التالي إلى الإنجليزية ترجمة أدبية جميلة. اكتب فقط الترجمة بدون أي مقدمة:\n\n${text}`,
  translate_ar: (text) => `ترجم النص التالي إلى العربية الفصحى الجميلة. اكتب فقط الترجمة بدون أي مقدمة:\n\n${text}`,
  fix_grammar: (text) => `صحّح الأخطاء الإملائية والنحوية وعلامات الترقيم في النص التالي فقط. لا تغيّر الأسلوب ولا الكلمات ولا تعيد الصياغة. اكتب فقط النص المصحّح:\n\n${text}`,
  ideas: (text) => `بناءً على النص التالي، اقترح 5 أفكار إبداعية للتطوير والإضافة. ابدأ كل فكرة بشرطة بسيطة وبدون تنسيق Markdown:\n\n${text}`,
  outline: (text) => `اقترح مخططاً تفصيلياً ومنظماً لقصة أو مقال بناءً على الموضوع التالي:\n\n${text}`,
  titles: (text) => `اقترح 5 عناوين جذابة وإبداعية للنص التالي. اكتب كل عنوان في سطر:\n\n${text}`,
  youtube_script: (text) => `حوّل الأفكار التالية إلى سكربت فيديو يوتيوب عربي كامل وجاهز للقراءة. ابدأ بمقدمة جذابة، ثم فقرات واضحة، واختم بخاتمة. استخدم نبرة محادثة طبيعية ولا تستخدم Markdown:\n\n${text}`,
};

function chatPrompt(docContent, message) {
  const document = docContent?.trim()
    ? `\n\nمستند المستخدم الحالي، استعمله كسياق إذا كان السؤال متعلقاً به:\n---\n${docContent}\n---`
    : "";
  return `أنت مساعد كتابة ذكي ومفيد. أجب باللغة العربية بشكل واضح ومباشر، بدون تنسيق Markdown أو زخرفة بصرية.${document}\n\nسؤال المستخدم: ${message}\n\nالإجابة:`;
}

export function buildAIPrompt({ action, text, instruction, docContent }) {
  if (action === "chat") return chatPrompt(docContent || text, instruction || text);
  const factory = ACTION_PROMPTS[action];
  if (!factory) throw new Error("إجراء غير معروف");
  const prompt = factory(text);
  return instruction ? `${prompt}\n\nتعليمات إضافية: ${instruction}` : prompt;
}

export async function nativeGenerateAI(body) {
  if (!isNativeIOS) throw new Error("Native AI is only available on iPad");
  if (!body.providerConfig?.baseUrl || !body.model) throw new Error("أكمل إعدادات مزود الـAPI والموديل أولاً");
  const result = await NativeAI.generate({
    baseUrl: body.providerConfig.baseUrl,
    model: body.model,
    prompt: buildAIPrompt(body),
  });
  return result.text || "";
}

export async function nativeTestProvider(baseUrl) {
  return NativeAI.test({ baseUrl });
}

export async function nativeListModels(baseUrl) {
  const result = await NativeAI.models({ baseUrl });
  return result.models || [];
}
