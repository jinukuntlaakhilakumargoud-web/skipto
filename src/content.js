// The panel on YouTube watch pages: ask a question, jump to the answer, light up the progress bar.
// Only works on videos that have a transcript: it reads YouTube's own "Show transcript" panel.
(() => {
  const SVG = "http://www.w3.org/2000/svg";
  const TRANSCRIPT_PANEL = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
  const cache = new Map(); // video id -> caption events
  let panel, heat;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clock = (s) => {
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  };
  const seconds = (stamp) => stamp.trim().split(":").reduce((a, x) => a * 60 + Number(x), 0);
  // No innerHTML anywhere: YouTube enforces Trusted Types.
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const video = () => document.querySelector("video.html5-main-video") || document.querySelector("video");
  // The <video> element's duration is sometimes NaN while YouTube streams, so fall back to the player's label.
  const duration = (fallback = Infinity) => {
    const d = video()?.duration;
    if (Number.isFinite(d) && d > 0) return d;
    const label = document.querySelector(".ytp-time-duration")?.textContent;
    return label ? seconds(label) : fallback;
  };

  function logo() {
    const box = el("span", "skipto-logo");
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    for (const d of ["M3 5v14l8-7z", "M11 5v14l8-7z", "M19 5h2.4v14H19z"]) {
      const p = document.createElementNS(SVG, "path");
      p.setAttribute("d", d);
      svg.append(p);
    }
    box.append(svg);
    return box;
  }

  async function readTranscript(status) {
    const v = new URL(location.href).searchParams.get("v");
    if (cache.has(v)) return cache.get(v);
    const show = document.querySelector("ytd-video-description-transcript-section-renderer button");
    if (!show) throw new Error("This video has no transcript, so Skipto can't search it.");

    const wasOpen = document.querySelector(TRANSCRIPT_PANEL)?.getAttribute("visibility") === "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED";
    if (!wasOpen) show.click();
    const length = duration();
    let rows = [], hidden;
    // YouTube only loads the transcript while the tab is on screen, so time spent hidden doesn't count
    // toward the ~12 s limit, and the panel says why it's waiting.
    for (let waited = 0; waited < 12_000; ) {
      rows = [...(document.querySelector(TRANSCRIPT_PANEL)?.querySelectorAll("ytd-transcript-segment-renderer") ?? [])];
      const last = rows.at(-1)?.querySelector(".segment-timestamp")?.textContent;
      if (rows.length && last && seconds(last) <= length + 30) break; // ignore a previous video's transcript
      rows = [];
      if (hidden !== document.hidden) {
        hidden = document.hidden;
        status(hidden ? "Waiting for this tab to be on screen (YouTube only loads transcripts while visible)…" : "Reading the transcript…");
      }
      if (!hidden) waited += 150;
      await sleep(150);
    }
    if (!wasOpen) document.querySelector(TRANSCRIPT_PANEL)?.querySelector("#visibility-button button")?.click();
    if (!rows.length) throw new Error("Couldn't load the transcript. Try again in a moment.");

    const starts = rows.map((r) => seconds(r.querySelector(".segment-timestamp")?.textContent || "0"));
    const events = rows.map((r, i) => ({
      start: starts[i],
      dur: (starts[i + 1] ?? starts[i] + 5) - starts[i],
      text: r.querySelector(".segment-text")?.textContent || "",
    }));
    cache.set(v, events);
    return events;
  }

  function seek(t) {
    const v = video();
    if (!v) return;
    v.currentTime = t;
    v.play().catch(() => {});
  }

  function paintHeat(result, best) {
    heat?.remove();
    const bar = document.querySelector(".ytp-progress-bar-container");
    const length = duration(result.heat.at(-1)?.end);
    if (!bar || !length) return;
    const max = Math.max(...result.heat.map((h) => h.p)) || 1;
    const stops = result.heat.map((h) => {
      const a = Math.min(1, (h.p / max) * 1.2).toFixed(3);
      return `rgba(255, 184, 0, ${a}) ${((h.start / length) * 100).toFixed(2)}% ${((h.end / length) * 100).toFixed(2)}%`;
    });
    heat = el("div", "skipto-heat");
    heat.style.background = `linear-gradient(to right, transparent 0%, ${stops.join(", ")}, transparent 100%)`;
    const tip = el("span", "skipto-tip", clock(best.start));
    tip.style.left = `${(best.start / length) * 100}%`;
    heat.append(tip);
    bar.appendChild(heat);
  }

  function chart(result) {
    const box = el("div", "skipto-chart");
    const head = el("div", "skipto-chart-head");
    const title = el("span");
    title.append(el("b", null, result.offline ? "Keyword match" : "Jev's answer"), ` · score for each of ${result.heat.length} windows`);
    const calls = `${result.requests} call${result.requests > 1 ? "s" : ""} · ${result.requests * 2} questions`;
    head.append(title, el("span", null, result.offline ? "free · runs in your browser" : calls));
    const bars = el("div", "skipto-bars");
    const max = Math.max(...result.heat.map((h) => h.p)) || 1;
    const top = result.top[0];
    for (const h of result.heat) {
      const b = el("span", h === result.heat.find((x) => x.start === top?.start) ? "hot" : h.p / max > 0.06 ? "warm" : "");
      b.style.height = `${Math.max(2, (h.p / max) * 100)}%`;
      b.title = `${clock(h.start)} · ${Math.round(h.p * 100)}%`;
      b.onclick = () => seek(h.start);
      bars.append(b);
    }
    const end = duration(result.heat.at(-1)?.end || 0);
    const axis = el("div", "skipto-axis");
    for (const f of [0, 0.25, 0.5, 0.75, 1]) axis.append(el("span", null, clock(end * f)));
    box.append(head, bars, axis);
    return box;
  }

  function render(out, result) {
    out.replaceChildren();
    const best = result.top[0];
    if (!best) return out.append(el("p", "skipto-verdict", "No moment stood out. Try rephrasing."));

    const verdict = el("p", `skipto-verdict skipto-${result.verdict}`);
    if (result.verdict === "found") verdict.append(`✓ Answered at ${clock(best.start)}`, el("small", null, " · jumped there automatically"));
    else if (result.verdict === "partial") verdict.append(`Partly covered around ${clock(best.start)}`);
    else verdict.append(`Not in this video. Closest moment: ${clock(best.start)}`);

    const list = el("div", "skipto-moments");
    for (const m of result.top) {
      const b = el("button", "skipto-moment");
      b.type = "button";
      b.append(el("span", "skipto-time", clock(m.start)), el("span", "skipto-text", `"…${m.text}…"`), el("span", "skipto-p", `${Math.round(m.p * 100)}%`));
      b.onclick = () => seek(m.start);
      list.append(b);
    }
    const meta = el("p", "skipto-meta");
    if (result.offline) {
      const link = el("button", "skipto-link", "Add a Jev key for smarter answers");
      link.type = "button";
      link.onclick = () => chrome.runtime.sendMessage({ type: "settings" });
      meta.append(`Offline keyword mode · ${result.ms} ms · matches words, not meaning `, link);
    } else {
      const cost = (result.tokens * 0.042e-6).toFixed(5);
      meta.append(`${result.ms} ms · ${result.tokens.toLocaleString()} tokens (≈ $${cost}) · ${result.model}`);
    }
    out.append(verdict, chart(result), list, meta);
    paintHeat(result, best);
    if (result.verdict === "found") seek(best.start);
  }

  async function ask(question, out, button) {
    button.disabled = true;
    const status = (text) => out.replaceChildren(el("p", "skipto-status", text));
    status("Reading the transcript…");
    try {
      const events = await readTranscript(status);
      out.replaceChildren(el("p", "skipto-status", "Finding the moment…"));
      const result = await chrome.runtime.sendMessage({ type: "ask", question, events });
      if (result.error) {
        out.replaceChildren(el("p", "skipto-error", result.error));
      } else {
        render(out, result);
      }
    } catch (e) {
      out.replaceChildren(el("p", "skipto-error", e.message));
    } finally {
      button.disabled = false;
    }
  }

  function mount() {
    panel?.remove();
    heat?.remove();
    if (location.pathname !== "/watch") return;
    panel = el("section", "skipto");
    const form = el("form", "skipto-form");
    const input = el("input", "skipto-input");
    input.type = "text";
    input.placeholder = "Ask this video anything…";
    input.setAttribute("aria-label", "Ask this video");
    const button = el("button", "skipto-go", "Jump");
    button.type = "submit";
    const out = el("div", "skipto-out");
    form.append(logo(), input, button);
    form.onsubmit = (e) => {
      e.preventDefault();
      if (input.value.trim()) ask(input.value.trim(), out, button);
    };
    panel.append(form, out);
    // Directly under the player, full width; fall back to the sidebar, then a floating card.
    const host = document.querySelector("ytd-watch-flexy #below") || document.querySelector("#secondary-inner");
    if (host) host.prepend(panel);
    else {
      panel.classList.add("skipto-floating");
      document.body.append(panel);
    }
  }

  // YouTube is a single-page app: re-mount on every navigation.
  document.addEventListener("yt-navigate-finish", mount);
  mount();
})();
