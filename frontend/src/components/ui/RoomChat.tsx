/**
 * RoomChat — grounded AI assistant for an Al Falah room (or the whole zone).
 *
 * Reuses the MIQYAS chatbot design, but talks to Groq's free llama-3.3-70b model
 * directly from the browser (no backend needed for this static demo). The model
 * is grounded in a system prompt built from analysis.json, so it only answers
 * from the site-walk data.
 *
 * Setup: add VITE_GROQ_API_KEY to frontend/.env (free key at https://groq.com).
 * Without a key, the panel shows a short setup notice instead of erroring.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Bot, KeyRound } from "lucide-react";

const GROQ_KEY = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/** Minimal inline formatter: renders **bold** segments, plain text otherwise. */
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>,
  );
}

interface RoomChatProps {
  /** Stable key — resets the conversation when it changes (e.g. new room). */
  conversationKey: string;
  systemPrompt: string;
  welcome: string;
  suggested: string[];
  isLight: boolean;
}

export default function RoomChat({ conversationKey, systemPrompt, welcome, suggested, isLight }: RoomChatProps) {
  const [messages, setMessages] = useState<Message[]>([{ id: "welcome", role: "assistant", content: welcome }]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset when the room changes
  useEffect(() => {
    setMessages([{ id: "welcome", role: "assistant", content: welcome }]);
    setInput("");
  }, [conversationKey, welcome]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    if (!GROQ_KEY) {
      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", content: trimmed },
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content:
            "⚠️ AI chat isn't configured yet. Add a free **`VITE_GROQ_API_KEY`** to `frontend/.env` (get one at groq.com), then restart the dev server.",
        },
      ]);
      setInput("");
      return;
    }

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: trimmed };
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    const history = messages
      .filter((m) => m.id !== "welcome" && m.content)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          stream: true,
          max_tokens: 1024,
          messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: trimmed }],
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Groq ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const l = line.trim();
          if (!l.startsWith("data:")) continue;
          const payload = l.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const delta = JSON.parse(payload).choices?.[0]?.delta?.content ?? "";
            if (delta) {
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)));
            }
          } catch { /* ignore keep-alive / malformed chunks */ }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `Sorry, I couldn't reach the model (${err instanceof Error ? err.message : "error"}). Check VITE_GROQ_API_KEY.` }
            : m,
        ),
      );
    } finally {
      setStreaming(false);
    }
  }, [messages, streaming, systemPrompt]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const bubbleUser = isLight ? "bg-mq-600 text-white" : "bg-mq-600/30 text-white";
  const bubbleBot = isLight ? "bg-[#F0EDE5] text-[#26241F]" : "bg-slate-800 text-slate-100";
  const chipBorder = isLight ? "border-[#E0DBCC] text-[#8A8577] hover:border-mq-500 hover:text-mq-600" : "border-slate-600 text-slate-300 hover:border-mq-500 hover:text-mq-300";
  const inputWrap = isLight ? "border-[#E0DBCC] bg-white" : "border-slate-600 bg-slate-800";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className={`flex items-center gap-2.5 px-4 py-3 border-b ${isLight ? "border-[#E0DBCC]" : "border-[#1e3050]"}`}>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-mq-600/25">
          <Bot size={16} className="text-mq-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">MIQYAS AI</p>
          <p className={`truncate text-xs ${isLight ? "text-[#8A8577]" : "text-slate-400"}`}>
            {GROQ_KEY ? "Ask about this room" : "Setup required"}
          </p>
        </div>
        {!GROQ_KEY && <span className="ml-auto" title="VITE_GROQ_API_KEY not set"><KeyRound size={13} className="text-amber-400" /></span>}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
              msg.role === "user" ? `${bubbleUser} rounded-br-md` : `${bubbleBot} rounded-bl-md`
            }`}>
              {msg.role === "assistant" && !msg.content ? (
                <span className="flex gap-1 items-center py-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
              ) : (
                <span className="whitespace-pre-wrap">{renderInline(msg.content)}</span>
              )}
            </div>
          </div>
        ))}

        {messages.length === 1 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {suggested.map((q) => (
              <button key={q} onClick={() => send(q)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${chipBorder}`}>
                {q}
              </button>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className={`border-t p-3 ${isLight ? "border-[#E0DBCC]" : "border-[#1e3050]"}`}>
        <div className={`flex items-end gap-2 rounded-xl border px-3 py-2 transition-colors focus-within:border-mq-500/60 ${inputWrap}`}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={streaming}
            placeholder="Ask about this room…"
            rows={1}
            className={`flex-1 resize-none bg-transparent text-sm outline-none disabled:opacity-50 ${isLight ? "text-[#26241F] placeholder-[#B3AE9E]" : "text-white placeholder-slate-500"}`}
            style={{ maxHeight: "96px", overflowY: "auto" }}
          />
          <button onClick={() => send(input)} disabled={!input.trim() || streaming}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-mq-600 text-white transition-all hover:bg-mq-500 disabled:opacity-40 disabled:cursor-not-allowed">
            {streaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
}
