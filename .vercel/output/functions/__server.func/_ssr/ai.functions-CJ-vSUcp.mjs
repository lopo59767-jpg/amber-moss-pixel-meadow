import { n as TSS_SERVER_FUNCTION, t as createServerFn } from "./ssr.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/ai.functions-CJ-vSUcp.js
var createServerRpc = (serverFnMeta, splitImportFn) => {
	const url = "/_serverFn/" + serverFnMeta.id;
	return Object.assign(splitImportFn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
function clip(s, n) {
	return s.length > n ? s.slice(0, n) : s;
}
function asRecord(v) {
	return v && typeof v === "object" ? v : null;
}
function parseChat(v) {
	const o = asRecord(v);
	if (!o || !Array.isArray(o.messages)) return null;
	const mode = o.mode;
	const model = o.model;
	if (![
		"fast",
		"expert",
		"build",
		"council"
	].includes(mode) || ![
		"grok",
		"chatgpt",
		"qwen",
		"deepseek"
	].includes(model)) return null;
	const messages = [];
	for (const item of o.messages.slice(-12)) {
		const m = asRecord(item);
		if (!m) continue;
		if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") continue;
		if (typeof m.content !== "string" || !m.content.trim()) continue;
		messages.push({
			role: m.role,
			content: clip(m.content, 6e3)
		});
	}
	if (!messages.length) return null;
	const keys = asRecord(o.keys) ?? {};
	const key = (x) => typeof x === "string" ? clip(x.trim(), 300) : "";
	return {
		messages,
		mode,
		model,
		deep: Boolean(o.deep),
		skills: typeof o.skills === "string" ? clip(o.skills, 4e3) : "",
		persona: typeof o.persona === "string" ? clip(o.persona, 800) : "",
		keys: {
			openai: key(keys.openai),
			qwen: key(keys.qwen),
			deepseek: key(keys.deepseek)
		}
	};
}
function systemPrompt(input) {
	const modeLine = input.mode === "fast" ? "Режим быстрый: ответь коротко, 4–8 предложений или список." : input.mode === "expert" ? "Режим эксперт: разбери вопрос по слоям, затем дай вывод. Без воды." : input.mode === "build" ? "Режим сборки: если просят интерфейс или код, дай цельный рабочий фрагмент. HTML оборачивай в ```html." : "Режим группы экспертов: три коротких взгляда (инженер, редактор, скептик), затем общий вывод.";
	const deep = input.deep ? "Сначала блок «Ход мысли» в 4–6 строках, затем ответ." : "Не показывай длинную внутреннюю цепочку.";
	const skills = input.skills ? `\nНавыки пользователя:\n${input.skills}` : "";
	return `Ты Grok, ИИ в тёмном веб-интерфейсе. Отвечай на языке пользователя. Ты игрок-помощник: конкретный следующий шаг. ${modeLine} ${deep}${input.persona ? `\nРоль: ${input.persona}` : ""}${skills}`;
}
function tokens(mode, deep) {
	const base = mode === "fast" ? 420 : mode === "expert" ? 900 : mode === "build" ? 1400 : 1e3;
	return deep ? base + 280 : base;
}
async function postChat(url, key, model, messages, max) {
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${key}`
		},
		body: JSON.stringify({
			model,
			messages,
			max_tokens: max,
			temperature: .6
		}),
		signal: AbortSignal.timeout(4e4)
	});
	const text = await res.text();
	if (!res.ok) return {
		ok: false,
		error: clip(text.replace(/\s+/g, " "), 280) || `Ошибка ${res.status}`
	};
	try {
		const content = JSON.parse(text).choices?.[0]?.message?.content?.trim();
		if (!content) return {
			ok: false,
			error: "Пустой ответ модели"
		};
		return {
			ok: true,
			text: content
		};
	} catch {
		return {
			ok: false,
			error: "Не удалось прочитать ответ"
		};
	}
}
var completeChat_createServerFn_handler = createServerRpc({
	id: "7578ba78b0bf53b21aa736d97fbf5317315b37797d218d5769b47300ca85788a",
	name: "completeChat",
	filename: "src/lib/ai.functions.ts"
}, (opts) => completeChat.__executeServer(opts));
var completeChat = createServerFn({ method: "POST" }).validator((input) => input).handler(completeChat_createServerFn_handler, async ({ data }) => {
	const input = parseChat(data);
	if (!input) return {
		ok: false,
		error: "Некорректный запрос"
	};
	const messages = [{
		role: "system",
		content: systemPrompt(input)
	}, ...input.messages];
	const max = tokens(input.mode, input.deep);
	const xai = process.env.XAI_API_KEY;
	const want = input.model === "chatgpt" ? input.keys.openai : input.model === "qwen" ? input.keys.qwen : input.model === "deepseek" ? input.keys.deepseek : "";
	if (input.model === "chatgpt" && want) {
		const r = await postChat("https://api.openai.com/v1/chat/completions", want, "gpt-4o-mini", messages, max);
		return r.ok ? {
			...r,
			via: "ChatGPT"
		} : r;
	}
	if (input.model === "deepseek" && want) {
		const r = await postChat("https://api.deepseek.com/chat/completions", want, "deepseek-chat", messages, max);
		return r.ok ? {
			...r,
			via: "DeepSeek"
		} : r;
	}
	if (input.model === "qwen" && want) {
		const first = await postChat("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions", want, "qwen-plus", messages, max);
		if (first.ok) return {
			...first,
			via: "Qwen"
		};
		const second = await postChat("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", want, "qwen-plus", messages, max);
		return second.ok ? {
			...second,
			via: "Qwen"
		} : second;
	}
	if (!xai) return {
		ok: false,
		error: "Нет ключа модели. Добавьте ключ в профиле или откройте Grok, когда сервис доступен."
	};
	const r = await postChat("https://api.x.ai/v1/chat/completions", xai, "grok-4.5", messages, max);
	if (!r.ok) return r;
	const note = input.model !== "grok" ? `Ключ ${input.model === "chatgpt" ? "ChatGPT" : input.model === "qwen" ? "Qwen" : "DeepSeek"} не задан — ответил Grok.` : void 0;
	return {
		ok: true,
		text: r.text,
		via: "Grok",
		note
	};
});
function aspectApi(aspect) {
	if (aspect === "1:2") return "9:16";
	if (aspect === "2:3" || aspect === "1:1" || aspect === "9:16" || aspect === "16:9") return aspect;
	return "1:1";
}
var generateImage_createServerFn_handler = createServerRpc({
	id: "f4f7102c98fb06b3bb2a78d01e16cff50f34f042ca33370ef939be87660105a0",
	name: "generateImage",
	filename: "src/lib/ai.functions.ts"
}, (opts) => generateImage.__executeServer(opts));
var generateImage = createServerFn({ method: "POST" }).validator((input) => input).handler(generateImage_createServerFn_handler, async ({ data }) => {
	const o = asRecord(data);
	const prompt = typeof o?.prompt === "string" ? clip(o.prompt.trim(), 1200) : "";
	if (!prompt) return {
		ok: false,
		error: "Пустой запрос"
	};
	const key = process.env.XAI_API_KEY;
	if (!key) return {
		ok: false,
		error: "Генерация картинок сейчас недоступна"
	};
	const quality = o?.quality === "1080" ? "1080" : o?.quality === "720" ? "720" : "480";
	const aspect = aspectApi(typeof o?.aspect === "string" ? o.aspect : "1:1");
	const body = {
		model: quality === "1080" ? "grok-imagine-image-quality" : "grok-imagine-image",
		prompt,
		n: 1,
		response_format: "url",
		aspect_ratio: aspect,
		resolution: quality === "1080" ? "2k" : "1k"
	};
	const call = async (payload) => {
		const res = await fetch("https://api.x.ai/v1/images/generations", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${key}`
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(5e4)
		});
		const text = await res.text();
		return {
			ok: res.ok,
			text
		};
	};
	let result = await call(body);
	if (!result.ok && /aspect|resolution|model/i.test(result.text)) result = await call({
		model: "grok-imagine-image",
		prompt,
		n: 1,
		response_format: "url"
	});
	if (!result.ok) return {
		ok: false,
		error: clip(result.text.replace(/\s+/g, " "), 280) || "Ошибка картинки"
	};
	try {
		const item = JSON.parse(result.text).data?.[0];
		const url = item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : "");
		if (!url) return {
			ok: false,
			error: "Картинка не вернулась"
		};
		return {
			ok: true,
			url
		};
	} catch {
		return {
			ok: false,
			error: "Не удалось прочитать картинку"
		};
	}
});
var startVideo_createServerFn_handler = createServerRpc({
	id: "5c68838d828b3ea1f37ff7c2e6032702f35fffb9ec174038960bb83e3b7e7d68",
	name: "startVideo",
	filename: "src/lib/ai.functions.ts"
}, (opts) => startVideo.__executeServer(opts));
var startVideo = createServerFn({ method: "POST" }).validator((input) => input).handler(startVideo_createServerFn_handler, async ({ data }) => {
	const o = asRecord(data);
	const prompt = typeof o?.prompt === "string" ? clip(o.prompt.trim(), 800) : "";
	if (!prompt) return {
		ok: false,
		error: "Пустой запрос"
	};
	const key = process.env.XAI_API_KEY;
	if (!key) return {
		ok: false,
		error: "Генерация видео сейчас недоступна"
	};
	const seconds = Math.min(6, Math.max(1, Number(o?.seconds) || 6));
	const quality = o?.quality === "1080" ? "1080p" : o?.quality === "720" ? "720p" : "480p";
	const res = await fetch("https://api.x.ai/v1/videos/generations", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${key}`
		},
		body: JSON.stringify({
			model: "grok-imagine-video-1.5-lite",
			prompt,
			duration: seconds,
			resolution: quality,
			aspect_ratio: aspectApi(typeof o?.aspect === "string" ? o.aspect : "16:9")
		}),
		signal: AbortSignal.timeout(3e4)
	});
	const text = await res.text();
	if (!res.ok) return {
		ok: false,
		error: clip(text.replace(/\s+/g, " "), 280) || "Ошибка видео"
	};
	try {
		const json = JSON.parse(text);
		const url = json.url || json.video?.url;
		if (url) return {
			ok: true,
			url,
			requestId: ""
		};
		const requestId = json.request_id || json.id || "";
		if (!requestId) return {
			ok: false,
			error: "Сервис не вернул задачу видео"
		};
		return {
			ok: true,
			url: "",
			requestId
		};
	} catch {
		return {
			ok: false,
			error: "Не удалось начать видео"
		};
	}
});
var pollVideo_createServerFn_handler = createServerRpc({
	id: "8d261cb89cbb1e5149d9f2437193b8c2b6140022579baffb3c5ddfebc94f7f52",
	name: "pollVideo",
	filename: "src/lib/ai.functions.ts"
}, (opts) => pollVideo.__executeServer(opts));
var pollVideo = createServerFn({ method: "POST" }).validator((input) => input).handler(pollVideo_createServerFn_handler, async ({ data }) => {
	const o = asRecord(data);
	const requestId = typeof o?.requestId === "string" ? o.requestId.replace(/[^\w-]/g, "").slice(0, 80) : "";
	if (!requestId) return {
		ok: false,
		pending: false,
		error: "Нет задачи"
	};
	const key = process.env.XAI_API_KEY;
	if (!key) return {
		ok: false,
		pending: false,
		error: "Видео недоступно"
	};
	const headers = { Authorization: `Bearer ${key}` };
	const urls = [`https://api.x.ai/v1/videos/${requestId}`, `https://api.x.ai/v1/videos/generations/${requestId}`];
	let last = "";
	for (const url of urls) {
		const res = await fetch(url, {
			headers,
			signal: AbortSignal.timeout(2e4)
		});
		last = await res.text();
		if (res.status === 404) continue;
		if (!res.ok) return {
			ok: false,
			pending: false,
			error: clip(last.replace(/\s+/g, " "), 220)
		};
		try {
			const json = JSON.parse(last);
			const videoUrl = json.url || json.video?.url || "";
			const status = (json.status || json.state || "").toLowerCase();
			if (videoUrl) return {
				ok: true,
				url: videoUrl
			};
			if (status.includes("fail") || status.includes("error")) return {
				ok: false,
				pending: false,
				error: (typeof json.error === "string" ? json.error : json.error?.message) || "Видео не собралось"
			};
			return {
				ok: false,
				pending: true
			};
		} catch {
			return {
				ok: false,
				pending: false,
				error: "Странный ответ видео"
			};
		}
	}
	return {
		ok: false,
		pending: false,
		error: clip(last.replace(/\s+/g, " "), 180) || "Задача не найдена"
	};
});
var speakText_createServerFn_handler = createServerRpc({
	id: "635015c9110bf2836c4e8b6eb57ddc98f630ff641fe04413cc3fab2af18c9276",
	name: "speakText",
	filename: "src/lib/ai.functions.ts"
}, (opts) => speakText.__executeServer(opts));
var speakText = createServerFn({ method: "POST" }).validator((input) => input).handler(speakText_createServerFn_handler, async ({ data }) => {
	const o = asRecord(data);
	const text = typeof o?.text === "string" ? clip(o.text.trim(), 500) : "";
	if (!text) return {
		ok: false,
		error: "Нечего озвучивать"
	};
	const key = process.env.XAI_API_KEY;
	if (!key) return {
		ok: false,
		error: "Озвучка сейчас недоступна"
	};
	const res = await fetch("https://api.x.ai/v1/tts", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${key}`
		},
		body: JSON.stringify({
			text,
			voice_id: "eve"
		}),
		signal: AbortSignal.timeout(3e4)
	});
	if (!res.ok) return {
		ok: false,
		error: clip((await res.text()).replace(/\s+/g, " "), 220) || "Ошибка озвучки"
	};
	const bytes = new Uint8Array(await res.arrayBuffer());
	let bin = "";
	for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
	return {
		ok: true,
		audio: `data:audio/mpeg;base64,${btoa(bin)}`
	};
});
function safeHttp(raw) {
	try {
		const u = new URL(raw);
		if (u.protocol !== "http:" && u.protocol !== "https:") return null;
		const h = u.hostname.toLowerCase();
		if (h === "localhost" || h.endsWith(".local") || h === "0.0.0.0" || h.startsWith("127.") || h.startsWith("10.") || h.startsWith("192.168.") || h.startsWith("169.254.") || h === "metadata.google.internal") return null;
		return u;
	} catch {
		return null;
	}
}
function decodeXml(s) {
	return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, "\"").replace(/&#39;/g, "'").trim();
}
var fetchNews_createServerFn_handler = createServerRpc({
	id: "755d5e62c482d6cc8b24df5853d48c631a03ecbc391d3e0e67fb927c7cecd765",
	name: "fetchNews",
	filename: "src/lib/ai.functions.ts"
}, (opts) => fetchNews.__executeServer(opts));
var fetchNews = createServerFn({ method: "POST" }).validator((input) => input).handler(fetchNews_createServerFn_handler, async ({ data }) => {
	const o = asRecord(data);
	const q = typeof o?.query === "string" ? clip(o.query.trim(), 120) : "новости";
	const lang = o?.lang === "en" ? "en" : "ru";
	const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${lang}&gl=${lang === "ru" ? "RU" : "US"}&ceid=${lang === "ru" ? "RU:ru" : "US:en"}`;
	const res = await fetch(url, {
		signal: AbortSignal.timeout(15e3),
		headers: { "User-Agent": "GrokStudio/1.0" }
	});
	if (!res.ok) return {
		ok: false,
		error: "Лента новостей не ответила",
		items: []
	};
	const xml = await res.text();
	const items = [];
	for (const block of xml.split(/<item[\s>]/i).slice(1, 14)) {
		const title = decodeXml(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
		const link = decodeXml(block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "");
		const source = decodeXml(block.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] ?? "");
		const image = block.match(/url=["'](https?:[^"']+)["']/i)?.[1];
		if (title) items.push({
			title,
			link,
			source,
			image
		});
	}
	return {
		ok: true,
		items,
		error: ""
	};
});
var fetchWeather_createServerFn_handler = createServerRpc({
	id: "4bcd2f63ccfde49dff28eaa6d26b9f834548e728d77aaad6740bc2148d682eb5",
	name: "fetchWeather",
	filename: "src/lib/ai.functions.ts"
}, (opts) => fetchWeather.__executeServer(opts));
var fetchWeather = createServerFn({ method: "POST" }).validator((input) => input).handler(fetchWeather_createServerFn_handler, async ({ data }) => {
	const o = asRecord(data);
	const city = typeof o?.city === "string" && o.city.trim() ? clip(o.city.trim(), 60) : "Москва";
	const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru`, { signal: AbortSignal.timeout(12e3) });
	if (!geoRes.ok) return {
		ok: false,
		error: "Город не найден"
	};
	const hit = (await geoRes.json()).results?.[0];
	if (!hit) return {
		ok: false,
		error: `Нет такого города: ${city}`
	};
	const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`, { signal: AbortSignal.timeout(12e3) });
	if (!wRes.ok) return {
		ok: false,
		error: "Погода не ответила"
	};
	const w = await wRes.json();
	const code = w.current?.weather_code ?? -1;
	const sky = code === 0 ? "ясно" : code < 3 ? "мало облаков" : code < 50 ? "пасмурно" : code < 70 ? "дождь" : code < 80 ? "снег" : "осадки";
	return {
		ok: true,
		text: `${hit.name}: ${w.current?.temperature_2m ?? "?"}°C, ${sky}, ветер ${w.current?.wind_speed_10m ?? "?"} м/с`
	};
});
var fetchPageText_createServerFn_handler = createServerRpc({
	id: "8bd527d3e788e86c176579942590335e0222cc6f40cfd612bfb54c55053e7a2a",
	name: "fetchPageText",
	filename: "src/lib/ai.functions.ts"
}, (opts) => fetchPageText.__executeServer(opts));
var fetchPageText = createServerFn({ method: "POST" }).validator((input) => input).handler(fetchPageText_createServerFn_handler, async ({ data }) => {
	const o = asRecord(data);
	const u = safeHttp(typeof o?.url === "string" ? o.url.trim() : "");
	if (!u) return {
		ok: false,
		error: "Нужна обычная http(s) ссылка"
	};
	const res = await fetch(u, {
		signal: AbortSignal.timeout(12e3),
		headers: { "User-Agent": "GrokStudio/1.0" }
	});
	if (!res.ok) return {
		ok: false,
		error: `Страница ответила ${res.status}`
	};
	const html = await res.text();
	return {
		ok: true,
		text: clip(decodeXml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")).replace(/\s+/g, " ").trim(), 4e3),
		title: decodeXml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? u.hostname)
	};
});
//#endregion
export { completeChat_createServerFn_handler, fetchNews_createServerFn_handler, fetchPageText_createServerFn_handler, fetchWeather_createServerFn_handler, generateImage_createServerFn_handler, pollVideo_createServerFn_handler, speakText_createServerFn_handler, startVideo_createServerFn_handler };
