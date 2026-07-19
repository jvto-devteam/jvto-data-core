import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the `phases/` data root by walking UP from wherever this file runs,
// looking for a stable marker. This survives running from source
// (phases/phase-6-mcp/mcp-servers/) or a compiled build (…/dist/), where a fixed
// "../../" would silently point at the wrong depth and serve all-empty data.
function findDataRoot(start: string): string {
  const marker = "phase-1-packages/output/packages.json";
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, marker))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to the legacy fixed depth; a health warning below will flag emptiness.
  return resolve(start, "../../");
}
const DATA = findDataRoot(__dirname);

// ── Data loaders ──────────────────────────────────────────────────────────────

function load<T>(relPath: string, fallback: T): T {
  const fullPath = resolve(DATA, relPath);
  if (!existsSync(fullPath)) return fallback;
  try {
    return JSON.parse(readFileSync(fullPath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

// ── Interfaces (new API format) ───────────────────────────────────────────────

interface PriceTier {
  sku: string;
  paxMin: number;
  paxMax: number;
  pricePerPerson: number;
}

interface ItineraryDay {
  day: number;
  title: string;
  summary: string;
  activities: Array<{
    type: string;
    name: string;
    description: string;
    timeWindow: string;
  }>;
  mealsPlan: { breakfast: string; lunch: string; dinner: string };
  overnight: string | null;
}

interface Package {
  id: number;
  packageId: string;
  product: {
    packageId: string;
    slug: string;
    name: string;
    shortLabel?: string;
    originCity: string;
    endCity: string;
    category: string;
    durationDays: number;
    durationNights: number;
    marketedDurationLabel: string;
    route: string[];
    description: string;
    physicalDifficulty: string;
    offers: {
      currency: string;
      aggregateOffer: { lowPrice: number; highPrice: number };
      tiers: PriceTier[];
    };
    inclusions: string[];
    exclusions: string[];
    itineraryDays: ItineraryDay[];
    accommodationPlan: Array<{ night: number; name: string; area: string }>;
    gear: { provided: string[]; recommended: string[] };
    tags: string[];
    marketing: {
      highlightsBullets: string[];
      perfectFor: string[];
      safetyPositioning?: string;
    };
    keyExperiences?: Array<{ name: string; highlight: string }>;
    aggregateRating?: { ratingValue: number; reviewCount: number };
    provider?: {
      legalEntity?: string;
      nib?: string;
      official?: { website: string; whatsapp: string; email: string };
    };
    channelMetadata?: {
      status?: string;
      orderChannelEnabled?: Record<string, boolean>;
    };
  };
}

interface TrustClaim {
  claim_id: string;
  claim: string;
  category: string;
  evidence: string[];
  sources?: string[];
}

interface Policy {
  policy_id: string;
  name: string;
  description: string;
  category: string;
  source: string;
}

interface BookingAggregate {
  booking_id_hash: string;
  channel: string | null;
  package_id: string | null;
  travel_month: number | null;
  travel_year: number | null;
  pax_count: number | null;
  pickup_city: string | null;
  gross_revenue: number | null;
  cost_total: number | null;
  profit_estimate: number | null;
  payment_status: string | null;
  operational_status: string | null;
  created_at: string | null;
}

interface SearchDoc {
  id: string;
  type: string;
  title: string;
  content: string;
  keywords: string[];
  searchable_fields: Record<string, string>;
}

// ── Load data at startup ──────────────────────────────────────────────────────

const packagesData = load<{ packages: Package[] }>(
  "phase-1-packages/output/packages.json",
  { packages: [] }
);
const conflictsData = load<{
  generated_at: string;
  total_conflicts: number;
  conflicts: unknown[];
  notes: string[];
}>("phase-1-packages/output/package-conflicts.json", {
  generated_at: "",
  total_conflicts: 0,
  conflicts: [],
  notes: [],
});
const sourcesData = load<{
  entities: Array<{
    entity_id: string;
    entity_type: string;
    sources: Array<{ repo: string; sha_registry: string; sha_pricing: string; extracted_at: string }>;
  }>;
}>("phase-1-packages/output/package-sources.json", { entities: [] });
const trustData = load<{ trust_claims: TrustClaim[] }>(
  "phase-2-trust/output/trust-claims.json",
  { trust_claims: [] }
);
const policiesData = load<{ policies: Policy[] }>(
  "phase-2-trust/output/policies.json",
  { policies: [] }
);
const bookingData = load<{ booking_aggregates: BookingAggregate[] }>(
  "phase-4-booking/output/booking-aggregates.json",
  { booking_aggregates: [] }
);
const searchIndex = load<{ documents: SearchDoc[] }>(
  "phase-5-index/indexes/search-index.json",
  { documents: [] }
);
const entityGraph = load<{
  nodes: Array<{ id: string; type: string; label: string; properties?: Record<string, unknown> }>;
  edges: Array<{ source: string; target: string; relation: string }>;
}>("phase-5-index/indexes/entity-graph.json", { nodes: [], edges: [] });

// Reconciled, repo-level conflict report (validator-generated). Lives one level
// above the phases/ data root. Preferred over the stale per-phase file below.
const conflictReport = load<{
  generated_at: string;
  total_conflicts: number;
  conflicts: unknown[];
  notes: string[];
}>("../conflicts/conflict-report.json", {
  generated_at: "",
  total_conflicts: 0,
  conflicts: [],
  notes: [],
});

// ── Startup health check: fail LOUDLY (stderr) instead of silently serving empty.
{
  const core: Array<[string, number]> = [
    ["packages", packagesData.packages.length],
    ["trust_claims", trustData.trust_claims.length],
    ["policies", policiesData.policies.length],
    ["booking_aggregates", bookingData.booking_aggregates.length],
    ["search_docs", searchIndex.documents.length],
    ["graph_nodes", entityGraph.nodes.length],
  ];
  const empty = core.filter(([, n]) => n === 0).map(([k]) => k);
  if (empty.length) {
    console.error(
      `[jvto-data-core] WARNING: empty core dataset(s) [${empty.join(", ")}] — ` +
        `data root resolved to '${DATA}'. The server will answer with degraded/empty ` +
        `results. Check the build output depth or missing phase outputs.`
    );
  }
}

// ── Search helpers ─────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

function scoreDoc(doc: SearchDoc, queryTokens: string[]): number {
  const contentTokens = tokenize(doc.content + " " + doc.keywords.join(" ") + " " + doc.title);
  return queryTokens.reduce((score, token) => {
    if (doc.title.toLowerCase().includes(token)) return score + 3;
    if (doc.keywords.some((k) => k.includes(token))) return score + 2;
    if (contentTokens.includes(token)) return score + 1;
    return score;
  }, 0);
}

function searchDocs(query: string, type?: string): SearchDoc[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  return searchIndex.documents
    .filter((d) => !type || d.type === type)
    .map((d) => ({ doc: d, score: scoreDoc(d, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ doc }) => doc);
}

// Score a package directly against query tokens (for packages not in search index)
function scorePackage(pkg: Package, queryTokens: string[]): number {
  const prod = pkg.product;
  const text = [
    prod.name,
    prod.description,
    prod.originCity,
    prod.endCity,
    prod.category,
    prod.marketedDurationLabel,
    ...(prod.route ?? []),
    ...(prod.tags ?? []),
    ...(prod.marketing?.highlightsBullets ?? []),
    ...(prod.marketing?.perfectFor ?? []),
    pkg.packageId,
    prod.slug,
  ].join(" ").toLowerCase();

  return queryTokens.reduce((score, token) => {
    if (prod.name.toLowerCase().includes(token)) return score + 3;
    if ((prod.route ?? []).some((r) => r.toLowerCase().includes(token))) return score + 2;
    if (text.includes(token)) return score + 1;
    return score;
  }, 0);
}

// ── Package summary helper ─────────────────────────────────────────────────────

function pkgSummary(p: Package) {
  const prod = p.product;
  const tiers = prod.offers?.tiers ?? [];
  const priceFrom = tiers.length > 0 ? Math.min(...tiers.map((t) => t.pricePerPerson)) : null;
  const priceTo = tiers.length > 0 ? Math.max(...tiers.map((t) => t.pricePerPerson)) : null;
  return {
    package_id: p.packageId,
    name: prod.name,
    duration: prod.marketedDurationLabel,
    origin: prod.originCity,
    end: prod.endCity,
    destinations: prod.route,
    category: prod.category,
    difficulty: prod.physicalDifficulty,
    price_from_idr: priceFrom,
    price_to_idr: priceTo,
    channels_active: prod.channelMetadata?.orderChannelEnabled
      ? Object.entries(prod.channelMetadata.orderChannelEnabled)
          .filter(([, v]) => v)
          .map(([k]) => k)
      : [],
    tags: prod.tags ?? [],
    rating: prod.aggregateRating ?? null,
    status: prod.channelMetadata?.status ?? null,
  };
}

// ── Tool handlers ──────────────────────────────────────────────────────────────

function searchPackages(query: string): object {
  const tokens = tokenize(query);
  if (tokens.length === 0) return { query, total_results: 0, packages: [] };

  // Score all packages directly (handles new format correctly)
  const scored = packagesData.packages
    .map((p) => ({ pkg: p, score: scorePackage(p, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    query,
    total_results: scored.length,
    packages: scored.map(({ pkg }) => pkgSummary(pkg)),
  };
}

function getPackage(id: string): object {
  const pkg = packagesData.packages.find(
    (p) =>
      p.packageId === id ||
      p.product?.packageId === id ||
      p.product?.slug === id ||
      p.product?.slug?.endsWith(id) ||
      p.product?.name?.toLowerCase().includes(id.toLowerCase())
  );

  if (!pkg) {
    return {
      error: `Package '${id}' not found`,
      available_ids: packagesData.packages.map((p) => ({
        package_id: p.packageId,
        name: p.product?.name,
        duration: p.product?.marketedDurationLabel,
      })),
    };
  }

  const prod = pkg.product;
  const tiers = prod.offers?.tiers ?? [];

  return {
    package_id: pkg.packageId,
    name: prod.name,
    duration: prod.marketedDurationLabel,
    duration_days: prod.durationDays,
    duration_nights: prod.durationNights,
    origin: prod.originCity,
    end: prod.endCity,
    category: prod.category,
    difficulty: prod.physicalDifficulty,
    description: prod.description,
    route: prod.route,
    tags: prod.tags,
    rating: prod.aggregateRating,
    highlights: prod.marketing?.highlightsBullets,
    perfect_for: prod.marketing?.perfectFor,
    safety_positioning: prod.marketing?.safetyPositioning,
    pricing: {
      currency: prod.offers?.currency,
      price_from_idr: tiers.length > 0 ? Math.min(...tiers.map((t) => t.pricePerPerson)) : null,
      price_to_idr: tiers.length > 0 ? Math.max(...tiers.map((t) => t.pricePerPerson)) : null,
      tiers: tiers.map((t) => ({
        pax_min: t.paxMin,
        pax_max: t.paxMax === 0 ? null : t.paxMax,
        price_per_person_idr: t.pricePerPerson,
      })),
    },
    inclusions: prod.inclusions,
    exclusions: prod.exclusions,
    itinerary: prod.itineraryDays?.map((d) => ({
      day: d.day,
      title: d.title,
      summary: d.summary,
      activities: d.activities?.map((a) => ({ time: a.timeWindow, name: a.name, description: a.description })),
      meals: d.mealsPlan,
      overnight: d.overnight,
    })),
    accommodation: prod.accommodationPlan,
    gear_provided: prod.gear?.provided,
    gear_recommended: prod.gear?.recommended,
    key_experiences: prod.keyExperiences,
    channels: prod.channelMetadata?.orderChannelEnabled,
    provider: prod.provider?.official,
    status: prod.channelMetadata?.status,
  };
}

function checkConflicts(): object {
  // Prefer the reconciled repo-level report; the per-phase package-conflicts.json
  // is stale (dated 2026-06-13, pre-regeneration) and under-reports.
  const primary =
    conflictReport.generated_at || conflictReport.total_conflicts > 0
      ? conflictReport
      : conflictsData;
  const notes = [...(primary.notes ?? [])];
  if (primary === conflictReport && conflictsData.total_conflicts !== primary.total_conflicts) {
    notes.push(
      `Note: legacy phase-1 package-conflicts.json reports ${conflictsData.total_conflicts} ` +
        `conflict(s) and is superseded by this reconciled report.`
    );
  }
  return {
    total_conflicts: primary.total_conflicts,
    conflicts: primary.conflicts,
    notes,
    generated_at: primary.generated_at,
    source: primary === conflictReport ? "conflicts/conflict-report.json" : "package-conflicts.json",
  };
}

// Slug tail bridge: scheme-A packageId <-> scheme-B source entity_id share a slug tail.
function slugTail(s: string | undefined): string {
  return String(s ?? "").replace(/\/+$/, "").split("/").pop() ?? "";
}

function getSourceTrace(entityId: string): object {
  const pkgByNewId = packagesData.packages.find(
    (p) => p.packageId === entityId || p.product?.packageId === entityId
  );
  // Direct match on entity_id, else bridge a packageId to its source via slug tail.
  const bridgeTail = pkgByNewId ? slugTail(pkgByNewId.product?.slug) : slugTail(entityId);
  const pkgSource =
    sourcesData.entities.find((e) => e.entity_id === entityId) ??
    (bridgeTail
      ? sourcesData.entities.find((e) => slugTail(e.entity_id) === bridgeTail)
      : undefined);
  const graphNode = entityGraph.nodes.find((n) => n.id === entityId);
  const graphEdges = entityGraph.edges.filter(
    (e) => e.source === entityId || e.target === entityId
  );
  const trustClaim = trustData.trust_claims.find((t) => t.claim_id === entityId);
  const policy = policiesData.policies.find((p) => p.policy_id === entityId);

  if (!pkgByNewId && !pkgSource && !graphNode && !trustClaim && !policy) {
    return {
      error: `Entity '${entityId}' not found in any dataset`,
      hint: "Use a package_id (e.g. 'package-SUB-4D3N-001'), claim_id (e.g. 'trust_safety_led_operations'), or policy_id (e.g. 'policy_deposit_payment')",
      available_package_ids: packagesData.packages.slice(0, 5).map((p) => p.packageId),
    };
  }

  return {
    entity_id: entityId,
    found_in: [
      pkgByNewId ? "packages" : null,
      pkgSource ? "package-sources" : null,
      graphNode ? "entity-graph" : null,
      trustClaim ? "trust-claims" : null,
      policy ? "policies" : null,
    ].filter(Boolean),
    package_summary: pkgByNewId ? pkgSummary(pkgByNewId) : null,
    package_sources: pkgSource ?? null,
    graph_node: graphNode ?? null,
    graph_edges: graphEdges.length > 0 ? graphEdges : null,
    trust_claim: trustClaim ?? null,
    policy: policy ?? null,
  };
}

function searchTrustClaims(query: string): object {
  const tokens = tokenize(query);
  const scored = trustData.trust_claims
    .map((c) => {
      const text = tokenize(c.claim + " " + c.category + " " + c.evidence.join(" "));
      const score = tokens.reduce((s, t) => (text.includes(t) ? s + 1 : s), 0);
      return { claim: c, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ claim }) => claim);

  return { query, total_results: scored.length, trust_claims: scored };
}

function getPolicy(policyId: string): object {
  const policy = policiesData.policies.find((p) => p.policy_id === policyId);
  if (!policy) {
    return {
      error: `Policy '${policyId}' not found`,
      available_policies: policiesData.policies.map((p) => ({
        policy_id: p.policy_id,
        name: p.name,
        category: p.category,
      })),
    };
  }
  return { policy };
}

function getBookingAnalytics(): object {
  const bookings = bookingData.booking_aggregates;
  const total = bookings.length;
  const validRevenue = bookings.filter((b) => (b.gross_revenue ?? 0) > 0);
  const totalRevenue = bookings.reduce((s, b) => s + (b.gross_revenue ?? 0), 0);
  const totalProfit = bookings.reduce((s, b) => s + (b.profit_estimate ?? 0), 0);

  const byChannel: Record<string, number> = {};
  const byOpStatus: Record<string, number> = {};
  const byPayStatus: Record<string, number> = {};
  const byMonth: Record<string, number> = {};

  for (const b of bookings) {
    const ch = b.channel ?? "unknown";
    byChannel[ch] = (byChannel[ch] ?? 0) + 1;
    const op = b.operational_status ?? "unknown";
    byOpStatus[op] = (byOpStatus[op] ?? 0) + 1;
    const pay = b.payment_status ?? "unknown";
    byPayStatus[pay] = (byPayStatus[pay] ?? 0) + 1;
    if (b.travel_year && b.travel_month) {
      const key = `${b.travel_year}-${String(b.travel_month).padStart(2, "0")}`;
      byMonth[key] = (byMonth[key] ?? 0) + (b.gross_revenue ?? 0);
    }
  }

  const validPax = bookings.filter((b) => (b.pax_count ?? 0) > 0);
  const totalPax = validPax.reduce((s, b) => s + (b.pax_count ?? 0), 0);

  const topBookings = [...bookings]
    .filter((b) => (b.gross_revenue ?? 0) > 0)
    .sort((a, b) => (b.gross_revenue ?? 0) - (a.gross_revenue ?? 0))
    .slice(0, 5)
    .map((b) => ({
      booking_id_hash: b.booking_id_hash,
      channel: b.channel,
      travel_period:
        b.travel_year && b.travel_month
          ? `${b.travel_year}-${String(b.travel_month).padStart(2, "0")}`
          : null,
      pax_count: b.pax_count,
      gross_revenue_idr: b.gross_revenue,
      operational_status: b.operational_status,
    }));

  return {
    summary: {
      total_bookings: total,
      total_packages_in_catalog: packagesData.packages.length,
      bookings_with_revenue: validRevenue.length,
      total_gross_revenue_idr: totalRevenue,
      total_profit_estimate_idr: totalProfit,
      avg_revenue_per_booking_idr:
        validRevenue.length > 0 ? Math.round(totalRevenue / validRevenue.length) : 0,
      avg_pax_per_booking: validPax.length > 0 ? Math.round((totalPax / validPax.length) * 100) / 100 : 0,
      total_pax: totalPax,
    },
    by_channel: byChannel,
    by_operational_status: byOpStatus,
    by_payment_status: byPayStatus,
    monthly_revenue_idr: Object.fromEntries(
      Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))
    ),
    top_5_bookings_by_revenue: topBookings,
  };
}

// ── MCP Server ─────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "jvto-data-core", version: "2.2.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_packages",
      description: "Search JVTO tour packages by keyword. Returns matching packages with pricing, destinations, and channel info.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (e.g. 'bromo midnight', 'ijen blue fire', '4 day', 'from surabaya')",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_package",
      description: "Get full details of a tour package by package_id. Includes pricing tiers, full itinerary, inclusions/exclusions, accommodation, gear, and booking channel status.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Package ID (e.g. 'package-SUB-4D3N-001') or partial name/slug",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "check_conflicts",
      description: "Check for data conflicts across all package sources. Returns conflict list and audit metadata.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "get_source_trace",
      description: "Trace data lineage for any entity (package, policy, trust claim). Returns source provenance and graph relationships.",
      inputSchema: {
        type: "object",
        properties: {
          entity_id: {
            type: "string",
            description: "Entity ID (e.g. 'package-SUB-4D3N-001', 'policy_deposit_payment', 'trust_safety_led_operations')",
          },
        },
        required: ["entity_id"],
      },
    },
    {
      name: "search_trust_claims",
      description: "Search JVTO trust and credibility claims. Returns claims with evidence and sources.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (e.g. 'safety', 'police', 'guide certified', 'environmental')",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_policy",
      description: "Get the full text of a specific JVTO policy (cancellation, payment, health, etc.).",
      inputSchema: {
        type: "object",
        properties: {
          policy_id: {
            type: "string",
            description: "Policy ID (e.g. 'policy_deposit_payment', 'policy_cancellation')",
          },
        },
        required: ["policy_id"],
      },
    },
    {
      name: "get_booking_analytics",
      description: "Get aggregated booking analytics: revenue totals, channel breakdown, operational status, monthly trends, and top bookings.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result: object;
    switch (name) {
      case "search_packages":
        result = searchPackages((args as { query: string }).query);
        break;
      case "get_package":
        result = getPackage((args as { id: string }).id);
        break;
      case "check_conflicts":
        result = checkConflicts();
        break;
      case "get_source_trace":
        result = getSourceTrace((args as { entity_id: string }).entity_id);
        break;
      case "search_trust_claims":
        result = searchTrustClaims((args as { query: string }).query);
        break;
      case "get_policy":
        result = getPolicy((args as { policy_id: string }).policy_id);
        break;
      case "get_booking_analytics":
        result = getBookingAnalytics();
        break;
      default:
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
          isError: true,
        };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: String(err) }) }],
      isError: true,
    };
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
