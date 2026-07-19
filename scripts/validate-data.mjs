#!/usr/bin/env node
// validate-data.mjs — data-integrity guard for the JSON the MCP server serves.
// Enforces the invariants the pipeline guarantees and emits a truthful
// conflicts/conflict-report.json. Exits non-zero on any HARD failure so CI blocks
// a regression (split-brain ids, PII leak, stale indexes, broken/empty core files).
//
// Run: node scripts/validate-data.mjs
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));

function findRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, "phases/phase-1-packages/output/packages.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("repo root (with phases/) not found from " + start);
}
const ROOT = findRoot(HERE);

const hard = []; // blocking failures
const soft = []; // recorded conflicts / warnings
const ok = [];
const FAIL = (m) => hard.push(m);
const WARN = (m) => soft.push(m);
const PASS = (m) => ok.push(m);

function readJSON(rel) {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) return { __missing: true };
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch (e) {
    return { __invalid: e.message };
  }
}

// ── 1. Served files exist, parse, and carry required keys ────────────────────
const REQUIRED = {
  "phases/phase-1-packages/output/packages.json": ["packages"],
  "phases/phase-1-packages/output/package-sources.json": ["entities"],
  "phases/phase-2-trust/output/trust-claims.json": ["trust_claims"],
  "phases/phase-2-trust/output/policies.json": ["policies"],
  "phases/phase-4-booking/output/booking-aggregates.json": ["booking_aggregates", "analytics"],
  "phases/phase-5-index/indexes/search-index.json": ["documents"],
  "phases/phase-5-index/indexes/entity-graph.json": ["nodes", "edges"],
  "phases/phase-5-index/indexes/rag-chunks.json": ["chunks"],
};
const data = {};
for (const [rel, keys] of Object.entries(REQUIRED)) {
  const d = readJSON(rel);
  data[rel] = d;
  if (d.__missing) { FAIL(`missing file: ${rel}`); continue; }
  if (d.__invalid) { FAIL(`invalid JSON: ${rel} — ${d.__invalid}`); continue; }
  const missing = keys.filter((k) => !(k in d));
  if (missing.length) FAIL(`${rel}: missing key(s) ${missing.join(", ")}`);
  else PASS(`${rel}: valid + required keys present`);
}

const packages = data["phases/phase-1-packages/output/packages.json"].packages ?? [];
const validIds = new Set(packages.map((p) => p.packageId));
const catalogGen = data["phases/phase-1-packages/output/packages.json"].generated_at ?? "";

// ── 2. Core datasets non-empty (silent-empty guard) ──────────────────────────
for (const [rel, arrKey] of [
  ["phases/phase-1-packages/output/packages.json", "packages"],
  ["phases/phase-2-trust/output/trust-claims.json", "trust_claims"],
  ["phases/phase-2-trust/output/policies.json", "policies"],
  ["phases/phase-4-booking/output/booking-aggregates.json", "booking_aggregates"],
  ["phases/phase-5-index/indexes/search-index.json", "documents"],
  ["phases/phase-5-index/indexes/entity-graph.json", "nodes"],
]) {
  const arr = data[rel]?.[arrKey];
  if (Array.isArray(arr) && arr.length === 0) FAIL(`${rel}: '${arrKey}' is empty`);
}

// ── 3. Referential integrity: every INDEX package id resolves to a packageId ──
function pkgRefs(rel, kind) {
  const d = data[rel];
  if (!d || d.__missing || d.__invalid) return;
  let ids = [];
  if (kind === "graph") ids = (d.nodes ?? []).filter((n) => n.type === "package").map((n) => n.id);
  else if (kind === "search") ids = (d.documents ?? []).filter((x) => x.type === "package").map((x) => x.id);
  else ids = (d.chunks ?? []).filter((c) => c.entity_type === "package").map((c) => c.entity_id);
  const dangling = ids.filter((i) => !validIds.has(i));
  if (dangling.length) FAIL(`${rel}: ${dangling.length}/${ids.length} package refs do not resolve to packages.json (e.g. ${dangling.slice(0, 3).join(", ")})`);
  else PASS(`${rel}: all ${ids.length} package refs resolve`);
}
pkgRefs("phases/phase-5-index/indexes/entity-graph.json", "graph");
pkgRefs("phases/phase-5-index/indexes/search-index.json", "search");
pkgRefs("phases/phase-5-index/indexes/rag-chunks.json", "rag");

// booking package_id_inferred should resolve (soft — heuristic backfill)
const bookings = data["phases/phase-4-booking/output/booking-aggregates.json"].booking_aggregates ?? [];
const inferred = bookings.map((b) => b.package_id_inferred).filter((x) => x != null);
const badInferred = inferred.filter((x) => !validIds.has(x));
if (badInferred.length) FAIL(`booking package_id_inferred: ${badInferred.length} value(s) do not resolve to packages.json`);
else if (inferred.length) PASS(`booking package_id_inferred: all ${inferred.length} resolve`);

