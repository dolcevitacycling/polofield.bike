let reqId;

const dateTimeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Los_Angeles",
  dateStyle: "short",
  timeStyle: "medium",
});

function dateTime(date) {
  return dateTimeFormat.format(date).split(" ");
}

function timeToMinutes(time) {
  const [hour, minute, second] = time.split(":").map(Number);
  return hour * 60 + minute + (second ?? 0) / 60;
}

function dayPercent(startTime, endTime, nowTime) {
  const [start, end, now] = [startTime, endTime, nowTime].map(timeToMinutes);
  // end time is the leading edge of the minute so we add one
  return `${(100 * (now - start)) / (end - start + 1)}%`;
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
  const [today, now] = dateTime(Date.now());
  for (const interval of document.querySelectorAll(
    `.intervals.today:not([data-date="${today}"])`,
  )) {
    for (const el of interval.querySelectorAll(".now")) {
      el.classList.remove("now");
      for (const logo of el.querySelectorAll(".open-now,.closed-now")) {
        logo.classList.remove("open-now", "closed-now");
      }
    }
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
        const logo = document.querySelector("header .logo .status");
        if (logo) {
          for (const cls of ["open", "closed"]) {
            logo.classList.toggle(`${cls}-now`, section.classList.contains(cls));
          }
        }
      }
    }
  }
  schedule(5000);
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
