// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The loop's work on each published entry (IDEA.md, System test): re-read its source and say what it now shows. Measure: the share of entries
// whose source was re-read conclusively within 7 days, target 1.0. Plain fetch, no dependency; every outcome is a stored row, never a guess.
export const REREAD_PER_BEAT = 2, FRESH_DAYS = 7;
export const CONCLUSIVE = new Set(["unchanged", "changed", "retracted", "gone"]);
const clean = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// One source of one entry against Crossref. unchanged: the quoted sentence is still in the abstract. changed: the record answers but the sentence
// is not in it. retracted: Crossref lists a retraction or withdrawal. gone: the DOI no longer resolves. unreachable: no answer (not a re-read).
export async function readSource(entry, source, doFetch = fetch) {
  try {
    const r = await doFetch("https://api.crossref.org/works/" + encodeURIComponent(source.doi), { headers: { "user-agent": "base-rates (https://github.com/ultrastable/base-rates)" }, signal: AbortSignal.timeout(8000) });
    if (r.status === 404) return { status: "gone", detail: "Crossref no longer has " + source.doi };
    if (!r.ok) return { status: "unreachable", detail: "Crossref answered " + r.status };
    const m = (await r.json()).message || {};
    const upd = [].concat(m["updated-by"] || []).find(u => /retract|withdraw/i.test(u.type || u.label || ""));
    if (upd) return { status: "retracted", detail: "Crossref lists a " + (upd.type || upd.label) + " of " + source.doi };
    const quote = clean(entry.summary);
    return clean(m.abstract).includes(quote) ? { status: "unchanged", detail: "the quoted sentence is in the abstract" } : { status: "changed", detail: "the quoted sentence is no longer in the abstract of " + source.doi };
  } catch (e) { return { status: "unreachable", detail: String((e && e.message) || e).slice(0, 120) }; }
}

// An entry's result is the worst of its sources: retracted, gone, changed, unreachable, then unchanged.
const ORDER = ["retracted", "gone", "changed", "unreachable", "unchanged"];
export async function readEntry(entry, doFetch) {
  const rs = [];
  for (const s of entry.sources || []) rs.push(await readSource(entry, s, doFetch));
  rs.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  return rs[0] || { status: "unreachable", detail: "the entry names no source" };
}

// Entries never re-read first, then the least recently tried.
export function due(entries, rows, n = REREAD_PER_BEAT) {
  const at = new Map(rows.map(r => [r.id, r.at]));
  return [...entries].sort((a, b) => (at.get(a.id) ?? -1) - (at.get(b.id) ?? -1)).slice(0, n);
}

export function measure(entries, rows, now, days = FRESH_DAYS) {
  const byId = new Map(rows.map(r => [r.id, r]));
  const fresh = entries.filter(e => { const r = byId.get(e.id); return r && CONCLUSIVE.has(r.status) && now - r.at <= days * 24 * 3600000; }).length;
  return { fresh, of: entries.length, share: entries.length ? Math.round((fresh / entries.length) * 1000) / 1000 : null, within_days: days };
}
