// test-tools.mjs — test all 7 MCP tools without starting the server
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dirname, "../../");

function load(relPath) {
  return JSON.parse(readFileSync(resolve(DATA, relPath), "utf-8"));
}

// Load data
const packagesData   = load("phase-1-packages/output/packages.json");
const conflictsData  = load("phase-1-packages/output/package-conflicts.json");
const sourcesData    = load("phase-1-packages/output/package-sources.json");
const trustData      = load("phase-2-trust/output/trust-claims.json");
const policiesData   = load("phase-2-trust/output/policies.json");
const bookingData    = load("phase-4-booking/output/booking-aggregates.json");
const searchIndex    = load("phase-5-index/indexes/search-index.json");
const entityGraph    = load("phase-5-index/indexes/entity-graph.json");

// Helpers
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}
function scoreDoc(doc, queryTokens) {
  const contentTokens = tokenize(doc.content + " " + doc.keywords.join(" ") + " " + doc.title);
  return queryTokens.reduce((score, token) => {
    if (doc.title.toLowerCase().includes(token)) return score + 3;
    if (doc.keywords.some(k => k.includes(token))) return score + 2;
    if (contentTokens.includes(token)) return score + 1;
    return score;
  }, 0);
}
function searchDocs(query, type) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  return searchIndex.documents
    .filter(d => !type || d.type === type)
    .map(d => ({ doc: d, score: scoreDoc(d, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ doc }) => doc);
}

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    const ok = result && !result.error;
    console.log(`${ok ? "✅" : "⚠️ "} ${name}:`, JSON.stringify(result).slice(0, 120) + "...");
    if (ok) passed++; else failed++;
  } catch (e) {
    console.log(`❌ ${name}: ERROR — ${e.message}`);
    failed++;
  }
}

// Tool 1: search_packages
test("search_packages('bromo')", () => {
  const hits = searchDocs("bromo", "package");
  const ids = new Set(hits.map(h => h.id));
  const matched = packagesData.packages.filter(p => ids.has(p.package_id));
  return { query: "bromo", total_results: matched.length, sample: matched[0]?.name };
});

// Tool 2: get_package
test("get_package('bromo-1d1n')", () => {
  const pkg = packagesData.packages.find(p => p.package_id === "bromo-1d1n" || p.slug === "bromo-1d1n");
  return pkg ? { package_id: pkg.package_id, name: pkg.name, duration: pkg.duration, price_tiers: pkg.price_tiers.length } : { error: "not found" };
});

// Tool 3: check_conflicts
test("check_conflicts()", () => {
  return { total_conflicts: conflictsData.total_conflicts, notes_count: conflictsData.notes?.length };
});

// Tool 4: get_source_trace
test("get_source_trace('bromo-1d1n')", () => {
  const pkgSource = sourcesData.entities.find(e => e.entity_id === "bromo-1d1n");
  const graphNode = entityGraph.nodes.find(n => n.id === "bromo-1d1n");
  return { found_in_sources: !!pkgSource, found_in_graph: !!graphNode, sources: pkgSource?.sources?.length };
});

// Tool 5: search_trust_claims
test("search_trust_claims('safety')", () => {
  const tokens = tokenize("safety");
  const scored = trustData.trust_claims
    .map(c => ({ c, score: tokens.reduce((s,t) => (tokenize(c.claim+" "+c.category).includes(t)?s+1:s), 0) }))
    .filter(x => x.score > 0);
  return { query: "safety", total_results: scored.length, sample: scored[0]?.c?.claim_id };
});

// Tool 6: get_policy
test("get_policy (first available)", () => {
  const first = policiesData.policies[0];
  return first ? { policy_id: first.policy_id, name: first.name, category: first.category } : { error: "no policies" };
});

// Tool 7: get_booking_analytics
test("get_booking_analytics()", () => {
  const bookings = bookingData.booking_aggregates;
  const totalRevenue = bookings.reduce((s, b) => s + (b.gross_revenue ?? 0), 0);
  const byChannel = {};
  for (const b of bookings) { const ch = b.channel ?? "unknown"; byChannel[ch] = (byChannel[ch]??0)+1; }
  return { total_bookings: bookings.length, total_revenue_idr: totalRevenue, channels: Object.keys(byChannel).length };
});

console.log(`\n${"─".repeat(50)}`);
console.log(`Result: ${passed} passed, ${failed} failed out of 7 tools`);
