import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  ArrowUp,
  AudioLines,
  Brush,
  Camera,
  Check,
  ChevronDown,
  CircleUser,
  Copy,
  ExternalLink,
  Filter,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Mic,
  MicOff,
  PanelLeft,
  Paperclip,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Square,
  Trash2,
  Upload,
  Video,
  Volume2,
  WandSparkles,
  X,
} from "lucide-react";
import { DeepSeekMark, GrokMark, OpenAIMark, QwenMark } from "@/components/brand-icons";
import { completeChat, fetchPageText, generateImage, pollVideo, speakText, startVideo } from "@/lib/ai.functions";
import { requestStop, runAutomation, tickAutomations } from "@/lib/run-automation";
import {
  type Aspect,
  type Automation,
  type Bot,
  type Chat,
  type Data,
  type GenKind,
  type LibItem,
  type LibTab,
  type ModeId,
  type ModelId,
  type Msg,
  type Quality,
  persistStudio,
  uid,
  useStudio,
} from "@/lib/studio-store";

type View = "chat" | "bot" | "library" | "canvas";
type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const MODELS: { id: ModelId; label: string; hint: string }[] = [
  { id: "grok", label: "Grok", hint: "Отвечает сразу" },
  { id: "chatgpt", label: "ChatGPT", hint: "OpenAI, нужен ключ" },
  { id: "qwen", label: "Qwen", hint: "DashScope, нужен ключ" },
  { id: "deepseek", label: "DeepSeek", hint: "Нужен ключ" },
];

const ASPECTS: Aspect[] = ["2:3", "1:2", "1:1", "9:16", "16:9"];
const QUALITIES: Quality[] = ["480", "720", "1080"];

function ModelGlyph({ id, className }: { id: ModelId; className?: string }) {
  if (id === "chatgpt") return <OpenAIMark className={className} />;
  if (id === "qwen") return <QwenMark className={className} />;
  if (id === "deepseek") return <DeepSeekMark className={className} />;
  return <GrokMark className={className} />;
}

function AvatarFace({ bot, className }: { bot: Bot; className?: string }) {
  const motion = bot.animation === "spin" ? "spin-slow" : bot.animation === "pulse" ? "pulse-soft" : "";
  const shape = bot.shape === "square" ? "rounded-lg" : bot.shape === "hex" ? "hex-clip" : "rounded-full";
  const ring = bot.shape === "ring";
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${shape} ${motion} ${className ?? "size-10"}`}
      style={{
        background: ring ? "transparent" : bot.color,
        color: "#0a0a0b",
        boxShadow: ring ? `inset 0 0 0 2px ${bot.color}` : undefined,
      }}
    >
      {bot.avatar ? <img src={bot.avatar} alt="" className="size-full object-cover" /> : <GrokMark className="size-1/2" />}
    </span>
  );
}

function Rich({ text }: { text: string }) {
  const chunks: { kind: "text" | "code"; value: string }[] = [];
  const re = /```[\w-]*\n?([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) chunks.push({ kind: "text", value: text.slice(last, match.index) });
    chunks.push({ kind: "code", value: match[1] ?? "" });
    last = match.index + match[0].length;
  }
  if (last < text.length) chunks.push({ kind: "text", value: text.slice(last) });
  return (
    <div className="space-y-3">
      {chunks.map((chunk, i) =>
        chunk.kind === "code" ? (
          <pre key={i} className="overflow-x-auto rounded-lg bg-bg p-3 font-mono text-sm leading-relaxed text-fg">
            <code>{chunk.value.replace(/\n$/, "")}</code>
          </pre>
        ) : (
          <p key={i} className="whitespace-pre-wrap leading-relaxed">
            {chunk.value}
          </p>
        ),
      )}
    </div>
  );
}

