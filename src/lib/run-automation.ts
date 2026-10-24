import { completeChat, fetchNews, fetchPageText, fetchWeather, generateImage, speakText } from "@/lib/ai.functions";
import { type Automation, type AutoRun, type Data, type LibItem, uid, useStudio } from "@/lib/studio-store";

const stops = new Set<string>();
export function requestStop(id: string) {
  stops.add(id);
}

function stopped(id: string) {
  return stops.has(id);
}

function patch(id: string, fn: (a: Automation) => void) {
  useStudio.getState().mutate((d) => {
    const a = d.automations.find((item) => item.id === id);
    if (a) fn(a);
  });
}

function addFile(item: Omit<LibItem, "id" | "at" | "icon" | "color"> & Partial<Pick<LibItem, "icon" | "color">>) {
  useStudio.getState().mutate((d) => {
    d.library.unshift({
      id: uid("lib"),
      at: Date.now(),
      icon: item.icon ?? "square",
      color: item.color ?? "#f4f4f5",
      ...item,
    });
  });
}

function deliver(auto: Automation, text: string, title: string) {
  if (auto.deliver !== "library") {
    useStudio.getState().mutate((d) => {
      let chat = d.chats.find((c) => c.id === "chat-auto");
      if (!chat) {
        chat = { id: "chat-auto", title: "Автоматизации", pinned: false, updated: Date.now(), messages: [] };
        d.chats.unshift(chat);
      }
      chat.messages.push({
        id: uid("m"),
        role: "assistant",
        content: text,
        at: Date.now(),
        fromAuto: true,
        note: auto.name,
      });
      chat.updated = Date.now();
    });
  }
  if (auto.deliver !== "chat") {
    addFile({ kind: "file", title, text, from: auto.id });
  }
}

function nextRun(auto: Automation, now: number) {
  if (auto.schedule === "hourly") return now + 60 * 60 * 1000;
  if (auto.schedule === "daily") return now + 24 * 60 * 60 * 1000;
  return undefined;
}

function finish(id: string, result: string, extra?: (a: Automation) => void) {
  const now = Date.now();
  patch(id, (a) => {
    a.status = "done";
    a.lastRun = now;
    a.nextRun = nextRun(a, now);
    const entry: AutoRun = { at: now, status: "done", result: result.slice(0, 400) };
    a.history = [entry, ...a.history].slice(0, 24);
    extra?.(a);
  });
}

function fail(id: string, error: string) {
  const now = Date.now();
  patch(id, (a) => {
    a.status = "error";
    a.lastRun = now;
    const entry: AutoRun = { at: now, status: "error", result: error.slice(0, 400) };
    a.history = [entry, ...a.history].slice(0, 24);
  });
}

async function ask(data: Data, prompt: string) {
  const res = await completeChat({
    data: {
      messages: [{ role: "user", content: prompt }],
      mode: "fast",
      model: "grok",
      deep: false,
      skills: "",
      persona: "Короткий служебный ответ для автоматизации.",
      keys: data.keys,
    },
  });
  if (!res.ok) throw new Error(res.error);
  return res.text;
}