// ── 4. Staleness: index generated_at >= packages generated_at ────────────────
const catalogTime = Date.parse(catalogGen);
for (const rel of [
  "phases/phase-5-index/indexes/search-index.json",
  "phases/phase-5-index/indexes/entity-graph.json",
  "phases/phase-5-index/indexes/rag-chunks.json",
]) {
  const g = data[rel]?.generated_at;
  const t = Date.parse(g ?? "");
  if (!Number.isNaN(catalogTime) && !Number.isNaN(t) && t < catalogTime) {
    FAIL(`${rel}: stale (generated_at ${g} < packages ${catalogGen}) — rebuild indexes`);
  } else if (!Number.isNaN(t)) {
    PASS(`${rel}: not stale`);
  }
}

// ── 5. PII scan on booking output ────────────────────────────────────────────
const bookingRaw = existsSync(resolve(ROOT, "phases/phase-4-booking/output/booking-aggregates.json"))
  ? readFileSync(resolve(ROOT, "phases/phase-4-booking/output/booking-aggregates.json"), "utf-8")
  : "";
const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
if (emailRe.test(bookingRaw)) FAIL("booking-aggregates.json contains an email address (PII)");
const piiKeys = ["name", "email", "phone", "passport", "whatsapp",
  "customer_name", "customer_phone", "customer_email", "address"];
const leaked = new Set();
for (const b of bookings) for (const k of piiKeys) if (k in b) leaked.add(k);
if (leaked.size) FAIL(`booking record(s) expose PII field(s): ${[...leaked].join(", ")}`);
else PASS(`booking output: no PII fields / emails (scanned ${bookings.length} records)`);

// ── 6. Compute the truthful conflict report (recorded, mostly soft) ──────────
const conflicts = [];
// malformed packageIds
const malformed = packages.map((p) => p.packageId).filter((id) => !/^package-[A-Z]+-\d+D\d+N-\d+$/.test(id));
if (malformed.length) {
  WARN(`malformed packageId(s): ${malformed.join(", ")}`);
  conflicts.push({ type: "malformed_package_id", severity: "low", ids: malformed, detail: "packageId breaks the package-<ORIGIN>-<DUR>-NNN convention" });
}
// orphan source entities (no package via slug tail)
const tail = (s) => String(s ?? "").replace(/\/+$/, "").split("/").pop();
const pkgTails = new Set(packages.map((p) => tail(p.product?.slug)));
const sources = data["phases/phase-1-packages/output/package-sources.json"].entities ?? [];
const orphanSources = sources.filter((e) => !pkgTails.has(tail(e.entity_id)));
if (orphanSources.length) {
  WARN(`${orphanSources.length}/${sources.length} source entities have no matching package (superseded slug world)`);
  conflicts.push({ type: "orphan_source_entities", severity: "medium", count: orphanSources.length, of: sources.length, detail: "package-sources.json still carries the pre-regeneration 35-entity slug set; these do not map to the 16 published packages" });
}
// cost_total=0 => profit==revenue
const zeroCost = bookings.filter((b) => (b.cost_total ?? 0) === 0).length;
if (bookings.length && zeroCost === bookings.length) {
  WARN(`cost_total=0 for all ${bookings.length} bookings → profit_estimate == gross_revenue (false 100% margin)`);
  conflicts.push({ type: "cost_total_zero", severity: "high", count: bookings.length, detail: "get_booking_analytics reports revenue mislabeled as profit; needs real expense data from source (phase-4 extract.py)" });
}
// booking package_id all null (real FK missing; only heuristic inferred exists)
const realPkg = bookings.filter((b) => b.package_id != null).length;
if (bookings.length && realPkg === 0) {
  conflicts.push({ type: "booking_package_id_null", severity: "high", count: bookings.length, detail: "real booking↔package FK is null on all rows; only heuristic package_id_inferred exists — run phase-4 extract.py against the live DB" });
}

// ── Write conflict report ────────────────────────────────────────────────────
const report = {
  generated_at: catalogGen || "unknown",
  generator: "scripts/validate-data.mjs",
  total_conflicts: conflicts.length,
  conflicts,
  notes: [
    "Reconciled, computed report. Supersedes phases/phase-1-packages/output/package-conflicts.json.",
    `Validated ${packages.length} packages, ${bookings.length} bookings.`,
  ],
};
mkdirSync(resolve(ROOT, "conflicts"), { recursive: true });
writeFileSync(resolve(ROOT, "conflicts/conflict-report.json"), JSON.stringify(report, null, 2) + "\n");

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(64)}`);
console.log(`validate-data: ${ok.length} checks passed, ${soft.length} recorded conflict(s), ${hard.length} HARD failure(s)`);
for (const m of ok) console.log(`  ✅ ${m}`);
for (const m of soft) console.log(`  ⚠️  ${m}`);
for (const m of hard) console.log(`  ❌ ${m}`);
console.log(`conflict-report.json written: ${conflicts.length} conflict(s).`);
process.exit(hard.length > 0 ? 1 : 0);