function stamp(n: number) {
  const d = new Date(n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function fileToRecent(file: File) {
  const mime = file.type || "application/octet-stream";
  if (mime.startsWith("image/")) {
    const url = await compressImage(file, 1280, 0.72);
    return { name: file.name, mime, url, at: Date.now() };
  }
  if (mime.startsWith("text/") || /\.(md|txt|json|csv|js|ts|py|html|css)$/i.test(file.name)) {
    const text = (await file.text()).slice(0, 20_000);
    return { name: file.name, mime, text, at: Date.now() };
  }
  return { name: file.name, mime, text: `Файл ${file.name} (${Math.ceil(file.size / 1024)} КБ)`, at: Date.now() };
}

function compressImage(file: File, max: number, quality: number) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("файл"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("canvas"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("image"));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function downloadCanvas(canvas: HTMLCanvasElement, name: string) {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = name;
  a.click();
  return a.href;
}

function shotOf(title: string, lines: { role: string; content: string }[]) {
  const width = 880;
  const pad = 36;
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return null;
  measure.font = "16px Outfit, Segoe UI, sans-serif";
  const rows: string[] = [];
  for (const line of lines) {
    const words = `${line.role === "user" ? "Вы" : "Grok"}: ${line.content.replace(/\s+/g, " ")}`.split(" ");
    let cur = "";
    for (const word of words) {
      const trial = cur ? `${cur} ${word}` : word;
      if (measure.measureText(trial).width > width - pad * 2) {
        rows.push(cur);
        cur = word;
      } else cur = trial;
    }
    if (cur) rows.push(cur);
    rows.push("");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.max(220, 96 + rows.length * 26);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#0a0a0b";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f4f4f5";
  ctx.font = "600 22px Outfit, Segoe UI, sans-serif";
  ctx.fillText(title, pad, 44);
  ctx.font = "16px Outfit, Segoe UI, sans-serif";
  rows.forEach((row, i) => {
    ctx.fillStyle = row.startsWith("Вы:") ? "#f4f4f5" : "#a1a1aa";
    ctx.fillText(row, pad, 86 + i * 26);
  });
  return canvas;
}

function openChatTab(chat: Chat) {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&", "<": "<", ">": ">" })[c] ?? c);
  const body = chat.messages
    .map((m) => `<h2>${m.role === "user" ? "Вы" : "Grok"}</h2><pre style="white-space:pre-wrap;font:16px Segoe UI,sans-serif">${esc(m.content)}</pre>`)
    .join("");
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(chat.title)}</title><body style="margin:0;background:#0a0a0b;color:#f4f4f5;font-family:Segoe UI,sans-serif"><main style="max-width:720px;margin:auto;padding:32px"><h1>${esc(chat.title)}</h1>${body}</main></body>`;
  window.open(URL.createObjectURL(new Blob([html], { type: "text/html" })), "_blank", "noopener");
}

export function Studio() {
  const data = useStudio((s) => s.data);
  const hydrated = useStudio((s) => s.hydrated);
  const mutate = useStudio((s) => s.mutate);
  const [view, setView] = useState<View>("chat");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [query, setQuery] = useState("");
  const [profile, setProfile] = useState(false);
  const [banner, setBanner] = useState("");
  const [libTab, setLibTab] = useState<LibTab>("all");
  const [libQuery, setLibQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  const [canvasId, setCanvasId] = useState("proj-untitled");

  useEffect(() => {
    useStudio.getState().hydrate();
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    persistStudio(data);
  }, [data, hydrated]);

  useEffect(() => {
    const id = window.setInterval(() => tickAutomations(), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const hash = location.hash;
    if (!hash.startsWith("#p=")) return;
    try {
      const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(hash.slice(3)), (c) => c.charCodeAt(0)))) as { t?: string; c?: string; i?: LibItem["icon"]; x?: string };
      mutate((d) => {
        d.library.unshift({
          id: uid("proj"),
          kind: "project",
          title: json.t || "untitled",
          at: Date.now(),
          text: json.x || "",
          icon: json.i || "circle",
          color: json.c || "#f4f4f5",
        });
      });
      setView("library");
      setLibTab("projects");
      setBanner("Проект добавлен по ссылке");
      history.replaceState(null, "", location.pathname);
    } catch {
      setBanner("Ссылка проекта не читается");
    }
    // import once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  const active = data.chats.find((c) => c.id === data.activeChatId) ?? data.chats[0];
  const bot = data.bots.find((b) => b.id === data.activeBotId) ?? data.bots[0];

  function toast(text: string) {
    setBanner(text);
    window.setTimeout(() => setBanner(""), 3200);
  }

  function selectChat(id: string) {
    mutate((d) => {
      d.activeChatId = id;
    });
    setView("chat");
    setMobileNav(false);
  }

  function newChat() {
    const id = uid("chat");
    mutate((d) => {
      d.chats.unshift({ id, title: "Новый чат", pinned: false, updated: Date.now(), draft: true, messages: [] });
      d.activeChatId = id;
    });
    setView("chat");
    setMobileNav(false);
  }

  function newCanvas() {
    const id = uid("proj");
    mutate((d) => {
      d.library.unshift({
        id,
        kind: "project",
        title: "untitled",
        at: Date.now(),
        text: "",
        icon: "circle",
        color: "#f4f4f5",
      });
    });
    setCanvasId(id);
    setView("canvas");
    setMobileNav(false);
  }

  const shownChats = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = data.chats.filter((c) => c.messages.length > 0);
    if (q) {
      list = list.filter(
        (c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)),
      );
    }
    list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);
    if (!data.showAllChats && !q) list = list.slice(0, 2);
    return list;
  }, [data.chats, data.showAllChats, query]);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      {mobileNav ? (
        <button className="fixed inset-0 z-30 bg-bg/80 md:hidden" aria-label="Закрыть меню" onClick={() => setMobileNav(false)} />
      ) : null}
      <aside
        className={`z-40 flex shrink-0 flex-col border-r border-line bg-bg transition-[width,transform] duration-200 ${
          collapsed ? "w-16" : "w-72"
        } ${mobileNav ? "fixed inset-y-0 left-0 flex" : "hidden md:flex"}`}
      >
        <div className="flex items-center gap-2 px-3 py-4">
          <GrokMark className="size-7" />
          {collapsed ? null : <span className="text-lg font-semibold tracking-tight">Grok</span>}
          <button
            className="ml-auto hidden size-9 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-fg md:inline-flex"
            onClick={() => setCollapsed((v) => !v)}
            aria-label="Свернуть меню"
          >
            <PanelLeft className="size-4" />
          </button>
        </div>
        <div className="flex flex-col gap-2 px-3">
          <button className="flex h-11 items-center justify-center gap-2 rounded-xl bg-fg px-3 text-sm font-medium text-bg" onClick={newChat}>
            <Plus className="size-4" />
            {collapsed ? null : "Новый чат"}
          </button>
          <button className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm text-fg hover:bg-subtle" onClick={newCanvas}>
            <Brush className="size-4" />
            {collapsed ? null : "Новый холст"}
          </button>
        </div>
        {collapsed ? null : (
          <label className="mx-3 mt-3 flex h-11 items-center gap-2 rounded-xl border border-line px-3 text-muted">
            <Search className="size-4 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по чатам"
              className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-faint"
            />
          </label>
        )}
        <div className="mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto px-2 pb-4">
          <section>
            <p className={`px-2 pb-2 text-xs font-medium text-faint ${collapsed ? "sr-only" : ""}`}>AI-Grok-Bot</p>
            <button
              className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-subtle ${view === "bot" ? "bg-subtle" : ""}`}
              onClick={() => {
                setView("bot");
                setMobileNav(false);
              }}
            >
              <AvatarFace bot={bot} className="size-8" />
              {collapsed ? null : <span className="truncate">{bot.name}</span>}
            </button>
          </section>
          <section>
            <div className="flex items-center px-2 pb-1">
              <p className={`text-xs font-medium text-faint ${collapsed ? "sr-only" : ""}`}>Чаты</p>
              {collapsed ? null : (
                <button
                  className="ml-auto inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-fg"
                  aria-label="Скриншот списка чатов"
                  onClick={() => {
                    const canvas = shotOf(
                      "Чаты",
                      data.chats.filter((c) => c.messages.length).map((c) => ({ role: "user", content: c.title })),
                    );
                    if (!canvas) return;
                    const url = downloadCanvas(canvas, "grok-chats.png");
                    mutate((d) => {
                      d.library.unshift({
                        id: uid("lib"),
                        kind: "media",
                        mediaType: "image",
                        title: "Скрин списка чатов",
                        at: Date.now(),
                        url,
                        icon: "square",
                        color: "#f4f4f5",
                      });
                    });
                    toast("Скрин списка сохранён в медиа");
                  }}
                >
                  <Camera className="size-4" />
                </button>
              )}
            </div>
            {shownChats.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                collapsed={collapsed}
                active={chat.id === data.activeChatId && view === "chat"}
                onOpen={() => selectChat(chat.id)}
                onToast={toast}
              />
            ))}
            {collapsed ? null : (
              <button
                className="mt-1 w-full rounded-lg px-2 py-2 text-left text-sm text-muted hover:bg-subtle hover:text-fg"
                onClick={() =>
                  mutate((d) => {
                    d.showAllChats = !d.showAllChats;
                  })
                }
              >
                {data.showAllChats ? "Свернуть чаты" : "Показать все чаты"}
              </button>
            )}
          </section>
          <section>
            <p className={`px-2 pb-2 text-xs font-medium text-faint ${collapsed ? "sr-only" : ""}`}>Библиотека</p>
            {(
              [
                ["all", "Всё"],
                ["media", "Медиа"],
                ["projects", "Проекты"],
                ["apps", "Приложения"],
                ["files", "Файлы"],
                ["automation", "Автоматизация"],
              ] as [LibTab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                className={`flex w-full items-center rounded-lg px-2 py-2 text-left text-sm hover:bg-subtle ${view === "library" && libTab === id ? "bg-subtle" : ""}`}
                onClick={() => {
                  setLibTab(id);
                  setView("library");
                  setMobileNav(false);
                }}
              >
                {collapsed ? label.slice(0, 1) : label}
              </button>
            ))}
          </section>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 px-3 md:px-5">
          <button className="inline-flex size-11 items-center justify-center rounded-xl border border-line md:hidden" onClick={() => setMobileNav(true)} aria-label="Меню">
            <PanelLeft className="size-4" />
          </button>
          <div className="min-w-0 flex-1 truncate text-sm text-muted">
            {view === "chat" ? active?.title : view === "bot" ? bot.name : view === "canvas" ? "Холст" : "Библиотека"}
          </div>
          <button
            className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-elevated text-fg"
            onClick={() => setProfile(true)}
            aria-label="Профиль и настройки"
          >
            <CircleUser className="size-5" />
          </button>
        </header>

        {view === "library" ? (
          <Library
            tab={libTab}
            setTab={setLibTab}
            query={libQuery}
            setQuery={setLibQuery}
            onToast={toast}
            mounted={mounted}
          />
        ) : view === "canvas" ? (
          <CanvasBoard projectId={canvasId} onToast={toast} />
        ) : view === "bot" ? (
          <BotStudio onToast={toast} />
        ) : (
          <ChatStage chat={active} onToast={toast} />
        )}
      </div>

      {profile ? <ProfileSheet onClose={() => setProfile(false)} onToast={toast} /> : null}
      {banner ? (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-line bg-elevated px-4 py-2 text-sm text-fg shadow-none">
          {banner}
        </div>
      ) : null}
    </div>
  );
}

