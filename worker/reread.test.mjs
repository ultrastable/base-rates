// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The source re-read step: what each outcome is, which entries are re-read first, the 7-day measure, and the beat and endpoints against the real router.
import test from "node:test";
import assert from "node:assert/strict";
import { readSource, readEntry, due, measure } from "./reread.js";
import { handle, beat } from "./index.js";
import { ENTRIES } from "./entries.js";
import { d1 } from "./worker.test.mjs";

const HOUR = 3600000, now = Date.UTC(2026, 10, 28, 6);
const entry = { id: "x", summary: "About 45 percent of new firms survive five years.", sources: [{ doi: "10.1/x", title: "T", year: 2020 }] };
const reply = (status, message) => async () => new Response(JSON.stringify({ message }), { status });

test("a source whose abstract still holds the quote is unchanged, one that dropped it is changed", async () => {
  assert.equal((await readSource(entry, entry.sources[0], reply(200, { abstract: "<p>We find. About 45 percent of new firms survive five years. More.</p>" }))).status, "unchanged");
  assert.equal((await readSource(entry, entry.sources[0], reply(200, { abstract: "A different abstract." }))).status, "changed");
});
test("a retraction, a missing DOI and an outage are each said, and an outage is not a re-read", async () => {
  assert.equal((await readSource(entry, entry.sources[0], reply(200, { abstract: "x", "updated-by": [{ type: "retraction" }] }))).status, "retracted");
  assert.equal((await readSource(entry, entry.sources[0], reply(404, {}))).status, "gone");
  assert.equal((await readSource(entry, entry.sources[0], reply(503, {}))).status, "unreachable");
  assert.equal((await readSource(entry, entry.sources[0], async () => { throw new Error("boom"); })).status, "unreachable");
});
test("an entry takes the worst result of its sources", async () => {
  const two = { ...entry, sources: [entry.sources[0], { doi: "10.1/y", title: "U", year: 2021 }] };
  let n = 0; const f = async () => new Response(JSON.stringify({ message: n++ ? { abstract: "other" } : { abstract: entry.summary } }), { status: 200 });
  assert.equal((await readEntry(two, f)).status, "changed");
});
test("entries never re-read come first, then the least recently tried; the measure counts only conclusive re-reads inside seven days", () => {
  const es = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(due(es, [{ id: "a", at: 5 }, { id: "c", at: 1 }], 2).map(e => e.id), ["b", "c"]);
  const rows = [{ id: "a", at: now - HOUR, status: "unchanged" }, { id: "b", at: now - 8 * 24 * HOUR, status: "unchanged" }, { id: "c", at: now - HOUR, status: "unreachable" }];
  assert.deepEqual(measure(es, rows, now), { fresh: 1, of: 3, share: 0.333, within_days: 7 });
});
test("each beat re-reads the oldest entries, records them, and the endpoints and health report the share", async () => {
  const env = { DB: d1(), FETCH: async (url) => new Response(JSON.stringify({ message: { abstract: ENTRIES.map(e => e.summary).join(" ") } }), { status: 200 }) };
  for (let i = 0; i < Math.ceil(ENTRIES.length / 2); i++) await beat(env, now + i * HOUR);
  const at = now + 5 * HOUR;
  const r = await (await handle(new Request("https://t.test/api/rereads"), env, at)).json();
  assert.equal(r.of, ENTRIES.length); assert.equal(r.fresh, ENTRIES.length); assert.equal(r.share, 1);
  assert.ok(r.entries.every(e => e.status === "unchanged"));
  const h = await (await handle(new Request("https://t.test/health"), env, at)).json();
  assert.equal(h.reread.share, 1);
  const b = await (await handle(new Request("https://t.test/api/beats"), env, at)).json();
  assert.match(b.beats[0].note, /^re-read /);
});
