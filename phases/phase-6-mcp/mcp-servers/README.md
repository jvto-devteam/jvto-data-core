# JVTO Data Core — MCP Server

MCP (Model Context Protocol) gateway giving AI agents structured access to JVTO tour data from phases 1–5.

## Quick Start

```bash
cd mcp-servers
npm install
npm run dev          # run directly with tsx (no build required)
# or
npm run build && npm start
```

## Claude Desktop Integration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jvto-data-core": {
      "command": "node",
      "args": ["/absolute/path/to/phase-6-mcp/mcp-servers/dist/mcp-server.js"]
    }
  }
}
```

Or with `tsx` (no build step):

```json
{
  "mcpServers": {
    "jvto-data-core": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/phase-6-mcp/mcp-servers/mcp-server.ts"]
    }
  }
}
```

## Tools

### 1. `search_packages(query)`

Search tour packages by keyword. Returns ranked results.

```json
{ "query": "bromo midnight from surabaya" }
```

Returns: package list with IDs, names, min price, destinations, confidence.

---

### 2. `get_package(id)`

Full package detail including all price tiers, flags, and source SHAs.

```json
{ "id": "bromo-1d1n" }
```

Returns: complete Package object with price tiers, flags (`ijen_relevant`, `visits_madakaripura`, `is_specialty`), ferry info, and source repo fingerprints.

Available package IDs include: `bromo-1d1n`, `bromo-2d1n`, `ijen-2d1n`, `bromo-ijen-4d3n`, and 31 others. Use `search_packages` to discover IDs.

---

### 3. `check_conflicts()`

Audit data conflicts across all source repositories.

```json
{}
```

Returns: conflict count, conflict details, and notes from the phase-1 reconciliation process.

---

### 4. `get_source_trace(entity_id)`

Data lineage for any entity — source repos, SHA-256 fingerprints, and entity graph edges.

```json
{ "entity_id": "bromo-1d1n" }
```

Also works with policy IDs and trust claim IDs. Returns: source repos with SHAs, graph node/edges, related trust/policy objects.

---

### 5. `search_trust_claims(query)`

Search credibility and trust claims with evidence.

```json
{ "query": "safety police officer" }
```

Returns: matching claims with full evidence list (document SHAs, third-party confirmations, certifications).

---

### 6. `get_policy(policy_id)`

Full text of a specific business policy.

```json
{ "policy_id": "policy_cancellation" }
```

Available policy IDs (18 total):
- `policy_deposit_payment` — Payment schedule and bank details
- `policy_cancellation` — 48-hour cancellation, travel credit
- `policy_health_fitness` — Physical requirements and medical conditions
- `policy_private_tours` — Private-only policy (no shared groups)
- `policy_weather_volcano` — Weather and volcanic activity handling
- … and 13 more (use `get_source_trace` with an unknown ID to see the full list)

---

### 7. `get_booking_analytics()`

Aggregated analytics across 546 bookings.

```json
{}
```

Returns:
- **Summary**: total bookings, revenue (IDR), profit estimate, avg pax
- **By channel**: Website vs unknown
- **By operational status**: booked, pending, etc.
- **By payment status**: pending, paid, etc.
- **Monthly revenue trend**: keyed by `YYYY-MM`
- **Top 5 bookings by revenue**

## Data Sources

| Tool | Phase | Files |
|------|-------|-------|
| `search_packages` | 1 + 5 | `packages.json`, `search-index.json` |
| `get_package` | 1 | `packages.json` |
| `check_conflicts` | 1 | `package-conflicts.json` |
| `get_source_trace` | 1 + 5 | `package-sources.json`, `entity-graph.json` |
| `search_trust_claims` | 2 | `trust-claims.json` |
| `get_policy` | 2 | `policies.json` |
| `get_booking_analytics` | 4 | `booking-aggregates.json` |

## Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector npx tsx mcp-server.ts
```

## Response Format

All tools return JSON in `content[0].text`. Error responses include an `error` field and hints for correction.