function ChatRow({
  chat,
  collapsed,
  active,
  onOpen,
  onToast,
}: {
  chat: Chat;
  collapsed: boolean;
  active: boolean;
  onOpen: () => void;
  onToast: (s: string) => void;
}) {
  const mutate = useStudio((s) => s.mutate);
  const [menu, setMenu] = useState(false);
  const [rename, setRename] = useState(false);
  const [title, setTitle] = useState(chat.title);
  if (collapsed) {
    return (
      <button className={`flex w-full justify-center rounded-lg py-2 ${active ? "bg-subtle" : ""}`} onClick={onOpen} aria-label={chat.title}>
        <span className="text-xs text-muted">{chat.title.slice(0, 1)}</span>
      </button>
    );
  }
  return (
    <div className={`group relative rounded-xl ${active ? "bg-subtle" : "hover:bg-subtle"}`}>
      {rename ? (
        <form
          className="flex items-center gap-1 p-1"
          onSubmit={(e) => {
            e.preventDefault();
            mutate((d) => {
              const row = d.chats.find((c) => c.id === chat.id);
              if (row) row.title = title.trim() || "Без названия";
            });
            setRename(false);
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 w-full rounded-lg bg-bg px-2 text-sm outline-none" autoFocus />
          <button className="inline-flex size-9 items-center justify-center" aria-label="Сохранить"><Check className="size-4" /></button>
        </form>
      ) : (
        <button className="flex w-full items-center gap-2 px-2 py-2 text-left" onClick={onOpen}>
          {chat.pinned ? <Pin className="size-3.5 shrink-0 text-muted" /> : null}
          <span className="truncate text-sm">{chat.title}</span>
        </button>
      )}
      <button
        className="absolute top-1 right-1 hidden size-8 items-center justify-center rounded-lg text-muted group-hover:inline-flex"
        aria-label="Действия чата"
        onClick={() => setMenu((v) => !v)}
      >
        <ChevronDown className="size-4" />
      </button>
      {menu ? (
        <div className="absolute top-9 right-1 z-20 w-48 rounded-xl border border-line bg-elevated p-1 text-sm shadow-none">
          <MenuBtn
            icon={<Pin className="size-4" />}
            label={chat.pinned ? "Открепить" : "Закрепить"}
            onClick={() => {
              mutate((d) => {
                const row = d.chats.find((c) => c.id === chat.id);
                if (row) row.pinned = !row.pinned;
              });
              setMenu(false);
            }}
          />
          <MenuBtn icon={<ExternalLink className="size-4" />} label="Открыть в новой вкладке" onClick={() => { openChatTab(chat); setMenu(false); }} />
          <MenuBtn icon={<Pencil className="size-4" />} label="Переименовать" onClick={() => { setRename(true); setMenu(false); }} />
          <MenuBtn
            icon={<Camera className="size-4" />}
            label="Скриншот чата"
            onClick={() => {
              const canvas = shotOf(chat.title, chat.messages.map((m) => ({ role: m.role, content: m.content })));
              if (!canvas) return;
              const url = downloadCanvas(canvas, `${chat.title}.png`);
              mutate((d) => {
                d.library.unshift({
                  id: uid("lib"),
                  kind: "media",
                  mediaType: "image",
                  title: `Скрин: ${chat.title}`,
                  url,
                  at: Date.now(),
                  icon: "square",
                  color: "#f4f4f5",
                });
              });
              onToast("Скриншот в медиа и в загрузках");
              setMenu(false);
            }}
          />
          <MenuBtn
            icon={<Trash2 className="size-4" />}
            label="Удалить"
            danger
            onClick={() => {
              mutate((d) => {
                d.chats = d.chats.filter((c) => c.id !== chat.id);
                if (d.activeChatId === chat.id) d.activeChatId = d.chats[0]?.id ?? "";
              });
              setMenu(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function MenuBtn({ icon, label, onClick, danger }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-subtle ${danger ? "text-danger" : ""}`} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function ChatStage({ chat, onToast }: { chat: Chat | undefined; onToast: (s: string) => void }) {
  const data = useStudio((s) => s.data);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [chat?.messages.length]);
  if (!chat) return null;
  const empty = chat.messages.length === 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <div className="mx-auto flex w-full max-w-2xl flex-col px-4 pt-4 pb-8 md:pt-24">
            <h1 className="mb-6 text-center text-2xl font-semibold tracking-tight md:text-3xl">Что мы будем исследовать?</h1>
            <Composer target="chat" chatId={chat.id} onToast={onToast} centered />
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
            {chat.messages.map((m) => (
              <MessageBubble key={m.id} msg={m} onToast={onToast} />
            ))}
            <div ref={bottom} />
          </div>
        )}
      </div>
      {empty ? null : (
        <div className="px-4 pb-4">
          <div className="mx-auto max-w-3xl">
            <Composer target="chat" chatId={chat.id} onToast={onToast} />
          </div>
        </div>
      )}
      <p className="sr-only">{data.profileName}</p>
    </div>
  );
}

function MessageBubble({ msg, onToast }: { msg: Msg; onToast: (s: string) => void }) {
  const [speaking, setSpeaking] = useState(false);
  return (
    <article className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[90%] rounded-3xl px-4 py-3 ${msg.role === "user" ? "bg-subtle" : "bg-transparent px-0"}`}>
        {msg.note ? <p className="mb-1 text-xs text-faint">{msg.note}</p> : null}
        <Rich text={msg.content} />
        {msg.images?.map((src) => (
          <img key={src.slice(0, 48)} src={src} alt="" className="mt-3 max-h-80 rounded-xl border border-line object-contain" />
        ))}
        {msg.video ? <video src={msg.video} controls className="mt-3 max-h-80 w-full rounded-xl border border-line" /> : null}
        {msg.audio ? <audio src={msg.audio} controls className="mt-3 w-full" /> : null}
        {msg.role === "assistant" ? (
          <button
            className="mt-2 inline-flex items-center gap-1 text-xs text-faint hover:text-fg"
            onClick={async () => {
              setSpeaking(true);
              const res = await speakText({ data: { text: msg.content } });
              setSpeaking(false);
              if (!res.ok) {
                onToast(res.error);
                return;
              }
              new Audio(res.audio).play().catch(() => onToast("Браузер не дал проиграть звук"));
            }}
          >
            <Volume2 className="size-3.5" />
            {speaking ? "Готовлю голос" : "Озвучить"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function Composer({
  target,
  chatId,
  onToast,
  centered,
}: {
  target: "chat" | "bot";
  chatId?: string;
  onToast: (s: string) => void;
  centered?: boolean;
}) {
  const data = useStudio((s) => s.data);
  const mutate = useStudio((s) => s.mutate);
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [mode, setMode] = useState<ModeId>("fast");
  const [model, setModel] = useState<ModelId>(target === "bot" ? (data.bots.find((b) => b.id === data.activeBotId)?.model ?? "grok") : "grok");
  const [gen, setGen] = useState<GenKind>("chat");
  const [quality, setQuality] = useState<Quality>("720");
  const [aspect, setAspect] = useState<Aspect>("1:1");
  const [seconds, setSeconds] = useState<4 | 6>(6);
  const [modelOpen, setModelOpen] = useState(false);
  const [tool, setTool] = useState<"files" | "skills" | "sources" | "draw" | null>(null);
  const [extras, setExtras] = useState<{ name: string; text?: string }[]>([]);
  const [think, setThink] = useState("Сверяю контекст");
  const seq = useRef(0);
  const recRef = useRef<SpeechRec | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const skillRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy || !deep) return;
    const steps = ["Сверяю контекст", "Держу вопрос целиком", "Собираю ответ"];
    let i = 0;
    const id = window.setInterval(() => {
      i = (i + 1) % steps.length;
      setThink(steps[i] ?? steps[0]);
    }, 900);
    return () => window.clearInterval(id);
  }, [busy, deep]);

  function push(msg: Msg) {
    mutate((d) => {
      if (target === "bot") {
        d.botChat.push(msg);
        return;
      }
      const chat = d.chats.find((c) => c.id === chatId);
      if (!chat) return;
      chat.draft = false;
      chat.messages.push(msg);
      chat.updated = Date.now();
      if (chat.title === "Новый чат") chat.title = msg.role === "user" ? msg.content.slice(0, 42) : chat.title;
    });
  }

  async function onSend() {
    const raw = text.trim();
    if (!raw || busy) return;
    const my = seq.current;
    setText("");
    setInterim("");
    setBusy(true);
    const files = extras;
    setExtras([]);
    const user: Msg = { id: uid("u"), role: "user", content: raw, at: Date.now() };
    push(user);
    try {
      let extra = "";
      for (const src of data.sources.slice(0, 2)) {
        const page = await fetchPageText({ data: { url: src } });
        if (page.ok) extra += `\n\nИсточник ${page.title}:\n${page.text.slice(0, 1200)}`;
      }
      for (const file of files) {
        if (file.text) extra += `\n\nФайл ${file.name}:\n${file.text.slice(0, 2000)}`;
      }
      const skills = data.skills.map((s) => `# ${s.name}\n${s.text}`).join("\n").slice(0, 4000);
      const persona = target === "bot" ? (data.bots.find((b) => b.id === data.activeBotId)?.persona ?? "") : "";
      const history = (target === "bot" ? data.botChat : data.chats.find((c) => c.id === chatId)?.messages ?? [])
        .filter((m) => !m.fromAuto)
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: raw + extra });

      if (gen === "image" || gen === "video" || gen === "audio") {
        await makeMedia(raw, my);
      } else {
        const res = await completeChat({
          data: {
            messages: history,
            mode: gen === "agent" ? "build" : mode,
            model: target === "bot" ? (data.bots.find((b) => b.id === data.activeBotId)?.model ?? model) : model,
            deep: deep || mode === "expert" || mode === "council",
            skills,
            persona: gen === "agent" ? `${persona} Если нужен кадр, первой строкой напиши PROMPT: и короткий промпт.` : persona,
            keys: data.keys,
          },
        });
        if (seq.current !== my) return;
        if (!res.ok) {
          push({ id: uid("a"), role: "assistant", content: res.error, at: Date.now() });
        } else {
          const promptLine = res.text.match(/^PROMPT:\s*(.+)$/m)?.[1];
          const images: string[] = [];
          if (gen === "agent" && promptLine) {
            const img = await generateImage({ data: { prompt: promptLine, quality, aspect } });
            if (img.ok) images.push(img.url);
          }
          push({
            id: uid("a"),
            role: "assistant",
            content: res.text,
            at: Date.now(),
            images,
            note: res.note || res.via,
          });
          const html = res.text.match(/```html\n([\s\S]*?)```/i)?.[1];
          if (html && (mode === "build" || gen === "agent")) {
            mutate((d) => {
              d.library.unshift({
                id: uid("app"),
                kind: "app",
                title: raw.slice(0, 42) || "Приложение",
                at: Date.now(),
                text: html,
                icon: "diamond",
                color: "#f4f4f5",
              });
            });
            onToast("Приложение лежит в библиотеке");
          }
        }
      }
      if (target === "chat") {
        const fresh = useStudio.getState().data.automations;
        for (const auto of fresh) {
          if (!auto.enabled || auto.paused) continue;
          const blob = raw.toLowerCase();
          if (auto.trigger === "keyword" && auto.keyword && blob.includes(auto.keyword.toLowerCase())) void runAutomation(auto.id);
          if (auto.trigger === "command" && raw.trim().startsWith("/") && (blob.includes(auto.name.toLowerCase()) || (auto.keyword && blob.includes(auto.keyword.toLowerCase())))) {
            void runAutomation(auto.id);
          }
        }
      }
    } catch (err) {
      if (seq.current === my) push({ id: uid("a"), role: "assistant", content: err instanceof Error ? err.message : "Не вышло", at: Date.now() });
    } finally {
      if (seq.current === my) setBusy(false);
    }
  }

  async function makeMedia(prompt: string, my: number) {
    if (gen === "image") {
      const img = await generateImage({ data: { prompt, quality, aspect } });
      if (seq.current !== my) return;
      if (!img.ok) {
        push({ id: uid("a"), role: "assistant", content: img.error, at: Date.now() });
        return;
      }
      push({ id: uid("a"), role: "assistant", content: prompt, images: [img.url], at: Date.now(), note: `${quality} · ${aspect}` });
      mutate((d) => {
        d.library.unshift({ id: uid("lib"), kind: "media", mediaType: "image", title: prompt.slice(0, 48), url: img.url, at: Date.now(), icon: "diamond", color: "#f4f4f5" });
      });
      return;
    }
    if (gen === "audio") {
      const spoken = await speakText({ data: { text: prompt } });
      if (seq.current !== my) return;
      if (!spoken.ok) {
        push({ id: uid("a"), role: "assistant", content: spoken.error, at: Date.now() });
        return;
      }
      push({ id: uid("a"), role: "assistant", content: prompt, audio: spoken.audio, at: Date.now() });
      mutate((d) => {
        d.library.unshift({ id: uid("lib"), kind: "media", mediaType: "audio", title: "Аудио", url: spoken.audio, text: prompt, at: Date.now(), icon: "circle", color: "#f4f4f5" });
      });
      return;
    }
    const started = await startVideo({ data: { prompt, quality, aspect, seconds } });
    if (!started.ok) {
      push({ id: uid("a"), role: "assistant", content: started.error, at: Date.now() });
      return;
    }
    let url = started.url;
    if (!url && started.requestId) {
      for (let i = 0; i < 30; i++) {
        if (seq.current !== my) return;
        await new Promise((r) => setTimeout(r, 4000));
        const polled = await pollVideo({ data: { requestId: started.requestId } });
        if (polled.ok) {
          url = polled.url;
          break;
        }
        if (!polled.pending) {
          push({ id: uid("a"), role: "assistant", content: polled.error, at: Date.now() });
          return;
        }
      }
    }
    if (seq.current !== my) return;
    if (!url) {
      push({ id: uid("a"), role: "assistant", content: "Видео ещё собирается. Запустите ещё раз чуть позже.", at: Date.now() });
      return;
    }
    push({ id: uid("a"), role: "assistant", content: prompt, video: url, at: Date.now(), note: `${seconds} с · ${quality}` });
    mutate((d) => {
      d.library.unshift({ id: uid("lib"), kind: "media", mediaType: "video", title: prompt.slice(0, 48), url, at: Date.now(), icon: "diamond", color: "#f4f4f5" });
    });
  }

  function toggleMic() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      onToast("Нужен Chrome или Edge — там работает распознавание речи");
      return;
    }
    if (recRef.current) {
      recRef.current.stop();
      return;
    }
    const rec = new Ctor() as SpeechRec;
    rec.lang = "ru-RU";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (ev) => {
      let finalText = "";
      let live = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const row = ev.results[i];
        if (!row) continue;
        if (row.isFinal) finalText += row[0].transcript;
        else live += row[0].transcript;
      }
      if (finalText.trim()) setText((prev) => `${prev ? `${prev} ` : ""}${finalText.trim()}`);
      setInterim(live);
    };
    rec.onerror = (ev) => {
      setListening(false);
      recRef.current = null;
      onToast(ev.error === "not-allowed" ? "Нет доступа к микрофону" : `Микрофон: ${ev.error}`);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      setInterim("");
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  const placeholder =
    gen === "image" || gen === "video"
      ? "Введите запрос для создания"
      : gen === "audio"
        ? "Текст, который нужно озвучить"
        : target === "bot"
          ? "Сообщение боту"
          : "Спросите что угодно";

  return (
    <div className={`rounded-3xl border border-line bg-elevated p-3 ${centered ? "w-full" : ""}`}>
      {busy ? <p className="think-line mb-2 px-2 text-sm">{deep ? think : gen === "video" ? "Собираю видео" : "Собираю ответ"}</p> : null}
      {extras.length ? (
        <div className="mb-2 flex flex-wrap gap-2 px-1">
          {extras.map((file) => (
            <span key={file.name} className="rounded-full bg-bg px-3 py-1 text-xs text-muted">{file.name}</span>
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          value={interim ? `${text}${text ? " " : ""}${interim}` : text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
          rows={2}
          placeholder={placeholder}
          className="min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-base outline-none placeholder:text-faint"
        />
        <IconBtn label={listening ? "Остановить микрофон" : "Голосовой ввод"} onClick={toggleMic}>
          {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
        </IconBtn>
        {busy ? (
          <button className="mb-1 inline-flex h-10 items-center gap-1 rounded-full bg-subtle px-3 text-sm" onClick={() => { seq.current += 1; setBusy(false); }}>
            <Square className="size-3.5" /> Отменить
          </button>
        ) : (
          <button className="mb-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-fg text-bg disabled:opacity-40" disabled={!text.trim()} onClick={() => void onSend()} aria-label="Отправить">
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => void attach(e.target.files?.[0])} />
        <input ref={skillRef} type="file" accept=".md,.txt,.json" className="hidden" onChange={(e) => void skill(e.target.files?.[0])} />
        <IconBtn label="Прикрепить файл" onClick={() => fileRef.current?.click()}><Paperclip className="size-4" /></IconBtn>
        <IconBtn label="Недавние файлы" onClick={() => setTool(tool === "files" ? null : "files")}><List className="size-4" /></IconBtn>
        <IconBtn label="Загрузить навык" onClick={() => skillRef.current?.click()}><Upload className="size-4" /></IconBtn>
        <IconBtn label="Нарисовать" onClick={() => setTool(tool === "draw" ? null : "draw")}><Brush className="size-4" /></IconBtn>
        <IconBtn label="Источники" onClick={() => setTool(tool === "sources" ? null : "sources")}><Search className="size-4" /></IconBtn>
        <div className="relative">
          <button className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-3 text-sm" onClick={() => setModelOpen((v) => !v)}>
            <ModelGlyph id={model} className="size-4" />
            {MODELS.find((m) => m.id === model)?.label}
            <ChevronDown className="size-4 text-muted" />
          </button>
          {modelOpen ? (
            <div className="absolute bottom-12 left-0 z-30 w-60 rounded-xl border border-line bg-elevated p-1">
              {MODELS.map((item) => (
                <button
                  key={item.id}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-subtle"
                  onClick={() => {
                    setModel(item.id);
                    setModelOpen(false);
                    if (target === "bot") {
                      mutate((d) => {
                        const b = d.bots.find((x) => x.id === d.activeBotId);
                        if (b) b.model = item.id;
                      });
                    }
                  }}
                >
                  <ModelGlyph id={item.id} className="size-5" />
                  <span>
                    <span className="block text-sm">{item.label}</span>
                    <span className="block text-xs text-faint">{item.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {(["chat", "image", "video", "audio", "agent"] as GenKind[]).map((id) => (
          <Chip key={id} on={gen === id} onClick={() => setGen(id)}>
            {id === "chat" ? "Чат" : id === "image" ? "Изображение" : id === "video" ? "Видео" : id === "audio" ? "Аудио" : "Агент"}
          </Chip>
        ))}
        {(["fast", "expert", "build", "council"] as ModeId[]).map((id) => (
          <Chip key={id} on={mode === id} onClick={() => setMode(id)}>
            {id === "fast" ? "Быстрый" : id === "expert" ? "Эксперт" : id === "build" ? "Билд" : "Группа"}
          </Chip>
        ))}
        <Chip on={deep} onClick={() => setDeep((v) => !v)}>
          <WandSparkles className="size-3.5" /> Глубже
        </Chip>
        {gen === "image" || gen === "video" ? (
          <>
            {QUALITIES.map((q) => (
              <Chip key={q} on={quality === q} onClick={() => setQuality(q)}>{q}</Chip>
            ))}
            {ASPECTS.map((a) => (
              <Chip key={a} on={aspect === a} onClick={() => setAspect(a)}>{a}</Chip>
            ))}
          </>
        ) : null}
        {gen === "video" ? (
          <>
            <Chip on={seconds === 4} onClick={() => setSeconds(4)}>4 с</Chip>
            <Chip on={seconds === 6} onClick={() => setSeconds(6)}>6 с</Chip>
          </>
        ) : null}
      </div>
      {tool === "files" ? (
        <div className="mt-3 rounded-xl bg-bg p-3 text-sm">
          <p className="mb-2 text-xs text-faint">Недавние файлы</p>
          {data.recent.length === 0 ? <p className="text-muted">Пока пусто. Прикрепите файл.</p> : null}
          {data.recent.map((f) => (
            <p key={f.id} className="truncate py-1">{f.name}</p>
          ))}
        </div>
      ) : null}
      {tool === "sources" ? <Sources /> : null}
      {tool === "draw" ? <DrawPad onToast={onToast} onClose={() => setTool(null)} /> : null}
      {data.skills.length ? <p className="mt-2 px-1 text-xs text-faint">Навыки: {data.skills.map((s) => s.name).join(", ")}</p> : null}
    </div>
  );

  async function attach(file?: File) {
    if (!file) return;
    try {
      const item = await fileToRecent(file);
      mutate((d) => {
        d.recent.unshift({ id: uid("file"), ...item });
        d.recent = d.recent.slice(0, 8);
        if (item.url && item.mime.startsWith("image/")) {
          d.library.unshift({ id: uid("lib"), kind: "media", mediaType: "image", title: item.name, url: item.url, at: Date.now(), icon: "square", color: "#f4f4f5" });
        } else if (item.text) {
          d.library.unshift({ id: uid("lib"), kind: "file", title: item.name, text: item.text, at: Date.now(), icon: "square", color: "#a1a1aa" });
        }
      });
      if (item.text) setExtras((prev) => [...prev, { name: item.name, text: item.text }].slice(-3));
      onToast(`${file.name} в недавних`);
      const autos = useStudio.getState().data.automations.filter((a) => a.enabled && !a.paused && a.trigger === "upload");
      for (const auto of autos) {
        if (auto.preset === "summary" || auto.preset === "translate") {
          mutate((d) => {
            const row = d.automations.find((x) => x.id === auto.id);
            if (row && item.text) row.prompt = item.text.slice(0, 4000);
          });
        }
        void runAutomation(auto.id);
      }
    } catch {
      onToast("Не удалось прочитать файл");
    }
  }

  async function skill(file?: File) {
    if (!file) return;
    const body = (await file.text()).slice(0, 8000);
    mutate((d) => {
      d.skills.push({ id: uid("skill"), name: file.name, text: body });
    });
    onToast("Навык подключён к запросам");
  }
}

function IconBtn({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className="inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-subtle hover:text-fg" aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

function Chip({ children, on, onClick }: { children: ReactNode; on: boolean; onClick: () => void }) {
  return (
    <button
      className={`inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm ${on ? "bg-fg text-bg" : "bg-subtle text-fg"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Sources() {
  const sources = useStudio((s) => s.data.sources);
  const mutate = useStudio((s) => s.mutate);
  const [url, setUrl] = useState("");
  return (
    <form
      className="mt-3 rounded-xl bg-bg p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!url.trim()) return;
        mutate((d) => {
          d.sources = [...d.sources, url.trim()].slice(-4);
        });
        setUrl("");
      }}
    >
      <p className="mb-2 text-xs text-faint">Источники попадут в следующий запрос</p>
      <div className="flex gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className="h-10 flex-1 rounded-lg border border-line bg-transparent px-3 text-sm outline-none" />
        <button className="h-10 rounded-lg bg-fg px-3 text-sm text-bg">Добавить</button>
      </div>
      {sources.map((src) => (
        <div key={src} className="mt-2 flex items-center gap-2 text-sm">
          <span className="truncate">{src}</span>
          <button className="text-faint" onClick={() => mutate((d) => { d.sources = d.sources.filter((s) => s !== src); })} aria-label="Убрать источник"><X className="size-4" /></button>
        </div>
      ))}
    </form>
  );
}

function DrawPad({ onToast, onClose }: { onToast: (s: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const mutate = useStudio((s) => s.mutate);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0a0a0b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#f4f4f5";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
  }, []);
  function pos(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = ref.current!;
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
  }
  return (
    <div className="mt-3 rounded-xl bg-bg p-3">
      <canvas
        ref={ref}
        width={640}
        height={360}
        className="h-48 w-full touch-none rounded-lg border border-line"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = ref.current?.getContext("2d");
          const p = pos(e);
          ctx?.beginPath();
          ctx?.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current?.getContext("2d");
          const p = pos(e);
          ctx?.lineTo(p.x, p.y);
          ctx?.stroke();
        }}
        onPointerUp={() => { drawing.current = false; }}
      />
      <div className="mt-2 flex gap-2">
        <button
          className="h-10 rounded-lg bg-fg px-3 text-sm text-bg"
          onClick={() => {
            const canvas = ref.current;
            if (!canvas) return;
            const url = canvas.toDataURL("image/png");
            mutate((d) => {
              d.library.unshift({ id: uid("lib"), kind: "media", mediaType: "image", title: "Рисунок", url, at: Date.now(), icon: "circle", color: "#f4f4f5" });
            });
            onToast("Рисунок в медиа");
            onClose();
          }}
        >
          Сохранить в медиа
        </button>
        <button className="h-10 rounded-lg px-3 text-sm text-muted" onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}

function BotStudio({ onToast }: { onToast: (s: string) => void }) {
  const data = useStudio((s) => s.data);
  const mutate = useStudio((s) => s.mutate);
  const bot = data.bots.find((b) => b.id === data.activeBotId) ?? data.bots[0];
  const fileRef = useRef<HTMLInputElement>(null);
  if (!bot) return null;
  function edit(fn: (b: Bot) => void) {
    mutate((d) => {
      const row = d.bots.find((b) => b.id === d.activeBotId);
      if (row) fn(row);
    });
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <section className="w-full shrink-0 space-y-4 overflow-y-auto border-line px-4 pb-4 lg:w-80 lg:border-r lg:px-5">
        <div className="flex items-center gap-3">
          <AvatarFace bot={bot} className="size-16" />
          <div>
            <h2 className="text-lg font-semibold">AI-Grok-Bot</h2>
            <p className="text-sm text-muted">Конструктор и живой чат</p>
          </div>
        </div>
        <label className="block text-sm text-muted">
          Имя
          <input value={bot.name} onChange={(e) => edit((b) => { b.name = e.target.value; })} className="mt-1 h-11 w-full rounded-xl border border-line bg-elevated px-3 text-fg outline-none" />
        </label>
        <div className="flex flex-wrap gap-2">
          {data.bots.map((item) => (
            <Chip key={item.id} on={item.id === bot.id} onClick={() => mutate((d) => { d.activeBotId = item.id; })}>{item.name}</Chip>
          ))}
          <Chip
            on={false}
            onClick={() => {
              const id = uid("bot");
              mutate((d) => {
                d.bots.push({ id, name: "Новый бот", color: "#e4e4e7", shape: "orb", animation: "pulse", model: "grok", persona: "Ты спокойный напарник." });
                d.activeBotId = id;
              });
            }}
          >
            Сменить / новый
          </Chip>
        </div>
        <p className="text-xs text-faint">Цвет</p>
        <div className="flex gap-2">
          {["#f4f4f5", "#d4d4d8", "#a1a1aa", "#e4e4e7", "#fca5a5", "#86efac"].map((color) => (
            <button key={color} aria-label={color} className="size-9 rounded-full border border-line" style={{ background: color }} onClick={() => edit((b) => { b.color = color; })} />
          ))}
        </div>
        <p className="text-xs text-faint">Форма</p>
        <div className="flex flex-wrap gap-2">
          {(["orb", "square", "hex", "ring"] as Bot["shape"][]).map((shape) => (
            <Chip key={shape} on={bot.shape === shape} onClick={() => edit((b) => { b.shape = shape; })}>
              {shape === "orb" ? "Круг" : shape === "square" ? "Квадрат" : shape === "hex" ? "Шестигранник" : "Кольцо"}
            </Chip>
          ))}
        </div>
        <p className="text-xs text-faint">Анимация</p>
        <div className="flex flex-wrap gap-2">
          {(["none", "spin", "pulse"] as Bot["animation"][]).map((animation) => (
            <Chip key={animation} on={bot.animation === animation} onClick={() => edit((b) => { b.animation = animation; })}>
              {animation === "none" ? "Нет" : animation === "spin" ? "Вращение" : "Пульсация"}
            </Chip>
          ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const url = await compressImage(file, 256, 0.8);
              edit((b) => { b.avatar = url; });
            } catch {
              onToast("Аватар не прочитался");
            }
          }}
        />
        <button className="h-11 rounded-xl border border-line px-3 text-sm" onClick={() => fileRef.current?.click()}>Загрузить аватар</button>
        <label className="block text-sm text-muted">
          Роль игрока-помощника
          <textarea value={bot.persona} onChange={(e) => edit((b) => { b.persona = e.target.value; })} rows={4} className="mt-1 w-full rounded-xl border border-line bg-elevated p-3 text-fg outline-none" />
        </label>
      </section>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {data.botChat.length === 0 ? <p className="text-muted">Напишите боту — он ответит в этом же окне.</p> : null}
          {data.botChat.map((m) => <MessageBubble key={m.id} msg={m} onToast={onToast} />)}
        </div>
        <div className="px-4 pb-4">
          <Composer target="bot" onToast={onToast} />
        </div>
      </div>
    </div>
  );
}

function Library({
  tab,
  setTab,
  query,
  setQuery,
  onToast,
  mounted,
}: {
  tab: LibTab;
  setTab: (t: LibTab) => void;
  query: string;
  setQuery: (s: string) => void;
  onToast: (s: string) => void;
  mounted: boolean;
}) {
  const data = useStudio((s) => s.data);
  const mutate = useStudio((s) => s.mutate);
  const [settings, setSettings] = useState(false);
  const [runs, setRuns] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState<LibItem | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = data.library.filter((item) => {
      if (tab === "media") return item.kind === "media";
      if (tab === "projects") return item.kind === "project";
      if (tab === "apps") return item.kind === "app";
      if (tab === "files") return item.kind === "file";
      if (tab === "automation") return false;
      return true;
    });
    if (data.libOnly === "untitled") list = list.filter((i) => i.title.toLowerCase() === "untitled" || !i.title.trim());
    else if (data.libOnly !== "all" && tab === "all") list = list.filter((i) => i.kind === (data.libOnly === "media" ? "media" : data.libOnly === "projects" ? "project" : data.libOnly === "apps" ? "app" : "file"));
    if (q) list = list.filter((i) => `${i.title} ${i.text ?? ""}`.toLowerCase().includes(q));
    list = [...list].sort((a, b) => {
      if (data.libSort === "name") return a.title.localeCompare(b.title, "ru");
      if (data.libSort === "oldest") return a.at - b.at;
      return b.at - a.at;
    });
    return list;
  }, [data.library, data.libOnly, data.libSort, query, tab]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 md:px-6">
      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["all", "Всё"],
            ["media", "Медиа"],
            ["projects", "Проекты"],
            ["apps", "Приложения"],
            ["files", "Файлы"],
            ["automation", "Автоматизация"],
          ] as [LibTab, string][]
        ).map(([id, label]) => (
          <Chip key={id} on={tab === id} onClick={() => setTab(id)}>{label}</Chip>
        ))}
      </div>
      {tab !== "automation" ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="flex h-11 min-w-48 flex-1 items-center gap-2 rounded-xl border border-line px-3">
              <Search className="size-4 text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск" className="w-full bg-transparent text-sm outline-none" />
            </label>
            <IconBtn label="Настройки вида" onClick={() => setSettings((v) => !v)}><Settings2 className="size-4" /></IconBtn>
            <IconBtn label="Сетка" onClick={() => mutate((d) => { d.libView = "grid"; })}><LayoutGrid className="size-4" /></IconBtn>
            <IconBtn label="Список" onClick={() => mutate((d) => { d.libView = "list"; })}><List className="size-4" /></IconBtn>
            <IconBtn label="Сортировка" onClick={() => mutate((d) => { d.libSort = d.libSort === "newest" ? "oldest" : d.libSort === "oldest" ? "name" : "newest"; })}><Filter className="size-4" /></IconBtn>
            <button className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-3 text-sm" onClick={() => uploadRef.current?.click()}>
              <Upload className="size-4" /> Загрузить
            </button>
            <input
              ref={uploadRef}
              type="file"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const item = await fileToRecent(file);
                mutate((d) => {
                  d.library.unshift({
                    id: uid("lib"),
                    kind: item.mime.startsWith("image/") ? "media" : "file",
                    mediaType: item.mime.startsWith("image/") ? "image" : undefined,
                    title: item.name,
                    url: item.url,
                    text: item.text,
                    at: Date.now(),
                    icon: "square",
                    color: "#f4f4f5",
                  });
                  d.recent.unshift({ id: uid("file"), ...item });
                });
                onToast("Файл в библиотеке");
              }}
            />
          </div>
          {settings ? (
            <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-line p-3">
              <span className="w-full text-xs text-faint">Порядок: {data.libSort === "newest" ? "новейшие" : data.libSort === "oldest" ? "старые" : "по имени"}</span>
              {(["all", "media", "projects", "apps", "files", "untitled"] as Data["libOnly"][]).map((id) => (
                <Chip key={id} on={data.libOnly === id} onClick={() => mutate((d) => { d.libOnly = id; })}>
                  {id === "all" ? "Показать всё" : id === "untitled" ? "Только untitled" : id === "media" ? "Только медиа" : id === "projects" ? "Только проекты" : id === "apps" ? "Только приложения" : "Только файлы"}
                </Chip>
              ))}
            </div>
          ) : null}
          {items.length === 0 ? <p className="text-muted">В этом разделе пока пусто.</p> : null}
          <div className={data.libView === "grid" ? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-2"}>
            {items.map((item) => (
              <article key={item.id} className="rounded-3xl border border-line bg-elevated p-4">
                <div className="flex items-start gap-3">
                  <MarkIcon item={item} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium">{item.title || "untitled"}</h3>
                    <p className="text-xs text-faint">{mounted ? stamp(item.at) : ""} · {item.kind === "media" ? "медиа" : item.kind === "project" ? "проект" : item.kind === "app" ? "приложение" : "файл"}</p>
                  </div>
                </div>
                {item.mediaType === "image" && item.url ? <img src={item.url} alt="" className="mt-3 max-h-40 w-full rounded-lg object-cover" /> : null}
                {item.mediaType === "video" && item.url ? <video src={item.url} controls className="mt-3 w-full rounded-lg" /> : null}
                {item.mediaType === "audio" && item.url ? <audio src={item.url} controls className="mt-3 w-full" /> : null}
                {item.text && item.kind !== "media" ? <p className="mt-3 line-clamp-3 text-sm text-muted">{item.text}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.kind === "app" && item.text ? <button className="text-sm text-fg underline-offset-2 hover:underline" onClick={() => setPreview(item)}>Открыть</button> : null}
                  {item.kind === "project" ? (
                    <>
                      <button className="text-sm text-muted" onClick={() => shareProject(item, onToast)}>Поделиться</button>
                      <button className="text-sm text-muted" onClick={() => cycleIcon(item.id)}>Значок</button>
                      <button className="text-sm text-muted" onClick={() => cycleColor(item.id)}>Цвет</button>
                    </>
                  ) : null}
                  <button
                    className="text-sm text-danger"
                    onClick={() => mutate((d) => { d.library = d.library.filter((x) => x.id !== item.id); })}
                  >
                    Удалить
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <Automations runs={runs} setRuns={setRuns} editing={editing} setEditing={setEditing} onToast={onToast} mounted={mounted} />
      )}
      {preview?.text ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4">
          <div className="flex h-[80dvh] w-full max-w-4xl flex-col rounded-3xl border border-line bg-elevated p-3">
            <div className="mb-2 flex items-center">
              <p className="font-medium">{preview.title}</p>
              <button className="ml-auto inline-flex size-10 items-center justify-center" onClick={() => setPreview(null)} aria-label="Закрыть"><X className="size-4" /></button>
            </div>
            <iframe title={preview.title} sandbox="" srcDoc={preview.text} className="min-h-0 w-full flex-1 rounded-xl bg-fg" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MarkIcon({ item }: { item: LibItem }) {
  const common = "size-10";
  const style = { color: item.color };
  if (item.icon === "square") return <span className={`${common} inline-block rounded-lg border-2`} style={{ borderColor: item.color }} />;
  if (item.icon === "diamond") return <span className={`${common} inline-block rotate-45 border-2`} style={{ borderColor: item.color }} />;
  if (item.icon === "triangle") return <span className={common} style={style}><svg viewBox="0 0 24 24" className="size-10"><path d="M12 4 21 20H3Z" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg></span>;
  return <span className={`${common} inline-block rounded-full border-2`} style={{ borderColor: item.color }} />;
}

function cycleIcon(id: string) {
  const order: LibItem["icon"][] = ["circle", "square", "diamond", "triangle"];
  useStudio.getState().mutate((d) => {
    const item = d.library.find((i) => i.id === id);
    if (!item) return;
    item.icon = order[(order.indexOf(item.icon) + 1) % order.length] ?? "circle";
  });
}
function cycleColor(id: string) {
  const order = ["#f4f4f5", "#a1a1aa", "#e4e4e7", "#fca5a5", "#86efac", "#93c5fd"];
  useStudio.getState().mutate((d) => {
    const item = d.library.find((i) => i.id === id);
    if (!item) return;
    item.color = order[(order.indexOf(item.color) + 1) % order.length] ?? "#f4f4f5";
  });
}
function shareProject(item: LibItem, toast: (s: string) => void) {
  const payload = JSON.stringify({ t: item.title, c: item.color, i: item.icon, x: (item.text ?? "").slice(0, 400) });
  const bytes = new TextEncoder().encode(payload);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  const url = `${location.origin}${location.pathname}#p=${btoa(bin)}`;
  navigator.clipboard.writeText(url).then(() => toast("Ссылка проекта скопирована")).catch(() => toast(url));
}

function Automations({
  runs,
  setRuns,
  editing,
  setEditing,
  onToast,
  mounted,
}: {
  runs: boolean;
  setRuns: (v: boolean) => void;
  editing: string | null;
  setEditing: (id: string | null) => void;
  onToast: (s: string) => void;
  mounted: boolean;
}) {
  const automations = useStudio((s) => s.data.automations);
  const mutate = useStudio((s) => s.mutate);
  const current = automations.find((a) => a.id === editing) ?? null;
  const log = automations.flatMap((a) => a.history.map((h) => ({ ...h, name: a.name, statusLive: a.status, id: a.id })));
  log.sort((a, b) => b.at - a.at);
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="space-y-2">
        <div className="mb-2 flex gap-2">
          <Chip on={!runs} onClick={() => setRuns(false)}>Сценарии</Chip>
          <Chip on={runs} onClick={() => setRuns(true)}>Запуски</Chip>
        </div>
        {automations.map((auto) => (
          <button key={auto.id} className={`w-full rounded-xl border px-3 py-3 text-left ${editing === auto.id ? "border-fg" : "border-line"}`} onClick={() => { setEditing(auto.id); setRuns(false); }}>
            <span className="block text-sm font-medium">{auto.name}</span>
            <span className="mt-1 block text-xs text-faint">{labelStatus(auto)}{auto.enabled ? "" : " · выкл"}</span>
          </button>
        ))}
        <button
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-sm"
          onClick={() => {
            const id = uid("auto");
            mutate((d) => {
              d.automations.push({
                id,
                name: "Свой сценарий",
                blurb: "Свободный промпт по расписанию.",
                preset: "custom",
                enabled: false,
                paused: false,
                schedule: "manual",
                trigger: "command",
                keyword: "",
                topics: "",
                sources: "",
                language: "ru",
                prompt: "",
                city: d.city,
                media: "text",
                deliver: "both",
                status: "idle",
                history: [],
                reminders: [],
              });
            });
            setEditing(id);
          }}
        >
          <Plus className="size-4" /> Создать
        </button>
      </div>
      <div className="rounded-3xl border border-line bg-elevated p-4">
        {runs ? (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Запуски</h2>
            {log.length === 0 ? <p className="text-muted">История появится после первого запуска.</p> : null}
            {log.map((row, i) => (
              <div key={`${row.at}-${i}`} className="flex items-start justify-between gap-3 border-b border-line py-2 text-sm">
                <div>
                  <p className="font-medium">{row.name}</p>
                  <p className="text-muted">{row.result}</p>
                </div>
                <div className="text-right text-xs text-faint">
                  <p className={row.status === "error" ? "text-danger" : "text-ok"}>{row.status === "error" ? "ошибка" : "выполнено"}</p>
                  <p>{mounted ? stamp(row.at) : ""}</p>
                </div>
              </div>
            ))}
          </div>
        ) : current ? (
          <AutoEditor auto={current} onToast={onToast} mounted={mounted} />
        ) : (
          <p className="text-muted">Выберите сценарий слева. Пока вкладка открыта, включённые расписания сами отмечают время.</p>
        )}
      </div>
    </div>
  );
}

function labelStatus(auto: Automation) {
  if (auto.paused) return "пауза";
  if (auto.status === "running") return "в процессе";
  if (auto.status === "error") return "ошибка";
  if (auto.status === "done") return "выполнено";
  if (auto.enabled && (auto.schedule === "hourly" || auto.schedule === "daily")) return "запланировано";
  return "вручную";
}

function AutoEditor({ auto, onToast, mounted }: { auto: Automation; onToast: (s: string) => void; mounted: boolean }) {
  const mutate = useStudio((s) => s.mutate);
  const [rem, setRem] = useState("");
  const [when, setWhen] = useState("");
  function edit(fn: (a: Automation) => void) {
    mutate((d) => {
      const row = d.automations.find((x) => x.id === auto.id);
      if (row) fn(row);
    });
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <input value={auto.name} onChange={(e) => edit((a) => { a.name = e.target.value; })} className="w-full bg-transparent text-xl font-semibold outline-none" />
          <p className="text-sm text-muted">{auto.blurb}</p>
        </div>
        <Chip on={auto.enabled} onClick={() => edit((a) => { a.enabled = !a.enabled; if (a.enabled) { a.paused = false; a.status = a.schedule === "manual" ? "idle" : "scheduled"; a.nextRun = a.schedule === "hourly" ? Date.now() + 3600_000 : a.schedule === "daily" ? Date.now() + 86400_000 : undefined; } })}>
          {auto.enabled ? "Включено" : "Выключено"}
        </Chip>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="inline-flex h-10 items-center gap-1 rounded-full bg-fg px-3 text-sm text-bg" onClick={() => void runAutomation(auto.id)}><Play className="size-4" /> Запуск</button>
        <button className="inline-flex h-10 items-center gap-1 rounded-full bg-subtle px-3 text-sm" onClick={() => edit((a) => { a.paused = !a.paused; a.status = a.paused ? "paused" : "scheduled"; })}><Pause className="size-4" /> {auto.paused ? "Продолжить" : "Пауза"}</button>
        <button className="inline-flex h-10 items-center gap-1 rounded-full bg-subtle px-3 text-sm" onClick={() => { requestStop(auto.id); edit((a) => { a.status = "idle"; }); onToast("Остановлено"); }}><Square className="size-4" /> Стоп</button>
        <button className="inline-flex h-10 items-center gap-1 rounded-full bg-subtle px-3 text-sm" onClick={() => void runAutomation(auto.id)}><RotateCcw className="size-4" /> Повтор</button>
        <button className="inline-flex h-10 items-center gap-1 rounded-full bg-subtle px-3 text-sm text-danger" onClick={() => mutate((d) => { d.automations = d.automations.filter((a) => a.id !== auto.id); })}><Trash2 className="size-4" /> Удалить</button>
      </div>
      <p className="text-sm text-faint">Статус: {labelStatus(auto)}{auto.lastRun && mounted ? ` · последний ${stamp(auto.lastRun)}` : ""}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Select label="Расписание" value={auto.schedule} options={[["manual", "Вручную"], ["hourly", "Раз в час"], ["daily", "Ежедневно"], ["event", "По событию"]]} onChange={(v) => edit((a) => { a.schedule = v as Automation["schedule"]; })} />
        <Select label="Триггер" value={auto.trigger} options={[["time", "По времени"], ["keyword", "Ключевое слово"], ["upload", "Загрузка файла"], ["command", "Команда в чате"]]} onChange={(v) => edit((a) => { a.trigger = v as Automation["trigger"]; })} />
        <Select label="Куда класть" value={auto.deliver} options={[["chat", "В чат"], ["library", "В библиотеку"], ["both", "В чат и библиотеку"]]} onChange={(v) => edit((a) => { a.deliver = v as Automation["deliver"]; })} />
        <Select label="Язык ленты" value={auto.language} options={[["ru", "Русский"], ["en", "English"]]} onChange={(v) => edit((a) => { a.language = v; })} />
      </div>
      <Field label="Темы" value={auto.topics} onChange={(v) => edit((a) => { a.topics = v; })} />
      <Field label="Ключевые слова через запятую" value={auto.keyword} onChange={(v) => edit((a) => { a.keyword = v; })} />
      <Field label="Источники (домены через запятую)" value={auto.sources} onChange={(v) => edit((a) => { a.sources = v; })} />
      <Field label="Город для погоды" value={auto.city} onChange={(v) => edit((a) => { a.city = v; })} />
      <Field label="Ссылка для резюме" value={auto.url ?? ""} onChange={(v) => edit((a) => { a.url = v; })} />
      <label className="block text-sm text-muted">
        Промпт или текст
        <textarea value={auto.prompt} onChange={(e) => edit((a) => { a.prompt = e.target.value; })} rows={4} className="mt-1 w-full rounded-xl border border-line bg-bg p-3 text-fg outline-none" />
      </label>
      {auto.preset === "content" ? (
        <div className="flex flex-wrap gap-2">
          <span className="w-full text-xs text-faint">Картинка и аудио тратят квоту на каждый запуск</span>
          {(["text", "image", "audio"] as Automation["media"][]).map((m) => (
            <Chip key={m} on={auto.media === m} onClick={() => edit((a) => { a.media = m; })}>{m === "text" ? "Текст" : m === "image" ? "Изображение" : "Аудио"}</Chip>
          ))}
        </div>
      ) : null}
      {auto.preset === "remind" ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!rem.trim() || !when) return;
            edit((a) => {
              a.reminders.push({ id: uid("rem"), text: rem.trim(), at: new Date(when).getTime(), repeat: "none" });
              a.enabled = true;
            });
            setRem("");
          }}
        >
          <input value={rem} onChange={(e) => setRem(e.target.value)} placeholder="Текст напоминания" className="h-11 flex-1 rounded-xl border border-line bg-bg px-3 text-sm outline-none" />
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-11 rounded-xl border border-line bg-bg px-3 text-sm" />
          <button className="h-11 rounded-xl bg-fg px-3 text-sm text-bg">Добавить</button>
          <div className="w-full space-y-1 text-sm">
            {auto.reminders.map((r) => (
              <p key={r.id} className="text-muted">{r.text} · {mounted ? stamp(r.at) : ""}</p>
            ))}
          </div>
        </form>
      ) : null}
      <div>
        <h3 className="mb-2 text-sm font-medium">История</h3>
        {auto.history.length === 0 ? <p className="text-sm text-faint">Запусков ещё не было.</p> : null}
        {auto.history.slice(0, 6).map((h, i) => (
          <p key={i} className="py-1 text-sm text-muted">{mounted ? stamp(h.at) : ""} · {h.status === "error" ? "ошибка" : "выполнено"} · {h.result}</p>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm text-muted">
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-fg outline-none" />
    </label>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm text-muted">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 text-fg outline-none">
        {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
  );
}

function CanvasBoard({ projectId, onToast }: { projectId: string; onToast: (s: string) => void }) {
  const item = useStudio((s) => s.data.library.find((i) => i.id === projectId));
  const mutate = useStudio((s) => s.mutate);
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#141416";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [projectId]);
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
      <input
        value={item?.title ?? "untitled"}
        onChange={(e) => mutate((d) => {
          const row = d.library.find((i) => i.id === projectId);
          if (row) row.title = e.target.value;
        })}
        className="mb-3 bg-transparent text-2xl font-semibold outline-none"
      />
      <canvas
        ref={ref}
        width={1200}
        height={700}
        className="min-h-0 w-full flex-1 touch-none rounded-3xl border border-line"
        onPointerDown={(e) => {
          drawing.current = true;
          const canvas = ref.current;
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) return;
          const r = canvas.getBoundingClientRect();
          ctx.strokeStyle = "#f4f4f5";
          ctx.lineWidth = 3;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const canvas = ref.current;
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) return;
          const r = canvas.getBoundingClientRect();
          ctx.lineTo(((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height);
          ctx.stroke();
        }}
        onPointerUp={() => { drawing.current = false; }}
      />
      <button
        className="mt-3 h-11 w-fit rounded-xl bg-fg px-4 text-sm text-bg"
        onClick={() => {
          const url = ref.current?.toDataURL("image/png");
          if (!url) return;
          mutate((d) => {
            const row = d.library.find((i) => i.id === projectId);
            if (row) {
              row.text = "Холст";
              row.url = url;
            }
            d.library.unshift({ id: uid("lib"), kind: "media", mediaType: "image", title: item?.title || "Холст", url, at: Date.now(), icon: "circle", color: "#f4f4f5" });
          });
          onToast("Холст сохранён в проекты и медиа");
        }}
      >
        Сохранить холст
      </button>
    </div>
  );
}

function ProfileSheet({ onClose, onToast }: { onClose: () => void; onToast: (s: string) => void }) {
  const data = useStudio((s) => s.data);
  const mutate = useStudio((s) => s.mutate);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-bg/70">
      <button className="hidden flex-1 sm:block" aria-label="Закрыть" onClick={onClose} />
      <aside className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-elevated p-5">
        <div className="mb-4 flex items-center">
          <h2 className="text-lg font-semibold">Профиль</h2>
          <button className="ml-auto inline-flex size-10 items-center justify-center" onClick={onClose} aria-label="Закрыть"><X className="size-4" /></button>
        </div>
        <div className="space-y-3">
          <Field label="Как к вам обращаться" value={data.profileName} onChange={(v) => mutate((d) => { d.profileName = v; })} />
          <Field label="Город" value={data.city} onChange={(v) => mutate((d) => { d.city = v; })} />
          <Field label="Ключ OpenAI (ChatGPT)" value={data.keys.openai} onChange={(v) => mutate((d) => { d.keys.openai = v; })} />
          <Field label="Ключ DashScope (Qwen)" value={data.keys.qwen} onChange={(v) => mutate((d) => { d.keys.qwen = v; })} />
          <Field label="Ключ DeepSeek" value={data.keys.deepseek} onChange={(v) => mutate((d) => { d.keys.deepseek = v; })} />
          <p className="text-xs leading-relaxed text-faint">Ключи остаются в этом браузере и уходят на сервер только в момент запроса. Grok отвечает и без них. Картинки, видео и голос идут через Grok.</p>
          <button
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm"
            onClick={() => {
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "grok-backup.json";
              a.click();
              onToast("Бэкап скачан");
            }}
          >
            <Copy className="size-4" /> Скачать данные
          </button>
        </div>
      </aside>
    </div>
  );
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  }
}
