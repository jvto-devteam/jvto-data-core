# Phase 6: MCP Gateway

Build MCP server dari clean-data untuk AI agent access.

## Input

Semua indexes/ dan output dari phase 1-5.

## Tools yang Diimplementasi

1. `search_packages(query)` → packages matching query
2. `get_package(id)` → full package detail + pricing
3. `check_conflicts()` → semua data conflicts
4. `get_source_trace(entity_id)` → source lineage
5. `search_trust_claims(query)` → matching trust claims
6. `get_policy(policy_id)` → policy detail
7. `get_booking_analytics()` → booking aggregates & analytics

## Output

Simpan ke `mcp-servers/`:
- `mcp-servers/mcp-server.ts` - MCP server implementation
- `mcp-servers/tools.json` - Tool definitions
- `mcp-servers/README.md` - Usage guide

## Validation

- `/code-review ultra` sebelum production
- Test semua 7 tools dengan sample queries
- Verify response format sesuai MCP spec
