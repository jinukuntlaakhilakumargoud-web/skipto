// Pure logic shared by the extension and the tests: captions -> windows -> one request per chunk -> moments.
//
// The transcript goes in `state` as tagged lines ("W012| [6:00] ..."). One Choice question picks the
// line that answers, and a Noul in the same request says whether the video answers at all: Choice
// probabilities always sum to 1, so some line always "wins" even when nothing is relevant.

export const WINDOW_S = 30;          // seconds of speech per option
export const MAX_OPTIONS = 250;      // a Choice accepts at most 255 options
export const MAX_CHARS = 90_000;     // ~22k tokens of transcript per request; Jev allows 32k for state + question
export const FOUND = 0.7;            // covered >= FOUND: answered; below ABSENT: not in this video
export const ABSENT = 0.35;

export const id = (i) => "W" + String(i).padStart(3, "0");

export function clock(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// Caption events ({start, dur, text} in seconds) merged into windows of about `size` seconds.
export function windows(events, size = WINDOW_S) {
  const out = [];
  for (const e of events) {
    const text = e.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const last = out.at(-1);
    if (last && e.start - last.start < size) {
      last.text += " " + text;
      last.end = e.start + e.dur;
    } else {
      out.push({ start: e.start, end: e.start + e.dur, text });
    }
  }
  return out;
}

// Long videos are split so every request stays inside the option and context limits.
export function chunks(wins) {
  const out = [];
  let cur = [], chars = 0;
  for (const w of wins) {
    if (cur.length && (cur.length === MAX_OPTIONS || chars + w.text.length > MAX_CHARS)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(w);
    chars += w.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function request(chunk, question, model) {
  return {
    model,
    state: chunk.map((w, i) => `${id(i)}| [${clock(w.start)}] ${w.text}`).join("\n"),
    questions: {
      where: {
        type: "choice",
        instructions: `Which line of the video transcript answers: "${question}"?`,
        criteria: Object.fromEntries(chunk.map((_, i) => [id(i), null])),
      },
      covered: {
        type: "noul",
        instructions: `Does any line of the video transcript address or answer: "${question}"?`,
        criteria: {
          true: "At least one line states or directly implies the answer",
          false: "No line of the transcript addresses this",
        },
      },
    },
  };
}

// Each window's score is its share of its chunk's Choice times that chunk's "covered" probability,
// so a strong answer in one half of a long video outranks the best guess in the other half.
export function combine(parts, responses) {
  const moments = [];
  let covered = 0, tokens = 0;
  parts.forEach((chunk, c) => {
    const { where, covered: cov } = responses[c].answers;
    covered = Math.max(covered, cov.noul);
    tokens += responses[c].usage?.input_tokens ?? 0;
    chunk.forEach((w, i) => moments.push({ ...w, score: (where.probabilities[id(i)] ?? 0) * cov.noul }));
  });
  const total = moments.reduce((a, m) => a + m.score, 0) || 1;
  for (const m of moments) m.p = m.score / total;
  return {
    verdict: covered >= FOUND ? "found" : covered < ABSENT ? "absent" : "partial",
    covered,
    top: [...moments].sort((a, b) => b.p - a.p).slice(0, 3).filter((m) => m.p >= 0.02),
    heat: moments.map(({ start, end, p }) => ({ start, end, p })),
    model: responses[0]?.model,
    requests: responses.length,
    tokens,
  };
}
