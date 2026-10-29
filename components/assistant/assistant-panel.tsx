"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { askAssistantAction } from "@/app/app/assistant/actions";
import type { AssistantCard, AssistantReply, CardTone } from "@/lib/assistant/respond";

interface Turn {
  id: number;
  from: "person" | "assistant";
  text: string;
  reply?: AssistantReply;
}

const TONES: Record<CardTone, string> = {
  good: "bg-flag-green-bg text-flag-green",
  attention: "bg-flag-amber-bg text-flag-amber",
  problem: "bg-flag-red-bg text-flag-red",
  neutral: "bg-sand-100 text-ink-700",
};

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M4 4.75h12a1.25 1.25 0 0 1 1.25 1.25v7A1.25 1.25 0 0 1 16 14.25H9.5L6 17v-2.75H4A1.25 1.25 0 0 1 2.75 13V6A1.25 1.25 0 0 1 4 4.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M6.5 8.5h7M6.5 11h4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function Card({ card, onFollow }: { card: AssistantCard; onFollow: () => void }) {
  return (
    <Link
      href={card.href}
      onClick={onFollow}
      className="group block rounded-xl border border-sand-200 bg-white p-3 transition hover:border-brand-600/40 hover:bg-brand-50/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-950">{card.title}</p>
          <p className="mt-0.5 text-xs text-ink-600">{card.subtitle}</p>
          {card.detail ? <p className="mt-1 text-xs text-ink-700">{card.detail}</p> : null}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${TONES[card.tone]}`}>
          {card.badge}
        </span>
      </div>
      <p className="mt-2 text-xs font-semibold text-brand-700 group-hover:text-brand-600">
        {card.cta}
      </p>
    </Link>
  );
}

export function AssistantPanel({
  greeting,
  starters,
}: {
  greeting: string;
  starters: string[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const titleId = useId();

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, pending]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  function ask(question: string) {
    const text = question.trim();

    if (!text || pending) {
      return;
    }

    const personTurn: Turn = { id: nextId.current++, from: "person", text };
    setTurns((current) => [...current, personTurn]);
    setDraft("");

    startTransition(async () => {
      const reply = await askAssistantAction(text);
      setTurns((current) => [
        ...current,
        { id: nextId.current++, from: "assistant", text: reply.message, reply },
      ]);
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    ask(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      ask(draft);
    }
  }

  function followLink() {
    if (window.matchMedia("(max-width: 639px)").matches) {
      setOpen(false);
    }
  }

  const lastReply = [...turns].reverse().find((turn) => turn.from === "assistant")?.reply;
  const chips = turns.length === 0 ? starters : (lastReply?.suggestions ?? []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls="assistant-panel"
        className="fixed right-4 bottom-4 z-40 inline-flex items-center gap-2 rounded-full bg-ink-950 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-ink-950/20 transition hover:bg-ink-800 sm:right-6 sm:bottom-6"
      >
        <ChatIcon className="size-5 text-brand-300" />
        {open ? "Close assistant" : "Ask RoomRelay"}
      </button>

      {open ? (
        <section
          id="assistant-panel"
          role="dialog"
          aria-labelledby={titleId}
          className="fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col rounded-t-2xl border border-sand-200 bg-sand-50 shadow-2xl sm:inset-x-auto sm:right-6 sm:bottom-24 sm:h-[min(640px,calc(100dvh-8rem))] sm:w-[400px] sm:rounded-2xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-sand-200 px-4 py-3">
            <div>
              <h2 id={titleId} className="text-base font-bold text-ink-950">
                Ask RoomRelay
              </h2>
              <p className="text-xs text-ink-600">
                Answers come from live room data. Nothing is booked until you send a request.
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-700 hover:bg-sand-100"
              aria-label="Close assistant"
            >
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-4">
                <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            <p className="max-w-[90%] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm leading-6 text-ink-900 shadow-[0_1px_2px_rgba(6,21,33,0.06)]">
              {greeting}
            </p>

            {turns.map((turn) =>
              turn.from === "person" ? (
                <p
                  key={turn.id}
                  className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-ink-950 px-3.5 py-2.5 text-sm leading-6 text-white"
                >
                  {turn.text}
                </p>
              ) : (
                <div key={turn.id} className="max-w-[95%] space-y-2">
                  <div className="space-y-2 rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm leading-6 text-ink-900 shadow-[0_1px_2px_rgba(6,21,33,0.06)]">
                    {turn.text.split("\n").map((line, index) => (
                      <p key={index}>{line}</p>
                    ))}
                  </div>
                  {turn.reply?.cards.map((card) => (
                    <Card key={`${card.href}-${card.title}`} card={card} onFollow={followLink} />
                  ))}
                </div>
              ),
            )}

            {pending ? (
              <p className="inline-flex items-center gap-2 text-sm text-ink-600">
                <span className="size-3.5 animate-spin rounded-full border-2 border-ink-600/25 border-t-ink-600" aria-hidden="true" />
                Looking that up…
              </p>
            ) : null}
          </div>

          <div className="border-t border-sand-200 bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-b-2xl">
            {chips.length > 0 && !pending ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {chips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => ask(chip)}
                    className="rounded-full border border-brand-600/25 bg-brand-50 px-3 py-1.5 text-left text-xs font-semibold text-brand-700 hover:bg-brand-100"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            ) : null}
            <form onSubmit={onSubmit} className="flex items-end gap-2">
              <label htmlFor="assistant-input" className="sr-only">
                Your question
              </label>
              <textarea
                id="assistant-input"
                ref={inputRef}
                rows={1}
                maxLength={400}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="e.g. A room for 8 tomorrow 2–4pm"
                className="field h-auto max-h-32 min-h-11 flex-1 resize-none py-2.5"
              />
              <button
                type="submit"
                disabled={pending || !draft.trim()}
                className="btn-primary min-h-11 px-4"
              >
                Send
              </button>
            </form>
          </div>
        </section>
      ) : null}
    </>
  );
}
