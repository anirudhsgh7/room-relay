"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  addDaysToCalendarDate,
  formatCalendarDate,
  formatCalendarMonth,
  getCalendarDateCells,
  parseCalendarDate,
  shiftCalendarMonth,
} from "@/lib/rooms/calendar";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, hour) =>
  hour.toString().padStart(2, "0"),
);
const MINUTES = Array.from({ length: 12 }, (_, index) =>
  (index * 5).toString().padStart(2, "0"),
);

function CalendarDatePicker({
  value,
  today,
  onChange,
}: {
  value: string;
  today: string;
  onChange: (value: string) => void;
}) {
  const normalizedValue = parseCalendarDate(value) ? value : "";
  const initialVisibleDate = normalizedValue || today;
  const todayMonth = parseCalendarDate(today)!;
  const [selectedDate, setSelectedDate] = useState(normalizedValue);
  const [visibleMonth, setVisibleMonth] = useState(
    () => parseCalendarDate(initialVisibleDate) ?? todayMonth,
  );
  const [focusedDate, setFocusedDate] = useState(initialVisibleDate);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const cells = getCalendarDateCells(visibleMonth.year, visibleMonth.month);
  const selectedLabel = selectedDate ? formatCalendarDate(selectedDate) : null;
  const monthLabel = formatCalendarMonth(visibleMonth.year, visibleMonth.month);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      dayRefs.current.get(focusedDate)?.focus();
    }
  }, [focusedDate, open, visibleMonth]);

  function showMonth(offset: number) {
    const month = shiftCalendarMonth(
      visibleMonth.year,
      visibleMonth.month,
      offset,
    );
    setVisibleMonth(month);
    const firstDay = `${month.year.toString().padStart(4, "0")}-${month.month
      .toString()
      .padStart(2, "0")}-01`;
    setFocusedDate(firstDay);
  }

  function chooseDate(date: string) {
    setSelectedDate(date);
    onChange(date);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const offset =
      event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowUp"
            ? -7
            : event.key === "ArrowDown"
              ? 7
              : event.key === "Home"
                ? -((new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7)
                : event.key === "End"
                  ? 6 - ((new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7)
                  : null;

    if (offset === null) {
      return;
    }

    event.preventDefault();
    const nextDate = addDaysToCalendarDate(date, offset);

    if (!nextDate) {
      return;
    }

    setFocusedDate(nextDate);
    const month = parseCalendarDate(nextDate);
    if (month) {
      setVisibleMonth(month);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <input type="hidden" name="date" value={selectedDate} />
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={selectedLabel ? `Date: ${selectedLabel}` : "Choose a date"}
        onClick={() => {
          if (!open) {
            const date = selectedDate || today;
            setFocusedDate(date);
            setVisibleMonth(parseCalendarDate(date) ?? todayMonth);
          }
          setOpen((current) => !current);
        }}
        className="field flex cursor-pointer items-center justify-between gap-3 text-left"
      >
        <span className={selectedLabel ? "text-ink-950" : "text-ink-600/70"}>
          {selectedLabel ?? "Choose a date"}
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-600"
        >
          <rect x="3.25" y="4.5" width="13.5" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M6.5 3v3M13.5 3v3M3.5 8h13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose a campus date"
          className="absolute left-0 top-[calc(100%+0.5rem)] z-40 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-sand-200 bg-white p-4 shadow-xl"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => showMonth(-1)}
              aria-label="Previous month"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-sand-200 text-ink-700 transition hover:bg-sand-50"
            >
              <span aria-hidden="true" className="text-xl leading-none">‹</span>
            </button>
            <h3 className="text-sm font-bold text-ink-950" aria-live="polite">
              {monthLabel}
            </h3>
            <button
              type="button"
              onClick={() => showMonth(1)}
              aria-label="Next month"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-sand-200 text-ink-700 transition hover:bg-sand-50"
            >
              <span aria-hidden="true" className="text-xl leading-none">›</span>
            </button>
          </div>

          <div
            role="grid"
            aria-label={monthLabel}
            className="mt-3 space-y-1"
          >
            <div role="row" className="grid grid-cols-7">
              {WEEKDAYS.map((weekday) => (
                <span
                  key={weekday}
                  role="columnheader"
                  className="py-2 text-center text-[0.65rem] font-semibold text-ink-600"
                >
                  {weekday}
                </span>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, week) => (
              <div key={week} role="row" className="grid grid-cols-7">
                {cells.slice(week * 7, week * 7 + 7).map((cell) => {
                  const selected = cell.date === selectedDate;
                  const isToday = cell.date === today;

                  return (
                    <div
                      key={cell.date}
                      role="gridcell"
                      aria-selected={selected}
                      className="flex justify-center"
                    >
                      <button
                        ref={(node) => {
                          if (node) {
                            dayRefs.current.set(cell.date, node);
                          } else {
                            dayRefs.current.delete(cell.date);
                          }
                        }}
                        type="button"
                        tabIndex={cell.date === focusedDate ? 0 : -1}
                        aria-label={formatCalendarDate(cell.date) ?? cell.date}
                        aria-pressed={selected}
                        aria-current={isToday ? "date" : undefined}
                        onClick={() => chooseDate(cell.date)}
                        onKeyDown={(event) => moveFocus(event, cell.date)}
                        className={`inline-flex size-9 items-center justify-center rounded-full text-xs font-semibold transition focus-visible:outline-offset-1 ${
                          selected
                            ? "bg-ink-950 text-white"
                            : isToday
                              ? "border border-brand-600/35 text-brand-700 hover:bg-brand-50"
                              : cell.inCurrentMonth
                                ? "text-ink-900 hover:bg-sand-100"
                                : "text-ink-600/45 hover:bg-sand-50"
                        }`}
                      >
                        {cell.day}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-sand-200 pt-3">
            <span className="text-[0.65rem] text-ink-600">Campus local date</span>
            <div className="flex gap-3">
              {selectedDate ? (
                <button
                  type="button"
                  onClick={() => chooseDate("")}
                  className="text-xs font-semibold text-ink-600 hover:text-ink-950"
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => chooseDate(today)}
                className="text-xs font-semibold text-brand-700 hover:text-brand-600"
              >
                Today
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TimePicker({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const validValue = /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const [hour, setHour] = useState(validValue ? value.slice(0, 2) : "");
  const [minute, setMinute] = useState(validValue ? value.slice(3, 5) : "");
  const minuteOptions =
    minute && !MINUTES.includes(minute) ? [...MINUTES, minute].sort() : MINUTES;

  function changeHour(nextHour: string) {
    setHour(nextHour);

    if (!nextHour) {
      setMinute("");
      onChange("");
      return;
    }

    const nextMinute = minute || "00";
    setMinute(nextMinute);
    onChange(`${nextHour}:${nextMinute}`);
  }

  function changeMinute(nextMinute: string) {
    setMinute(nextMinute);
    onChange(hour && nextMinute ? `${hour}:${nextMinute}` : "");
  }

  function clearTime() {
    setHour("");
    setMinute("");
    onChange("");
  }

  return (
    <div>
      <input type="hidden" name={name} value={value} />
      <div className="flex h-12 items-center rounded-xl border border-sand-300 bg-sand-50 px-2 focus-within:border-brand-600 focus-within:bg-white focus-within:ring-4 focus-within:ring-brand-500/10">
        <select
          value={hour}
          onChange={(event) => changeHour(event.target.value)}
          aria-label={`${label} hour`}
          className="h-full min-w-0 flex-1 cursor-pointer bg-transparent px-2 text-sm font-semibold text-ink-950 focus:outline-none"
        >
          <option value="">HH</option>
          {HOURS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <span aria-hidden="true" className="font-semibold text-ink-600">:</span>
        <select
          value={minute}
          onChange={(event) => changeMinute(event.target.value)}
          aria-label={`${label} minute`}
          className="h-full min-w-0 flex-1 cursor-pointer bg-transparent px-2 text-sm font-semibold text-ink-950 focus:outline-none"
        >
          <option value="">MM</option>
          {minuteOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        {value ? (
          <button
            type="button"
            onClick={clearTime}
            aria-label={`Clear ${label.toLowerCase()} time`}
            className="rounded-md px-2 py-1 text-[0.65rem] font-semibold text-ink-600 hover:bg-sand-100 hover:text-ink-950"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function RoomSearchDateTimeFields({
  date: initialDate,
  startTime: initialStartTime,
  endTime: initialEndTime,
  today,
}: {
  date: string;
  startTime: string;
  endTime: string;
  today: string;
}) {
  const safeDate = parseCalendarDate(initialDate) ? initialDate : "";
  const [date, setDate] = useState(safeDate);
  const [startTime, setStartTime] = useState(initialStartTime);
  const [endTime, setEndTime] = useState(initialEndTime);

  return (
    <>
      <div className="lg:col-span-2">
        <p className="mb-1.5 text-xs font-semibold text-ink-800">
          Date
        </p>
        <CalendarDatePicker value={date} today={today} onChange={setDate} />
      </div>
      <fieldset className="m-0 min-w-0 border-0 p-0 lg:col-span-2">
        <legend className="mb-1.5 text-xs font-semibold text-ink-800">Start</legend>
        <TimePicker
          name="start"
          label="Start"
          value={startTime}
          onChange={setStartTime}
        />
      </fieldset>
      <fieldset className="m-0 min-w-0 border-0 p-0 lg:col-span-2">
        <legend className="mb-1.5 text-xs font-semibold text-ink-800">End</legend>
        <TimePicker
          name="end"
          label="End"
          value={endTime}
          onChange={setEndTime}
        />
      </fieldset>
    </>
  );
}
