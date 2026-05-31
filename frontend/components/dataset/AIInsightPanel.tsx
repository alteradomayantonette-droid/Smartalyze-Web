"use client";

import { useEffect, useRef, useState } from "react";
import {
  AIChatMessage,
  AIAnalyzeContext,
  AIAnalyzeResponse,
  getAIInsight,
  sendAIAnalyzeChat,
} from "@/lib/api";

interface AIInsightPanelProps {
  context: AIAnalyzeContext | null;
  token: string;
  contextKey: string | number;
}

function InsightText({ text }: { text: string }) {
  return (
    <div className="space-y-1">
      {text.split("\n").map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        const isPoint = /^\d+[\.\)]/.test(trimmed) || /^[-•]/.test(trimmed);
        return (
          <p
            key={i}
            className={`text-sm leading-relaxed ${
              isPoint ? "font-medium text-slate-800" : "text-slate-600 pl-4"
            }`}
          >
            {trimmed}
          </p>
        );
      })}
    </div>
  );
}

export function AIInsightPanel({ context, token, contextKey }: AIInsightPanelProps) {
  const [insight, setInsight] = useState<string | null>(null);
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);

  const [chatHistory, setChatHistory] = useState<AIChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!context) return;

    setInsight(null);
    setInsightError(null);
    setChatHistory([]);
    setLoadingInsight(true);

    getAIInsight(context, token)
      .then((res: AIAnalyzeResponse) => setInsight(res.insight))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "AI unavailable.";
        setInsightError(msg);
      })
      .finally(() => setLoadingInsight(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  async function handleSendChat() {
    if (!context) return;
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;

    const newHistory: AIChatMessage[] = [...chatHistory, { role: "user", content: msg }];
    setChatHistory(newHistory);
    setChatInput("");
    setChatLoading(true);
    setChatError(null);

    try {
      const res = await sendAIAnalyzeChat(context, msg, chatHistory, token);
      setChatHistory([...newHistory, { role: "assistant", content: res.reply }]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to get a reply.";
      setChatError(message);
    } finally {
      setChatLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendChat();
    }
  }

  if (!context) return null;

  return (
    <div className="space-y-3">
      {/* Section 1: AI Analysis */}
      <div className="rounded-2xl border border-indigo-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-indigo-100">
          <span className="text-sm font-semibold text-indigo-900">AI Analysis</span>
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-600 uppercase tracking-wide">
            AI
          </span>
        </div>
        <div className="px-5 py-4 max-h-44 overflow-y-auto">
          {loadingInsight && (
            <div className="flex items-center gap-2 text-sm text-indigo-600">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Interpreting your findings…
            </div>
          )}
          {insightError && (
            <p className="text-sm text-red-600">{insightError}</p>
          )}
          {insight && !loadingInsight && <InsightText text={insight} />}
        </div>
      </div>

      {/* Section 2: Ask AI */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200">
          <span className="text-sm font-semibold text-slate-800">Ask AI</span>
        </div>

        {/* Input first — always visible */}
        <div className="flex items-end gap-2 px-4 py-3 bg-white border-b border-slate-100">
          <textarea
            rows={1}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your findings… (Enter to send)"
            className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <button
            type="button"
            onClick={() => void handleSendChat()}
            disabled={!chatInput.trim() || chatLoading}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors"
          >
            Send
          </button>
        </div>

        {/* Chat history below input */}
        {(chatHistory.length > 0 || chatLoading || chatError) && (
          <div className="max-h-52 overflow-y-auto px-4 py-3 space-y-3">
            {chatHistory.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white"
                      : "bg-white border border-slate-200 text-slate-800"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm text-slate-500 italic">
                  Thinking…
                </div>
              </div>
            )}
            {chatError && (
              <p className="text-xs text-red-500 text-center">{chatError}</p>
            )}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}
