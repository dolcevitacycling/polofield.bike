let reqId;

const dateTimeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Los_Angeles",
  dateStyle: "short",
  timeStyle: "short",
});

function dateTime(date) {
  return dateTimeFormat.format(date).split(" ");
}

function timeToMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function dayPercent(startTime, endTime, nowTime) {
  const [start, end, now] = [startTime, endTime, nowTime].map(timeToMinutes);
  return `${(100 * (now - start)) / (end - start)}%`;
}

function schedule(delay) {
  stop();
  reqId = setTimeout(step, delay);
}
function stop() {
  if (!reqId) return;
  clearTimeout(reqId);
  reqId = undefined;
}
function step() {
  const [today, now] = dateTime(new Date());
  for (const interval of document.querySelectorAll(
    `.intervals.today:not([data-date="${today}"])`,
  )) {
    interval.classList.remove("today");
  }
  const el = document.querySelector(`.intervals[data-date="${today}"]`);
  if (el) {
    el.classList.add("today");
    for (const section of el.querySelectorAll(".intervals > li ")) {
      const isNow = section.dataset.start <= now && now <= section.dataset.end;
      section.classList.toggle("now", isNow);
      if (isNow) {
        document.documentElement.style.setProperty(
          "--now-percent",
          dayPercent(section.dataset.start, section.dataset.end, now),
        );
      }
    }
  }
  schedule(60000);
}

document.addEventListener("visibilitychange", () => {
  switch (document.visibilityState) {
    case "hidden":
      return stop();
    case "visible":
      return schedule(0);
  }
});
schedule(0);
