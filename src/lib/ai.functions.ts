import { createServerFn } from "@tanstack/react-start";

type Role = "user" | "assistant" | "system";
type ModelId = "grok" | "chatgpt" | "qwen" | "deepseek";
type ModeId = "fast" | "expert" | "build" | "council";

interface ChatMsg {
  role: Role;
  content: string;
}

interface ChatInput {
  messages: ChatMsg[];
  mode: ModeId;
  model: ModelId;
  deep: boolean;
  skills: string;
  persona: string;
  keys: { openai?: string; qwen?: string; deepseek?: string };
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n) : s;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function parseChat(v: unknown): ChatInput | null {
  const o = asRecord(v);
  if (!o || !Array.isArray(o.messages)) return null;
  const mode = o.mode;
  const model = o.model;
  const modes: ModeId[] = ["fast", "expert", "build", "council"];
  const models: ModelId[] = ["grok", "chatgpt", "qwen", "deepseek"];
  if (!modes.includes(mode as ModeId) || !models.includes(model as ModelId)) return null;
  const messages: ChatMsg[] = [];
  for (const item of o.messages.slice(-12)) {
    const m = asRecord(item);
    if (!m) continue;
    if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") continue;
    if (typeof m.content !== "string" || !m.content.trim()) continue;
    messages.push({ role: m.role, content: clip(m.content, 6000) });
  }
  if (!messages.length) return null;
  const keys = asRecord(o.keys) ?? {};
  const key = (x: unknown) => (typeof x === "string" ? clip(x.trim(), 300) : "");
  return {
    messages,
    mode: mode as ModeId,
    model: model as ModelId,
    deep: Boolean(o.deep),
    skills: typeof o.skills === "string" ? clip(o.skills, 4000) : "",
    persona: typeof o.persona === "string" ? clip(o.persona, 800) : "",
    keys: { openai: key(keys.openai), qwen: key(keys.qwen), deepseek: key(keys.deepseek) },
  };
}

function systemPrompt(input: ChatInput) {
  const modeLine =
    input.mode === "fast"
      ? "Режим быстрый: ответь коротко, 4–8 предложений или список."
      : input.mode === "expert"
        ? "Режим эксперт: разбери вопрос по слоям, затем дай вывод. Без воды."
        : input.mode === "build"
          ? "Режим сборки: если просят интерфейс или код, дай цельный рабочий фрагмент. HTML оборачивай в ```html."
          : "Режим группы экспертов: три коротких взгляда (инженер, редактор, скептик), затем общий вывод.";
  const deep = input.deep
    ? "Сначала блок «Ход мысли» в 4–6 строках, затем ответ."
    : "Не показывай длинную внутреннюю цепочку.";
  const skills = input.skills ? `\nНавыки пользователя:\n${input.skills}` : "";
  const persona = input.persona ? `\nРоль: ${input.persona}` : "";
  return `Ты Grok, ИИ в тёмном веб-интерфейсе. Отвечай на языке пользователя. Ты игрок-помощник: конкретный следующий шаг. ${modeLine} ${deep}${persona}${skills}`;
}

function tokens(mode: ModeId, deep: boolean) {
  const base = mode === "fast" ? 420 : mode === "expert" ? 900 : mode === "build" ? 1400 : 1000;
  return deep ? base + 280 : base;
}

async function postChat(url: string, key: string, model: string, messages: ChatMsg[], max: number) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, max_tokens: max, temperature: 0.6 }),
    signal: AbortSignal.timeout(40_000),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false as const, error: clip(text.replace(/\s+/g, " "), 280) || `Ошибка ${res.status}` };
  try {
    const json = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) return { ok: false as const, error: "Пустой ответ модели" };
    return { ok: true as const, text: content };
  } catch {
    return { ok: false as const, error: "Не удалось прочитать ответ" };
  }
}

export const completeChat = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const input = parseChat(data);
    if (!input) return { ok: false as const, error: "Некорректный запрос" };
    const messages: ChatMsg[] = [{ role: "system", content: systemPrompt(input) }, ...input.messages];
    const max = tokens(input.mode, input.deep);
    const xai = process.env.XAI_API_KEY;
    const want =
      input.model === "chatgpt" ? input.keys.openai : input.model === "qwen" ? input.keys.qwen : input.model === "deepseek" ? input.keys.deepseek : "";

    if (input.model === "chatgpt" && want) {
      const r = await postChat("https://api.openai.com/v1/chat/completions", want, "gpt-4o-mini", messages, max);
      return r.ok ? { ...r, via: "ChatGPT" } : r;
    }
    if (input.model === "deepseek" && want) {
      const r = await postChat("https://api.deepseek.com/chat/completions", want, "deepseek-chat", messages, max);
      return r.ok ? { ...r, via: "DeepSeek" } : r;
    }
    if (input.model === "qwen" && want) {
      const first = await postChat(
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
        want,
        "qwen-plus",
        messages,
        max,
      );
      if (first.ok) return { ...first, via: "Qwen" };
      const second = await postChat(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        want,
        "qwen-plus",
        messages,
        max,
      );
      return second.ok ? { ...second, via: "Qwen" } : second;
    }
    if (!xai) {
      return { ok: false as const, error: "Нет ключа модели. Добавьте ключ в профиле или откройте Grok, когда сервис доступен." };
    }
    const r = await postChat("https://api.x.ai/v1/chat/completions", xai, "grok-4.5", messages, max);
    if (!r.ok) return r;
    const note =
      input.model !== "grok"
        ? `Ключ ${input.model === "chatgpt" ? "ChatGPT" : input.model === "qwen" ? "Qwen" : "DeepSeek"} не задан — ответил Grok.`
        : undefined;
    return { ok: true as const, text: r.text, via: "Grok", note };
  });

