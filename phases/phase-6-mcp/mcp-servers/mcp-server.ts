import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dirname, "../../");

// ── Data loaders ──────────────────────────────────────────────────────────────

function load<T>(relPath: string): T {
  return JSON.parse(readFileSync(resolve(DATA, relPath), "utf-8")) as T;
}

interface Package {
  package_id: string;
  name: string;
  slug: string;
  duration: string;
  origin: string;
  public_url: string;
  destinations: string[];
  flags: Record<string, boolean | null>;
  ferry_included: boolean | null;
  price_tiers: Array<{ min_pax: number; max_pax: number | null; price_idr: number; currency: string }>;
  db_id: string | null;
  is_publish: boolean | null;
  sources: Array<{ repo: string; sha_registry: string; sha_pricing: string }>;
  confidence: string;
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
  dropoff_city: string | null;
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

// Load all data at startup
const packagesData = load<{ packages: Package[] }>("phase-1-packages/output/packages.json");
const conflictsData = load<{ generated_at: string; total_conflicts: number; conflicts: unknown[]; notes: string[] }>("phase-1-packages/output/package-conflicts.json");
const sourcesData = load<{ entities: Array<{ entity_id: string; entity_type: string; sources: Array<{ repo: string; sha_registry: string; sha_pricing: string; extracted_at: string }> }> }>("phase-1-packages/output/package-sources.json");
const trustData = load<{ trust_claims: TrustClaim[] }>("phase-2-trust/output/trust-claims.json");
const policiesData = load<{ policies: Policy[] }>("phase-2-trust/output/policies.json");
const bookingData = load<{ booking_aggregates: BookingAggregate[] }>("phase-4-booking/output/booking-aggregates.json");
const searchIndex = load<{ documents: SearchDoc[] }>("phase-5-index/indexes/search-index.json");
const entityGraph = load<{ nodes: Array<{ id: string; type: string; label: string; properties?: Record<string, unknown> }>; edges: Array<{ source: string; target: string; relation: string }> }>("phase-5-index/indexes/entity-graph.json");

// ── Search helpers ────────────────────────────────────────────────────────────

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

// ── Tool handlers ─────────────────────────────────────────────────────────────

function searchPackages(query: string): object {
  const hits = searchDocs(query, "package");
  const ids = new Set(hits.map((h) => h.id));
  const matched = packagesData.packages.filter((p) => ids.has(p.package_id));
  // Preserve search rank order
  matched.sort((a, b) => {
    const ia = hits.findIndex((h) => h.id === a.package_id);
    const ib = hits.findIndex((h) => h.id === b.package_id);
    return ia - ib;
  });
  return {
    query,
    total_results: matched.length,
    packages: matched.map((p) => ({
      package_id: p.package_id,
      name: p.name,
      duration: p.duration,
      origin: p.origin,
      destinations: p.destinations,
      min_price_idr: p.price_tiers.length > 0 ? Math.min(...p.price_tiers.map((t) => t.price_idr)) : null,
      public_url: p.public_url,
      confidence: p.confidence,
    })),
  };
}

function getPackage(id: string): object {
  const pkg = packagesData.packages.find(
    (p) => p.package_id === id || p.slug === id
  );
  if (!pkg) return { error: `Package '${id}' not found`, available_ids: packagesData.packages.map((p) => p.package_id) };
  return { package: pkg };
}

function checkConflicts(): object {
  return {
    total_conflicts: conflictsData.total_conflicts,
    conflicts: conflictsData.conflicts,
    notes: conflictsData.notes,
    generated_at: conflictsData.generated_at,
  };
}

function getSourceTrace(entityId: string): object {
  // Check package sources
  const pkgSource = sourcesData.entities.find((e) => e.entity_id === entityId);

  // Check entity graph
  const graphNode = entityGraph.nodes.find((n) => n.id === entityId);
  const graphEdges = entityGraph.edges.filter(
    (e) => e.source === entityId || e.target === entityId
  );

  // Check trust claims
  const trustClaim = trustData.trust_claims.find((t) => t.claim_id === entityId);

  // Check policy
  const policy = policiesData.policies.find((p) => p.policy_id === entityId);

  if (!pkgSource && !graphNode && !trustClaim && !policy) {
    return {
      error: `Entity '${entityId}' not found`,
      hint: "Use a package_id (e.g. 'bromo-1d1n'), claim_id (e.g. 'trust_safety_led_operations'), or policy_id (e.g. 'policy_deposit_payment')",
    };
  }

  return {
    entity_id: entityId,
    found_in: [
      pkgSource ? "package-sources" : null,
      graphNode ? "entity-graph" : null,
      trustClaim ? "trust-claims" : null,
      policy ? "policies" : null,
    ].filter(Boolean),
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

  return {
    query,
    total_results: scored.length,
    trust_claims: scored,
  };
}

function getPolicy(policyId: string): object {
  const policy = policiesData.policies.find((p) => p.policy_id === policyId);
  if (!policy) {
    return {
      error: `Policy '${policyId}' not found`,
      available_policies: policiesData.policies.map((p) => ({ policy_id: p.policy_id, name: p.name, category: p.category })),
    };
  }
  return { policy };
}

function getBookingAnalytics(): object {
  const bookings = bookingData.booking_aggregates;
  const total = bookings.length;

  // Revenue
  const validRevenue = bookings.filter((b) => (b.gross_revenue ?? 0) > 0);
  const totalRevenue = bookings.reduce((s, b) => s + (b.gross_revenue ?? 0), 0);
  const totalProfit = bookings.reduce((s, b) => s + (b.profit_estimate ?? 0), 0);

  // Channels
  const byChannel: Record<string, number> = {};
  for (const b of bookings) {
    const ch = b.channel ?? "unknown";
    byChannel[ch] = (byChannel[ch] ?? 0) + 1;
  }

  // Operational status
  const byOpStatus: Record<string, number> = {};
  for (const b of bookings) {
    const st = b.operational_status ?? "unknown";
    byOpStatus[st] = (byOpStatus[st] ?? 0) + 1;
  }

  // Payment status
  const byPayStatus: Record<string, number> = {};
  for (const b of bookings) {
    const st = b.payment_status ?? "unknown";
    byPayStatus[st] = (byPayStatus[st] ?? 0) + 1;
  }

  // Monthly revenue (travel month/year)
  const byMonth: Record<string, number> = {};
  for (const b of bookings) {
    if (b.travel_year && b.travel_month) {
      const key = `${b.travel_year}-${String(b.travel_month).padStart(2, "0")}`;
      byMonth[key] = (byMonth[key] ?? 0) + (b.gross_revenue ?? 0);
    }
  }

  // PAX stats
  const validPax = bookings.filter((b) => (b.pax_count ?? 0) > 0);
  const totalPax = validPax.reduce((s, b) => s + (b.pax_count ?? 0), 0);
  const avgPax = validPax.length > 0 ? totalPax / validPax.length : 0;

  // Top revenue bookings
  const topBookings = [...bookings]
    .filter((b) => (b.gross_revenue ?? 0) > 0)
    .sort((a, b) => (b.gross_revenue ?? 0) - (a.gross_revenue ?? 0))
    .slice(0, 5)
    .map((b) => ({
      booking_id_hash: b.booking_id_hash,
      channel: b.channel,
      travel_period: b.travel_year && b.travel_month ? `${b.travel_year}-${String(b.travel_month).padStart(2, "0")}` : null,
      pax_count: b.pax_count,
      gross_revenue_idr: b.gross_revenue,
      operational_status: b.operational_status,
    }));

  return {
    summary: {
      total_bookings: total,
      bookings_with_revenue: validRevenue.length,
      total_gross_revenue_idr: totalRevenue,
      total_profit_estimate_idr: totalProfit,
      avg_revenue_per_booking_idr: validRevenue.length > 0 ? totalRevenue / validRevenue.length : 0,
      avg_pax_per_booking: Math.round(avgPax * 100) / 100,
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

// ── MCP Server setup ──────────────────────────────────────────────────────────

const server = new Server(
  { name: "jvto-data-core", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_packages",
      description: "Search JVTO tour packages by keyword. Returns matching packages with pricing and destination info.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (e.g. 'bromo midnight', 'ijen blue fire', 'from bali')" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_package",
      description: "Get full details of a specific tour package by its ID, including all price tiers, destinations, flags, and source provenance.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Package ID or slug (e.g. 'bromo-1d1n', 'ijen-2d1n')" },
        },
        required: ["id"],
      },
    },
    {
      name: "check_conflicts",
      description: "Check for data conflicts across all package sources. Returns conflict list, notes, and audit metadata.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "get_source_trace",
      description: "Trace the data lineage for any entity (package, policy, trust claim). Returns source repos, SHA fingerprints, and graph relationships.",
      inputSchema: {
        type: "object",
        properties: {
          entity_id: { type: "string", description: "Entity ID (e.g. 'bromo-1d1n', 'policy_deposit_payment', 'trust_safety_led_operations')" },
        },
        required: ["entity_id"],
      },
    },
    {
      name: "search_trust_claims",
      description: "Search JVTO trust and credibility claims by keyword. Returns claims with evidence and source documentation.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (e.g. 'safety', 'police', 'guide certified', 'environmental')" },
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
          policy_id: { type: "string", description: "Policy ID (e.g. 'policy_deposit_payment', 'policy_cancellation')" },
        },
        required: ["policy_id"],
      },
    },
    {
      name: "get_booking_analytics",
      description: "Get aggregated booking analytics: revenue totals, channel breakdown, operational status distribution, monthly trends, and top bookings.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
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

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: String(err) }) }],
      isError: true,
    };
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
