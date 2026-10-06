import assert from "node:assert/strict";
import test from "node:test";

import { ABSENT, FOUND, MAX_OPTIONS, chunks, clock, combine, id, request, windows } from "../src/core.js";

const ev = (start, text, dur = 4) => ({ start, dur, text });

// A fake System One response: `where` puts `probs` on the given ids, `covered` is the Noul value.
const answer = (probs, covered, tokens = 1000) => ({
  model: "fake-1",
  usage: { input_tokens: tokens },
  answers: { where: { probabilities: probs }, covered: { noul: covered } },
});

test("clock formats minutes and hours", () => {
  assert.equal(clock(5), "0:05");
  assert.equal(clock(754.9), "12:34");
  assert.equal(clock(3725), "1:02:05");
});

test("windows merge caption events into ~30 second windows and skip blanks", () => {
  const w = windows([ev(0, "hello"), ev(10, " there\n"), ev(29, "friend"), ev(31, "next"), ev(40, "  ")]);
  assert.deepEqual(w.map((x) => [x.start, x.text]), [[0, "hello there friend"], [31, "next"]]);
  assert.equal(w[0].end, 33);
});

test("chunks respect the option limit and the character budget", () => {
  const many = Array.from({ length: MAX_OPTIONS + 10 }, (_, i) => ({ start: i * 30, end: i * 30 + 30, text: "x" }));
  assert.deepEqual(chunks(many).map((c) => c.length), [MAX_OPTIONS, 10]);
  const long = Array.from({ length: 4 }, (_, i) => ({ start: i, end: i, text: "y".repeat(40_000) }));
  assert.deepEqual(chunks(long).map((c) => c.length), [2, 2]);
});

test("request tags every window and asks a Choice plus a Noul in one call", () => {
  const body = request([{ start: 0, text: "intro" }, { start: 65, text: "the answer" }], "what is it?", "jev-latest");
  assert.equal(body.state, "W000| [0:00] intro\nW001| [1:05] the answer");
  assert.deepEqual(body.questions.where.criteria, { W000: null, W001: null });
  assert.match(body.questions.where.instructions, /"what is it\?"/);
  assert.equal(body.questions.covered.type, "noul");
  assert.equal(body.model, "jev-latest");
});

test("combine ranks moments and reads the verdict from the Noul", () => {
  const part = [{ start: 0, end: 30, text: "a" }, { start: 30, end: 60, text: "b" }, { start: 60, end: 90, text: "c" }];
  const res = combine([part], [answer({ W000: 0.05, W001: 0.9, W002: 0.05 }, 0.95)]);
  assert.equal(res.verdict, "found");
  assert.equal(res.top[0].start, 30);
  assert.ok(Math.abs(res.top[0].p - 0.9) < 1e-9);
  assert.equal(res.heat.length, 3);
  assert.equal(res.tokens, 1000);
  assert.equal(combine([part], [answer({ W001: 1 }, ABSENT - 0.01)]).verdict, "absent");
  assert.equal(combine([part], [answer({ W001: 1 }, (FOUND + ABSENT) / 2)]).verdict, "partial");
});

test("a confident chunk outranks a weak chunk's best guess", () => {
  const first = [{ start: 0, end: 30, text: "a" }], second = [{ start: 600, end: 630, text: "b" }];
  const res = combine([first, second], [answer({ [id(0)]: 1 }, 0.1), answer({ [id(0)]: 1 }, 0.9)]);
  assert.equal(res.top[0].start, 600);
  assert.equal(res.requests, 2);
  assert.equal(res.tokens, 2000);
});
