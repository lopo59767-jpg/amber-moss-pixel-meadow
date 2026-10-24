import { create } from "zustand";

export type ModelId = "grok" | "chatgpt" | "qwen" | "deepseek";
export type ModeId = "fast" | "expert" | "build" | "council";
export type GenKind = "chat" | "image" | "video" | "audio" | "agent";
export type Quality = "480" | "720" | "1080";
export type Aspect = "2:3" | "1:2" | "1:1" | "9:16" | "16:9";
export type LibTab = "all" | "media" | "projects" | "apps" | "files" | "automation";
export type AutoStatus = "idle" | "scheduled" | "running" | "done" | "error" | "paused";
export type Preset =
  | "morning"
  | "watch"
  | "content"
  | "summary"
  | "remind"
  | "research"
  | "translate"
  | "media"
  | "backup"
  | "custom";

export interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: number;
  images?: string[];
  video?: string;
  audio?: string;
  note?: string;
  fromAuto?: boolean;
}

export interface Chat {
  id: string;
  title: string;
  pinned: boolean;
  updated: number;
  messages: Msg[];
  draft?: boolean;
}

export interface Bot {
  id: string;
  name: string;
  color: string;
  shape: "orb" | "square" | "hex" | "ring";
  animation: "none" | "spin" | "pulse";
  avatar?: string;
  model: ModelId;
  persona: string;
}

export interface LibItem {
  id: string;
  kind: "media" | "project" | "app" | "file";
  title: string;
  at: number;
  mediaType?: "image" | "video" | "audio";
  url?: string;
  text?: string;
  icon: "circle" | "square" | "diamond" | "triangle";
  color: string;
  from?: string;
}

export interface AutoRun {
  at: number;
  status: "done" | "error";
  result: string;
}

export interface Reminder {
  id: string;
  text: string;
  at: number;
  repeat: "none" | "hourly" | "daily";
}

export interface Automation {
  id: string;
  name: string;
  blurb: string;
  preset: Preset;
  enabled: boolean;
  paused: boolean;
  schedule: "manual" | "hourly" | "daily" | "event";
  trigger: "time" | "keyword" | "upload" | "command";
  keyword: string;
  topics: string;
  sources: string;
  language: string;
  prompt: string;
  city: string;
  media: "text" | "image" | "audio";
  deliver: "chat" | "library" | "both";
  status: AutoStatus;
  lastRun?: number;
  nextRun?: number;
  lastHash?: string;
  history: AutoRun[];
  reminders: Reminder[];
  url?: string;
}

export interface SkillFile {
  id: string;
  name: string;
  text: string;
}

export interface RecentFile {
  id: string;
  name: string;
  text?: string;
  url?: string;
  mime: string;
  at: number;
}

export interface Data {
  chats: Chat[];
  activeChatId: string;
  bots: Bot[];
  activeBotId: string;
  botChat: Msg[];
  library: LibItem[];
  automations: Automation[];
  skills: SkillFile[];
  recent: RecentFile[];
  keys: { openai: string; qwen: string; deepseek: string };
  city: string;
  profileName: string;
  showAllChats: boolean;
  libView: "grid" | "list";
  libSort: "newest" | "oldest" | "name";
  libOnly: "all" | "media" | "projects" | "apps" | "files" | "untitled";
  sources: string[];
}

const T = 1_761_200_000_000;

const persona =
  "Ты игрок-помощник. Отвечай кратко, на языке пользователя, как напарник в деле: следующий шаг, а не лекция.";

function auto(
  partial: Pick<Automation, "id" | "name" | "blurb" | "preset"> & Partial<Automation>,
): Automation {
  return {
    enabled: false,
    paused: false,
    schedule: "manual",
    trigger: "time",
    keyword: "",
    topics: "",
    sources: "",
    language: "ru",
    prompt: "",
    city: "Москва",
    media: "text",
    deliver: "both",
    status: "idle",
    history: [],
    reminders: [],
    ...partial,
  };
}