function aspectApi(aspect: string) {
  if (aspect === "1:2") return "9:16";
  if (aspect === "2:3" || aspect === "1:1" || aspect === "9:16" || aspect === "16:9") return aspect;
  return "1:1";
}

export const generateImage = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const o = asRecord(data);
    const prompt = typeof o?.prompt === "string" ? clip(o.prompt.trim(), 1200) : "";
    if (!prompt) return { ok: false as const, error: "Пустой запрос" };
    const key = process.env.XAI_API_KEY;
    if (!key) return { ok: false as const, error: "Генерация картинок сейчас недоступна" };
    const quality = o?.quality === "1080" ? "1080" : o?.quality === "720" ? "720" : "480";
    const aspect = aspectApi(typeof o?.aspect === "string" ? o.aspect : "1:1");
    const body = {
      model: quality === "1080" ? "grok-imagine-image-quality" : "grok-imagine-image",
      prompt,
      n: 1,
      response_format: "url",
      aspect_ratio: aspect,
      resolution: quality === "1080" ? "2k" : "1k",
    };
    const call = async (payload: object) => {
      const res = await fetch("https://api.x.ai/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(50_000),
      });
      const text = await res.text();
      return { ok: res.ok, text };
    };
    let result = await call(body);
    if (!result.ok && /aspect|resolution|model/i.test(result.text)) {
      result = await call({ model: "grok-imagine-image", prompt, n: 1, response_format: "url" });
    }
    if (!result.ok) return { ok: false as const, error: clip(result.text.replace(/\s+/g, " "), 280) || "Ошибка картинки" };
    try {
      const json = JSON.parse(result.text) as { data?: { url?: string; b64_json?: string }[] };
      const item = json.data?.[0];
      const url = item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : "");
      if (!url) return { ok: false as const, error: "Картинка не вернулась" };
      return { ok: true as const, url };
    } catch {
      return { ok: false as const, error: "Не удалось прочитать картинку" };
    }
  });

export const startVideo = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const o = asRecord(data);
    const prompt = typeof o?.prompt === "string" ? clip(o.prompt.trim(), 800) : "";
    if (!prompt) return { ok: false as const, error: "Пустой запрос" };
    const key = process.env.XAI_API_KEY;
    if (!key) return { ok: false as const, error: "Генерация видео сейчас недоступна" };
    const seconds = Math.min(6, Math.max(1, Number(o?.seconds) || 6));
    const quality = o?.quality === "1080" ? "1080p" : o?.quality === "720" ? "720p" : "480p";
    const res = await fetch("https://api.x.ai/v1/videos/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "grok-imagine-video-1.5-lite",
        prompt,
        duration: seconds,
        resolution: quality,
        aspect_ratio: aspectApi(typeof o?.aspect === "string" ? o.aspect : "16:9"),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false as const, error: clip(text.replace(/\s+/g, " "), 280) || "Ошибка видео" };
    try {
      const json = JSON.parse(text) as { request_id?: string; id?: string; url?: string; video?: { url?: string } };
      const url = json.url || json.video?.url;
      if (url) return { ok: true as const, url, requestId: "" };
      const requestId = json.request_id || json.id || "";
      if (!requestId) return { ok: false as const, error: "Сервис не вернул задачу видео" };
      return { ok: true as const, url: "", requestId };
    } catch {
      return { ok: false as const, error: "Не удалось начать видео" };
    }
  });

