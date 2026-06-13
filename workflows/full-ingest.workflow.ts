/**
 * full-ingest.workflow.ts
 * Jalankan semua phase ekstraksi data secara paralel.
 * Usage: /workflows full-ingest
 */

export const meta = {
  name: 'full-ingest',
  description: 'Run all extraction phases (0–6) in optimal order',
  phases: [
    { title: 'Phase 0: Inventory', detail: 'Scan all 3 repos' },
    { title: 'Phase 1-3: Parallel Extraction', detail: 'Packages, Trust, Operational' },
    { title: 'Phase 4: Booking', detail: 'Booking aggregates NO PII' },
    { title: 'Phase 5: Index', detail: 'Build RAG + entity graph + search index' },
    { title: 'Phase 6: MCP', detail: 'Build MCP gateway server' },
  ],
}

// Phase 0: Inventory harus selesai dulu sebelum extraction
phase('Phase 0: Inventory')
await agent('Run phase-0-inventory: scan sambuko82/llm-wiki, jvto-devteam/jvto-web, jvto-devteam/new-backoffice using gh api. Save to phases/phase-0-inventory/output/source-catalog.json', {
  label: 'phase-0-inventory',
})

// Phase 1, 2, 3 paralel
phase('Phase 1-3: Parallel Extraction')
await parallel([
  () => agent('Run phase-1-packages: extract from llm-wiki (gh api), jvto-web (gh api), backoffice MySQL. Save packages.json, package-sources.json, package-conflicts.json to phases/phase-1-packages/output/', { label: 'phase-1-packages' }),
  () => agent('Run phase-2-trust: extract trust claims, policies, FAQ from llm-wiki trust-bundle and backoffice MySQL. Save trust-claims.json, policies.json, faq-snippets.json to phases/phase-2-trust/output/', { label: 'phase-2-trust' }),
  () => agent('Run phase-3-operational: extract hotels, vendors, crews, vehicles, destinations, activities from backoffice MySQL. Save to phases/phase-3-operational/output/', { label: 'phase-3-operational' }),
])

// Phase 4 setelah extraction selesai
phase('Phase 4: Booking')
await agent('Run phase-4-booking: extract booking aggregates WITHOUT PII from backoffice MySQL (MD5 hash booking_id). Save booking-aggregates.json to phases/phase-4-booking/output/', {
  label: 'phase-4-booking',
})

// Phase 5 butuh semua output phase 1-4
phase('Phase 5: Index')
await agent('Run phase-5-index: read all phase 1-4 outputs and build rag-chunks.json, entity-graph.json, search-index.json. Save to phases/phase-5-index/indexes/', {
  label: 'phase-5-index',
})

// Phase 6 terakhir
phase('Phase 6: MCP')
await agent('Run phase-6-mcp: build MCP server with 7 tools (search_packages, get_package, check_conflicts, get_source_trace, search_trust_claims, get_policy, get_booking_analytics). Save to phases/phase-6-mcp/mcp-servers/', {
  label: 'phase-6-mcp',
})
