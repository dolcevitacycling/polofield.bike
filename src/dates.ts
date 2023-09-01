export function parseDate(date: string): Date {
  const [y, m, d] = date.split("-").map((s) => parseInt(s, 10));
  return new Date(y, m - 1, d);
}

export function formatTime(date: string, hour: number, minute: number): string {
  return `${date} ${hour.toString().padStart(2, "0")}:${minute
    .toString()
    .padStart(2, "0")}`;
}

export function toMinute(hour: number, minute: number): number {
  return hour * 60 + minute;
}

export function startOfDay(date: string): string {
  return formatTime(date, 0, 0);
}

export function endOfDay(date: string): string {
  return formatTime(date, 23, 59);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export const monthDayStyle = new Intl.DateTimeFormat("fr-CA", {
  month: "2-digit",
  day: "2-digit",
});
export const shortDateStyle = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "short",
});
export const shortTimeStyle = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
export const tzTimeFormat = new Intl.DateTimeFormat("en-US", {
  hourCycle: "h24",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
});

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function addMinutes(date: Date, minutes: number): Date {
  const result = new Date(date);
  result.setMinutes(result.getMinutes() + minutes);
  return result;
}

export function daily<T>(
  start_date: string,
  end_date: string,
  f: (date: Date) => T[],
): T[] {
  const result: T[] = [];
  const start = parseDate(start_date);
  const end = parseDate(end_date);
  for (let date = start; date <= end; date.setDate(date.getDate() + 1)) {
    result.push(...f(date));
  }
  return result;
}

export const pacificISODate = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "America/Los_Angeles",
});

export const usFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export function friendlyDate(date: string) {
  return usFormat.format(parseDate(date));
}

export function friendlyTime(time: string) {
  const [h, m] = time.split(":");
  const hh = parseInt(h, 10);
  const h12 = hh % 12;
  const ampm = h12 === hh ? "am" : "pm";
  return `${h12 === 0 ? 12 : h12}${m === "00" ? "" : `:${m}`}${ampm}`;
}

export function friendlyTimeStart(date: string, time: string) {
  return time === "00:00" ? friendlyDate(date) : friendlyTime(time);
}

export function friendlyTimeEnd(time: string) {
  const mins = timeToMinutes(time) + 1;
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  const h12 = hh % 12;
  const ampm = h12 === hh ? "am" : "pm";
  return `${h12 === 0 ? 12 : h12}${
    mm === 0 ? "" : `:${mm.toString().padStart(2, "0")}`
  }${ampm}`;
}

export function friendlyTimeSpan(hStart: string, hEnd: string) {
  if (hStart === "00:00" && hEnd === "23:59") {
    return "all day";
  } else if (hStart === "00:00") {
    return `until ${friendlyTimeEnd(hEnd)}`;
  } else if (hEnd === "23:59") {
    return `from ${friendlyTime(hStart)}`;
  } else {
    return `from ${friendlyTime(hStart)} to ${friendlyTimeEnd(hEnd)}`;
  }
}

export function clampStart(date: string, timestamp: string): string {
  const [tsDate, tsTime] = timestamp.split(" ");
  return date === tsDate ? tsTime : "00:00";
}

export function clampEnd(date: string, timestamp: string): string {
  const [tsDate, tsTime] = timestamp.split(" ");
  return date === tsDate ? tsTime : "23:59";
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

export function intervalMinutes(hStart: string, hEnd: string): number {
  return timeToMinutes(hEnd) - timeToMinutes(hStart);
}

export function getTodayPacific(): string {
  return pacificISODate.format(new Date());
}
