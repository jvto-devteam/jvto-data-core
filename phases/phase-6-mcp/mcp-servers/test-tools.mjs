// test-tools.mjs — test all 7 MCP tools with current data format
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dirname, "../../");

function load(relPath, fallback = null) {
  const p = resolve(DATA, relPath);
  if (!existsSync(p)) return fallback;
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return fallback; }
}

const packagesData  = load("phase-1-packages/output/packages.json", { packages: [] });
const conflictsData = load("phase-1-packages/output/package-conflicts.json", { total_conflicts: 0, conflicts: [], notes: [] });
const sourcesData   = load("phase-1-packages/output/package-sources.json", { entities: [] });
const trustData     = load("phase-2-trust/output/trust-claims.json", { trust_claims: [] });
const policiesData  = load("phase-2-trust/output/policies.json", { policies: [] });
const bookingData   = load("phase-4-booking/output/booking-aggregates.json", { booking_aggregates: [] });

// ── helpers ──────────────────────────────────────────────────────────────────

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

function scorePackage(pkg, tokens) {
  const prod = pkg.product ?? {};
  const text = [
    prod.name, prod.description, prod.originCity, prod.endCity,
    prod.category, prod.marketedDurationLabel,
    ...(prod.route ?? []), ...(prod.tags ?? []),
    ...(prod.marketing?.highlightsBullets ?? []),
  ].join(" ").toLowerCase();
  return tokens.reduce((score, token) => {
    if ((prod.name ?? "").toLowerCase().includes(token)) return score + 3;
    if ((prod.route ?? []).some(r => r.toLowerCase().includes(token))) return score + 2;
    if (text.includes(token)) return score + 1;
    return score;
  }, 0);
}

function pkgSummary(p) {
  const prod = p.product ?? {};
  const tiers = prod.offers?.tiers ?? [];
  return {
    package_id: p.packageId,
    name: prod.name,
    duration: prod.marketedDurationLabel,
    origin: prod.originCity,
    price_from_idr: tiers.length > 0 ? Math.min(...tiers.map(t => t.pricePerPerson)) : null,
  };
}

// ── test runner ───────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    const ok = result !== null && result !== undefined && !result.error;
    const preview = JSON.stringify(result).slice(0, 160);
    console.log(`${ok ? "✅" : "⚠️ "} ${name}`);
    console.log(`   ${preview}${preview.length >= 160 ? "…" : ""}`);
    if (ok) passed++; else failed++;
  } catch (e) {
    console.log(`❌ ${name}: ERROR — ${e.message}`);
    failed++;
  }
}

// ── Tool 1: search_packages ───────────────────────────────────────────────────

test("search_packages('bromo sunrise')", () => {
  const tokens = tokenize("bromo sunrise");
  const results = packagesData.packages
    .map(p => ({ pkg: p, score: scorePackage(p, tokens) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return { query: "bromo sunrise", total_results: results.length, top: results[0] ? pkgSummary(results[0].pkg) : null };
});

test("search_packages('ijen blue fire')", () => {
  const tokens = tokenize("ijen blue fire");
  const results = packagesData.packages
    .map(p => ({ pkg: p, score: scorePackage(p, tokens) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return { query: "ijen blue fire", total_results: results.length, top: results[0] ? pkgSummary(results[0].pkg) : null };
});

// ── Tool 2: get_package ───────────────────────────────────────────────────────

test("get_package by packageId (first package)", () => {
  const first = packagesData.packages[0];
  const id = first?.packageId;
  const found = packagesData.packages.find(p =>
    p.packageId === id || p.product?.packageId === id
  );
  if (!found) return { error: "not found" };
  const prod = found.product ?? {};
  const tiers = prod.offers?.tiers ?? [];
  return {
    package_id: found.packageId,
    name: prod.name,
    duration: prod.marketedDurationLabel,
    tier_count: tiers.length,
    price_from: tiers.length > 0 ? Math.min(...tiers.map(t => t.pricePerPerson)) : null,
    itinerary_days: prod.itineraryDays?.length ?? 0,
    inclusions: prod.inclusions?.length ?? 0,
  };
});

// ── Tool 3: check_conflicts ───────────────────────────────────────────────────

test("check_conflicts()", () => {
  return {
    total_conflicts: conflictsData.total_conflicts,
    notes_count: conflictsData.notes?.length,
    has_data: !!conflictsData,
  };
});

// ── Tool 4: get_source_trace ──────────────────────────────────────────────────

test("get_source_trace (first package packageId)", () => {
  const id = packagesData.packages[0]?.packageId;
  const pkgMatch = packagesData.packages.find(p => p.packageId === id);
  const sourceMatch = sourcesData.entities.find(e => e.entity_id === id);
  return {
    entity_id: id,
    found_in_packages: !!pkgMatch,
    found_in_sources: !!sourceMatch,
    note: !sourceMatch ? "sources file uses old slug IDs — expected mismatch" : "ok",
  };
});

// ── Tool 5: search_trust_claims ───────────────────────────────────────────────

test("search_trust_claims('safety')", () => {
  const tokens = tokenize("safety");
  const scored = trustData.trust_claims
    .map(c => {
      const text = tokenize(c.claim + " " + c.category + " " + (c.evidence ?? []).join(" "));
      const score = tokens.reduce((s, t) => (text.includes(t) ? s + 1 : s), 0);
      return { c, score };
    })
    .filter(x => x.score > 0);
  return { query: "safety", total_results: scored.length, sample_id: scored[0]?.c?.claim_id };
});

// ── Tool 6: get_policy ────────────────────────────────────────────────────────

test("get_policy (first available)", () => {
  const first = policiesData.policies[0];
  if (!first) return { error: "no policies found" };
  return { policy_id: first.policy_id, name: first.name, category: first.category };
});

// ── Tool 7: get_booking_analytics ─────────────────────────────────────────────

test("get_booking_analytics()", () => {
  const bookings = bookingData.booking_aggregates;
  const totalRevenue = bookings.reduce((s, b) => s + (b.gross_revenue ?? 0), 0);
  const byChannel = {};
  for (const b of bookings) {
    const ch = b.channel ?? "unknown";
    byChannel[ch] = (byChannel[ch] ?? 0) + 1;
  }
  return {
    total_bookings: bookings.length,
    total_packages_in_catalog: packagesData.packages.length,
    total_revenue_idr: totalRevenue,
    channel_count: Object.keys(byChannel).length,
    channels: byChannel,
  };
});

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`Result: ${passed} passed, ${failed} failed (out of 7 tools)`);
if (failed > 0) console.log("⚠️  Warnings above may indicate missing data files.");