export function defaultData(): Data {
  return {
    profileName: "Вы",
    city: "Москва",
    keys: { openai: "", qwen: "", deepseek: "" },
    showAllChats: false,
    libView: "grid",
    libSort: "newest",
    libOnly: "all",
    sources: [],
    skills: [],
    recent: [],
    activeChatId: "chat-draft",
    activeBotId: "bot-grok",
    botChat: [],
    bots: [
      {
        id: "bot-grok",
        name: "Grok Bot",
        color: "#f4f4f5",
        shape: "orb",
        animation: "pulse",
        model: "grok",
        persona,
      },
      {
        id: "bot-player",
        name: "Игрок-помощник",
        color: "#d4d4d8",
        shape: "hex",
        animation: "spin",
        model: "grok",
        persona: "Ты напарник в игре и в работе. Говори коротко, предлагай ход, держи темп.",
      },
    ],
    chats: [
      {
        id: "chat-draft",
        title: "Новый чат",
        pinned: false,
        updated: T + 50_000,
        draft: true,
        messages: [],
      },
      {
        id: "chat-hello",
        title: "Первый разговор",
        pinned: true,
        updated: T + 30_000,
        messages: [
          { id: "m1", role: "user", content: "Что ты умеешь в этом интерфейсе?", at: T },
          {
            id: "m2",
            role: "assistant",
            content:
              "Чат, картинки, короткое видео, озвучка, библиотека и автоматизации. Ключи ChatGPT, Qwen и DeepSeek хранятся только в этом браузере.",
            at: T + 1000,
          },
        ],
      },
      {
        id: "chat-fan",
        title: "Фанпей менеджер",
        pinned: false,
        updated: T + 20_000,
        messages: [
          { id: "m3", role: "user", content: "Собери короткий план запуска на неделю.", at: T },
          {
            id: "m4",
            role: "assistant",
            content: "День 1 — оффер. День 2 — первые диалоги. День 3 — разбор возражений. Дальше только то, что уже ответило.",
            at: T + 1000,
          },
        ],
      },
      {
        id: "chat-host",
        title: "Хостинг на ноутбуке",
        pinned: false,
        updated: T + 10_000,
        messages: [
          { id: "m5", role: "user", content: "Как не уронить локальный сервис ночью?", at: T },
          {
            id: "m6",
            role: "assistant",
            content: "Держи один процесс, лог на диск и перезапуск по расписанию. Не открывай порт в сеть без нужды.",
            at: T + 1000,
          },
        ],
      },
    ],
    library: [
      {
        id: "proj-untitled",
        kind: "project",
        title: "untitled",
        at: T,
        text: "Пустой проект. Можно сменить значок, цвет и поделиться ссылкой.",
        icon: "circle",
        color: "#f4f4f5",
      },
      {
        id: "file-note",
        kind: "file",
        title: "Заметка",
        at: T - 1000,
        text: "Сюда складываются резюме, ресёрч, переводы и бэкапы чатов.",
        icon: "square",
        color: "#a1a1aa",
      },
    ],
    automations: [
      auto({
        id: "a-morning",
        name: "Утренняя сводка",
        blurb: "Новости, погода и задачи одним сообщением.",
        preset: "morning",
        schedule: "daily",
        topics: "технологии",
        language: "ru",
        city: "Москва",
      }),
      auto({
        id: "a-watch",
        name: "Слежка за темой",
        blurb: "Пинг, если по ключу или странице появилось новое.",
        preset: "watch",
        schedule: "hourly",
        trigger: "keyword",
        keyword: "Grok",
        topics: "Grok",
      }),
      auto({
        id: "a-content",
        name: "Автогенерация контента",
        blurb: "Текст, картинка или озвучка по промпту.",
        preset: "content",
        prompt: "Короткий тёмный кадр: чёрный стол, один луч света, без текста",
        media: "text",
      }),
      auto({
        id: "a-summary",
        name: "Суммаризация",
        blurb: "Ссылка или файл становятся коротким резюме.",
        preset: "summary",
        trigger: "upload",
        deliver: "library",
      }),
      auto({
        id: "a-remind",
        name: "Напоминания",
        blurb: "Таймеры и повторы. Срабатывают, пока вкладка открыта.",
        preset: "remind",
        schedule: "event",
        trigger: "time",
        reminders: [],
      }),
      auto({
        id: "a-research",
        name: "Ресёрч по теме",
        blurb: "Отчёт ложится в раздел «Файлы».",
        preset: "research",
        topics: "локальные модели",
        deliver: "library",
      }),
      auto({
        id: "a-translate",
        name: "Перевод",
        blurb: "Переводит вставленный текст или последний файл.",
        preset: "translate",
        trigger: "upload",
        language: "en",
        deliver: "library",
      }),
      auto({
        id: "a-media",
        name: "Сбор медиа",
        blurb: "Картинки по теме попадают в «Медиа».",
        preset: "media",
        topics: "космос",
        deliver: "library",
      }),
      auto({
        id: "a-backup",
        name: "Бэкап чатов",
        blurb: "Снимок переписки в «Файлы».",
        preset: "backup",
        deliver: "library",
      }),
    ],
  };
}

const KEY = "grok-studio-v1";

function merge(raw: Partial<Data>): Data {
  const base = defaultData();
  return {
    ...base,
    ...raw,
    keys: { ...base.keys, ...(raw.keys ?? {}) },
    chats: raw.chats?.length ? raw.chats : base.chats,
    bots: raw.bots?.length ? raw.bots : base.bots,
    automations: raw.automations?.length ? raw.automations.map((a) => ({ ...auto(a), ...a })) : base.automations,
    library: raw.library ?? base.library,
    skills: raw.skills ?? [],
    recent: raw.recent ?? [],
    sources: raw.sources ?? [],
    botChat: raw.botChat ?? [],
  };
}

interface Store {
  data: Data;
  hydrated: boolean;
  mutate: (fn: (d: Data) => void) => void;
  hydrate: () => void;
}

export const useStudio = create<Store>((set, get) => ({
  data: defaultData(),
  hydrated: false,
  mutate: (fn) => {
    const next = structuredClone(get().data);
    fn(next);
    set({ data: next });
  },
  hydrate: () => {
    if (typeof localStorage === "undefined") {
      set({ hydrated: true });
      return;
    }
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) set({ data: merge(JSON.parse(raw) as Partial<Data>), hydrated: true });
      else set({ hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
}));

export function persistStudio(data: Data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    const slim: Data = {
      ...data,
      library: data.library.map((item) =>
        item.url && item.url.length > 180_000 ? { ...item, url: undefined, text: item.text ?? "Медиа слишком большое для локального сохранения." } : item,
      ),
      recent: data.recent.map((f) => (f.url && f.url.length > 120_000 ? { ...f, url: undefined } : f)),
      bots: data.bots.map((b) => (b.avatar && b.avatar.length > 180_000 ? { ...b, avatar: undefined } : b)),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(slim));
    } catch {
      /* quota */
    }
  }
}

export function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