export const pollVideo = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const o = asRecord(data);
    const requestId = typeof o?.requestId === "string" ? o.requestId.replace(/[^\w-]/g, "").slice(0, 80) : "";
    if (!requestId) return { ok: false as const, pending: false, error: "Нет задачи" };
    const key = process.env.XAI_API_KEY;
    if (!key) return { ok: false as const, pending: false, error: "Видео недоступно" };
    const headers = { Authorization: `Bearer ${key}` };
    const urls = [`https://api.x.ai/v1/videos/${requestId}`, `https://api.x.ai/v1/videos/generations/${requestId}`];
    let last = "";
    for (const url of urls) {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      last = await res.text();
      if (res.status === 404) continue;
      if (!res.ok) return { ok: false as const, pending: false, error: clip(last.replace(/\s+/g, " "), 220) };
      try {
        const json = JSON.parse(last) as {
          status?: string;
          state?: string;
          url?: string;
          video?: { url?: string };
          error?: string | { message?: string };
        };
        const videoUrl = json.url || json.video?.url || "";
        const status = (json.status || json.state || "").toLowerCase();
        if (videoUrl) return { ok: true as const, url: videoUrl };
        if (status.includes("fail") || status.includes("error")) {
          const err = typeof json.error === "string" ? json.error : json.error?.message;
          return { ok: false as const, pending: false, error: err || "Видео не собралось" };
        }
        return { ok: false as const, pending: true as const };
      } catch {
        return { ok: false as const, pending: false, error: "Странный ответ видео" };
      }
    }
    return { ok: false as const, pending: false, error: clip(last.replace(/\s+/g, " "), 180) || "Задача не найдена" };
  });

export const speakText = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const o = asRecord(data);
    const text = typeof o?.text === "string" ? clip(o.text.trim(), 500) : "";
    if (!text) return { ok: false as const, error: "Нечего озвучивать" };
    const key = process.env.XAI_API_KEY;
    if (!key) return { ok: false as const, error: "Озвучка сейчас недоступна" };
    const res = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ text, voice_id: "eve" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false as const, error: clip(err.replace(/\s+/g, " "), 220) || "Ошибка озвучки" };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { ok: true as const, audio: `data:audio/mpeg;base64,${btoa(bin)}` };
  });

function safeHttp(raw: string) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase();
    if (
      h === "localhost" ||
      h.endsWith(".local") ||
      h === "0.0.0.0" ||
      h.startsWith("127.") ||
      h.startsWith("10.") ||
      h.startsWith("192.168.") ||
      h.startsWith("169.254.") ||
      h === "metadata.google.internal"
    ) {
      return null;
    }
    return u;
  } catch {
    return null;
  }
}

function decodeXml(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export const fetchNews = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const o = asRecord(data);
    const q = typeof o?.query === "string" ? clip(o.query.trim(), 120) : "новости";
    const lang = o?.lang === "en" ? "en" : "ru";
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${lang}&gl=${lang === "ru" ? "RU" : "US"}&ceid=${lang === "ru" ? "RU:ru" : "US:en"}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "GrokStudio/1.0" } });
    if (!res.ok) return { ok: false as const, error: "Лента новостей не ответила", items: [] as NewsItem[] };
    const xml = await res.text();
    const items: NewsItem[] = [];
    for (const block of xml.split(/<item[\s>]/i).slice(1, 14)) {
      const title = decodeXml(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
      const link = decodeXml(block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "");
      const source = decodeXml(block.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] ?? "");
      const image = block.match(/url=["'](https?:[^"']+)["']/i)?.[1];
      if (title) items.push({ title, link, source, image });
    }
    return { ok: true as const, items, error: "" };
  });

interface NewsItem {
  title: string;
  link: string;
  source: string;
  image?: string;
}

export const fetchWeather = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const o = asRecord(data);
    const city = typeof o?.city === "string" && o.city.trim() ? clip(o.city.trim(), 60) : "Москва";
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!geoRes.ok) return { ok: false as const, error: "Город не найден" };
    const geo = (await geoRes.json()) as { results?: { latitude: number; longitude: number; name: string }[] };
    const hit = geo.results?.[0];
    if (!hit) return { ok: false as const, error: `Нет такого города: ${city}` };
    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!wRes.ok) return { ok: false as const, error: "Погода не ответила" };
    const w = (await wRes.json()) as { current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number } };
    const code = w.current?.weather_code ?? -1;
    const sky = code === 0 ? "ясно" : code < 3 ? "мало облаков" : code < 50 ? "пасмурно" : code < 70 ? "дождь" : code < 80 ? "снег" : "осадки";
    return {
      ok: true as const,
      text: `${hit.name}: ${w.current?.temperature_2m ?? "?"}°C, ${sky}, ветер ${w.current?.wind_speed_10m ?? "?"} м/с`,
    };
  });

export const fetchPageText = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const o = asRecord(data);
    const u = safeHttp(typeof o?.url === "string" ? o.url.trim() : "");
    if (!u) return { ok: false as const, error: "Нужна обычная http(s) ссылка" };
    const res = await fetch(u, { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "GrokStudio/1.0" } });
    if (!res.ok) return { ok: false as const, error: `Страница ответила ${res.status}` };
    const html = await res.text();
    const text = decodeXml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "))
      .replace(/\s+/g, " ")
      .trim();
    return { ok: true as const, text: clip(text, 4000), title: decodeXml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? u.hostname) };
  });
