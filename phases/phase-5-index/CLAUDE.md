# Phase 5: AI-Ready Index

Build index dari semua clean data untuk AI/RAG/Search.

## Input

Baca semua output dari phase 1-4:
- phases/phase-1-packages/output/packages.json
- phases/phase-2-trust/output/trust-claims.json
- phases/phase-2-trust/output/policies.json
- phases/phase-3-operational/output/*.json
- phases/phase-4-booking/output/booking-aggregates.json

## Output

Simpan ke `indexes/`:
- `indexes/rag-chunks.json` - RAG-ready text chunks per entity
- `indexes/entity-graph.json` - Graph: package → destinations → activities → hotels
- `indexes/search-index.json` - Full-text search index dengan keywords

## Format RAG Chunk

```json
{
  "chunk_id": "pkg_bromo_1d1n_chunk_1",
  "entity_type": "package",
  "entity_id": "bromo-1d1n",
  "content": "1 Day Bromo Midnight Experience...",
  "metadata": { "source": "llm-wiki", "confidence": "high", "freshness": "fresh" }
}
```

## Validation

- Setiap entity punya minimal 1 chunk
- Entity graph punya edges yang valid
- Search index punya keywords untuk setiap document
