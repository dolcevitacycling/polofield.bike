let reqId;

const dateTimeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Los_Angeles",
  dateStyle: "short",
  timeStyle: "short",
});

function dateTime(date) {
  return dateTimeFormat.format(date).split(" ");
}

function dayPercent(time) {
  const [hour, minute] = time.split(":").map(Number);
  return `${100 * (hour * 60 + minute) / (24 * 60)}%`;
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
  for (const interval of document.querySelectorAll(`.intervals.today:not([data-date="${today}"])`)) {
    interval.classList.remove("today");
  }
  document.documentElement.style.setProperty("--now-percent", dayPercent(now));
  const el = document.querySelector(`.intervals[data-date="${today}"]`);
  if (el) {
    el.classList.add("today");
    for (const section of el.querySelectorAll(".intervals > li ")) {
      section.classList.toggle("now", section.dataset.start <= now && now <= section.dataset.end);
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
