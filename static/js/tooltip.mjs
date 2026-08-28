import {
  computePosition,
  autoUpdate,
  offset,
  flip,
  shift,
  arrow,
} from "https://cdn.jsdelivr.net/npm/@floating-ui/dom@1.5.1/+esm";
const tooltips = document.createDocumentFragment();
let tooltipId = 0;
let cleanup;
function updatePosition(referenceEl, floatingEl, arrowEl) {
  computePosition(referenceEl, floatingEl, {
    placement: "top",
    middleware: [
      offset(6),
      flip(),
      shift({ padding: 5 }),
      arrow({ element: arrowEl }),
    ],
  }).then(({ x, y, placement, middlewareData }) => {
    Object.assign(floatingEl.style, {
      left: `${x}px`,
      top: `${y}px`,
    });
    const { x: arrowX, y: arrowY } = middlewareData.arrow;

    const staticSide = {
      top: "bottom",
      right: "left",
      bottom: "top",
      left: "right",
    }[placement.split("-")[0]];

    Object.assign(arrowEl.style, {
      left: arrowX != null ? `${arrowX}px` : "",
      top: arrowY != null ? `${arrowY}px` : "",
      right: "",
      bottom: "",
      [staticSide]: "-4px",
    });
  });
}
// Flyer image for each memorial ride date (see src/memorial.ts and the
// 2025-09-07 special case in src/scrapeCalendar.ts).
const MEMORIAL_FLYERS = {
  "2025-09-07": "/img/20250907-memorial-ride.png",
  "2026-07-26": "/img/20260726-memorial-ride.png",
};
const memorial = document.createElement("dialog");
let memorialMounted = false;
let memorialSrc;
function showMemorial(src) {
  if (!memorialMounted) {
    memorial.classList.add("memorial-dialog");
    document.body.appendChild(memorial);
    memorial.onclick = (ev) => {
      ev.preventDefault();
      memorial.close();
    };
    memorialMounted = true;
  }
  if (memorialSrc !== src) {
    memorial.innerHTML = `
<img src="${src}" alt="Memorial ride flyer" />
`;
    memorialSrc = src;
  }
  memorial.showModal();
}

let egg = { reference: null };
function toggleTooltip(e) {
  const referenceEl = e.currentTarget;
  const floatingEl = document.getElementById(
    referenceEl.getAttribute("aria-describedby"),
  );
  const memorialLi = referenceEl.closest("li");
  if (memorialLi?.dataset.memorial) {
    egg = { reference: null };
    const date = memorialLi.closest("ul[data-date]")?.dataset.date;
    const flyer = MEMORIAL_FLYERS[date];
    if (flyer) showMemorial(flyer);
  } else if (egg.reference === referenceEl) {
    if (++egg.count === 10) {
      referenceEl.querySelector("span").innerHTML =
        `<img src="/img/hoyhoy_kom2.gif" alt="hoyhoy" width="64" />`;
    }
  } else {
    egg = {
      reference: referenceEl,
      count: 1,
    };
  }
  e.preventDefault();
  if (cleanup) {
    if (floatingEl.dataset.event === "click") {
      floatingEl.dataset.event = "";
      return hideTooltip(e);
    }
  } else {
    showTooltip(e);
  }
  floatingEl.dataset.event = "click";
}
function showTooltip(e) {
  const referenceEl = e.currentTarget;
  const floatingEl = document.getElementById(
    referenceEl.getAttribute("aria-describedby"),
  );
  const arrowEl = floatingEl.querySelector(".tooltip-arrow");
  cleanup && cleanup();
  cleanup = ((f) => () => {
    floatingEl.style.opacity = "0";
    floatingEl.dataset.event = "";
    f();
  })(
    autoUpdate(referenceEl, floatingEl, () =>
      updatePosition(referenceEl, floatingEl, arrowEl),
    ),
  );
  floatingEl.style.opacity = "1";
  floatingEl.dataset.event = "";
}
function hideTooltip(_e) {
  cleanup && cleanup();
  cleanup = undefined;
}
Array.prototype.forEach.call(
  document.querySelectorAll(".intervals button[aria-label]"),
  (el) => {
    const tooltip = document.createElement("div");
    tooltip.id = `tooltip-${tooltipId++}`;
    tooltip.className = "tooltip";
    const lines = el.getAttribute("aria-label").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) tooltip.appendChild(document.createElement("br"));
      tooltip.appendChild(document.createTextNode(lines[i]));
    }
    tooltip.style.opacity = "0";
    tooltip.setAttribute("role", "tooltip");
    el.setAttribute("aria-describedby", tooltip.id);
    const arrow = document.createElement("div");
    arrow.className = "tooltip-arrow";
    tooltip.appendChild(arrow);
    tooltips.appendChild(tooltip);
    [
      ["mouseenter", showTooltip],
      ["mouseleave", hideTooltip],
      ["focus", showTooltip],
      ["blur", hideTooltip],
      ["click", toggleTooltip],
    ].forEach(([event, listener]) => {
      el.addEventListener(event, listener);
    });
  },
);
document.body.appendChild(tooltips);