export async function runAutomation(id: string) {
  stops.delete(id);
  const data = useStudio.getState().data;
  const auto = data.automations.find((a) => a.id === id);
  if (!auto) return;
  patch(id, (a) => {
    a.status = "running";
    a.paused = false;
  });
  try {
    if (auto.preset === "morning") {
      const [weather, news] = await Promise.all([
        fetchWeather({ data: { city: auto.city || data.city } }),
        fetchNews({ data: { query: auto.topics || "главное", lang: auto.language } }),
      ]);
      if (stopped(id)) return fail(id, "Остановлено");
      const items = news.ok ? filterNews(news.items, auto) : [];
      const tasks = auto.reminders.map((r) => r.text);
      const lines = [
        `Утренняя сводка`,
        weather.ok ? weather.text : "Погода недоступна",
        items.length ? items.slice(0, 5).map((n) => `• ${n.title}`).join("\n") : "Новостей по фильтру нет",
        tasks.length ? `Задачи:\n${tasks.map((t) => `• ${t}`).join("\n")}` : "Задач на напоминаниях нет",
      ];
      const text = lines.join("\n\n");
      deliver(auto, text, "Утренняя сводка");
      finish(id, text);
      return;
    }
    if (auto.preset === "watch") {
      const news = await fetchNews({ data: { query: auto.topics || auto.keyword || "новости", lang: auto.language } });
      if (!news.ok) throw new Error(news.error);
      const items = filterNews(news.items, auto);
      const hash = items.map((i) => i.title).join("|").slice(0, 500);
      if (stopped(id)) return fail(id, "Остановлено");
      if (hash && hash !== auto.lastHash) {
        const text = items.slice(0, 4).map((n) => `• ${n.title}`).join("\n") || "Лента обновилась";
        deliver(auto, `Слежка «${auto.keyword || auto.topics}»\n${text}`, "Слежка");
        finish(id, text, (a) => {
          a.lastHash = hash;
        });
      } else {
        finish(id, "Без изменений", (a) => {
          a.lastHash = hash || a.lastHash;
        });
      }
      return;
    }
    if (auto.preset === "content") {
      const prompt = auto.prompt || auto.topics || "Короткая заметка дня";
      if (auto.media === "image") {
        const img = await generateImage({ data: { prompt, quality: "480", aspect: "1:1" } });
        if (!img.ok) throw new Error(img.error);
        addFile({ kind: "media", mediaType: "image", title: prompt.slice(0, 48), url: img.url, from: auto.id, icon: "diamond" });
        if (auto.deliver !== "library") {
          useStudio.getState().mutate((d) => {
            const chat = d.chats.find((c) => c.id === "chat-auto") ?? {
              id: "chat-auto",
              title: "Автоматизации",
              pinned: false,
              updated: Date.now(),
              messages: [],
            };
            if (!d.chats.some((c) => c.id === "chat-auto")) d.chats.unshift(chat);
            chat.messages.push({
              id: uid("m"),
              role: "assistant",
              content: prompt,
              images: [img.url],
              at: Date.now(),
              fromAuto: true,
              note: auto.name,
            });
          });
        }
        finish(id, "Кадр готов");
        return;
      }
      if (auto.media === "audio") {
        const spoken = await speakText({ data: { text: prompt } });
        if (!spoken.ok) throw new Error(spoken.error);
        addFile({ kind: "media", mediaType: "audio", title: "Озвучка", url: spoken.audio, text: prompt, from: auto.id });
        finish(id, "Аудио готово");
        return;
      }
      const text = await ask(data, prompt);
      deliver(auto, text, "Автотекст");
      finish(id, text);
      return;
    }
    if (auto.preset === "summary") {
      let source = auto.prompt;
      if (auto.url) {
        const page = await fetchPageText({ data: { url: auto.url } });
        if (!page.ok) throw new Error(page.error);
        source = page.text;
      }
      if (!source) {
        const file = data.library.find((i) => i.kind === "file" && i.text);
        source = file?.text ?? "";
      }
      if (!source) throw new Error("Нет текста или ссылки для резюме");
      const text = await ask(data, `Сделай короткое резюме на русском:\n${source.slice(0, 3500)}`);
      deliver(auto, text, "Резюме");
      finish(id, text);
      return;
    }
    if (auto.preset === "research") {
      const topic = auto.topics || auto.prompt || "тема";
      const news = await fetchNews({ data: { query: topic, lang: auto.language } });
      const headlines = news.ok ? news.items.slice(0, 6).map((n) => n.title).join("\n") : "";
      const text = await ask(
        data,
        `Собери короткий ресёрч по теме «${topic}». Опирайся на заголовки, не выдумывай цифры:\n${headlines}`,
      );
      addFile({ kind: "file", title: `Ресёрч: ${topic}`.slice(0, 60), text, from: auto.id });
      if (auto.deliver !== "library") deliver({ ...auto, deliver: "chat" }, text, "Ресёрч");
      finish(id, text);
      return;
    }
    if (auto.preset === "translate") {
      const source = auto.prompt || data.library.find((i) => i.text)?.text || "";
      if (!source) throw new Error("Нечего переводить");
      const lang = auto.language === "en" ? "английский" : auto.language === "ru" ? "русский" : auto.language;
      const text = await ask(data, `Переведи на ${lang}. Только перевод:\n${source.slice(0, 3500)}`);
      deliver(auto, text, "Перевод");
      finish(id, text);
      return;
    }
    if (auto.preset === "media") {
      const news = await fetchNews({ data: { query: auto.topics || "фото", lang: auto.language } });
      if (!news.ok) throw new Error(news.error);
      const pics = filterNews(news.items, auto).filter((i) => i.image).slice(0, 6);
      if (!pics.length) throw new Error("В ленте не нашлось картинок");
      for (const pic of pics) {
        addFile({
          kind: "media",
          mediaType: "image",
          title: pic.title.slice(0, 64),
          url: pic.image,
          text: pic.link,
          from: auto.id,
          icon: "diamond",
        });
      }
      finish(id, `Собрано ${pics.length}`);
      return;
    }
    if (auto.preset === "backup") {
      const dump = data.chats
        .filter((c) => c.messages.length)
        .map((c) => `# ${c.title}\n` + c.messages.map((m) => `${m.role}: ${m.content}`).join("\n"))
        .join("\n\n");
      addFile({ kind: "file", title: `Бэкап чатов`, text: dump || "Чатов нет", from: auto.id });
      finish(id, "Бэкап записан в файлы");
      return;
    }
    if (auto.preset === "remind") {
      const due = auto.reminders.filter((r) => r.at <= Date.now());
      if (!due.length) {
        finish(id, "Нет подошедших напоминаний");
        return;
      }
      const text = due.map((r) => `• ${r.text}`).join("\n");
      deliver(auto, `Напоминание\n${text}`, "Напоминание");
      finish(id, text, (a) => {
        a.reminders = a.reminders
          .map((r) => {
            if (r.at > Date.now()) return r;
            if (r.repeat === "hourly") return { ...r, at: Date.now() + 60 * 60 * 1000 };
            if (r.repeat === "daily") return { ...r, at: Date.now() + 24 * 60 * 60 * 1000 };
            return null;
          })
          .filter((r): r is NonNullable<typeof r> => Boolean(r));
      });
      return;
    }
    const text = await ask(data, auto.prompt || auto.name);
    deliver(auto, text, auto.name);
    finish(id, text);
  } catch (err) {
    fail(id, err instanceof Error ? err.message : "Сбой автоматизации");
  }
}

function filterNews(
  items: { title: string; link: string; source: string; image?: string }[],
  auto: Automation,
) {
  const keys = auto.keyword
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const sources = auto.sources
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return items.filter((item) => {
    const blob = `${item.title} ${item.source} ${item.link}`.toLowerCase();
    if (keys.length && !keys.some((k) => blob.includes(k))) return false;
    if (sources.length && !sources.some((s) => blob.includes(s))) return false;
    return true;
  });
}

export function tickAutomations() {
  const { automations } = useStudio.getState().data;
  const now = Date.now();
  for (const auto of automations) {
    if (!auto.enabled || auto.paused || auto.status === "running") continue;
    if (auto.preset === "remind") {
      if (auto.reminders.some((r) => r.at <= now)) void runAutomation(auto.id);
      continue;
    }
    if ((auto.schedule === "hourly" || auto.schedule === "daily") && auto.nextRun && auto.nextRun <= now) {
      void runAutomation(auto.id);
    }
  }
}
