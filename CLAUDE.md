# jvto-data-core

Unified data extraction and normalization hub untuk JVTO.

## Tujuan

Mengekstrak, membersihkan, dan menyatukan data dari 3 repo:
- llm-wiki (knowledge base)
- jvto-web (website canonical)
- new-backoffice (operational data)

## Struktur

```
phases/
  phase-0-inventory/      ← Scan semua sumber
  phase-1-packages/       ← Extract package data
  phase-2-trust/          ← Extract trust & policy
  phase-3-operational/    ← Extract hotel, vendor, crew
  phase-4-booking/        ← Extract booking aggregates
  phase-5-index/          ← Build AI-ready index
  phase-6-mcp/            ← MCP gateway

workflows/
  full-ingest.workflow.ts ← Jalankan semua phase paralel

hooks/
  post-extract.hook.yaml  ← Auto-validate setelah extract
  conflict-detector.hook.yaml

clean-data/              ← Output bersih
source-trace/            ← Lineage tracking
conflicts/               ← Conflict reports
indexes/                 ← Search & RAG index
```

## Konvensi

1. **Setiap phase adalah subdirectory dengan CLAUDE.md sendiri**
   - Baca CLAUDE.md di phase directory untuk instruksi spesifik
   
2. **Jalankan dari phase directory**
   ```bash
   cd phases/phase-1-packages
   claude
   ```

3. **Gunakan `/batch` untuk parallel subagents**
   - Spawn 3-5 subagents untuk extract dari berbagai sumber
   - Merge results di main conversation

4. **Gunakan workflows untuk koordinasi lintas-phase**
   ```bash
   /workflows full-ingest
   ```

## Tools & Integrations

- **MCP**: GitHub (read repos), MySQL (backoffice), PostgreSQL (jvto-web)
- **Skills**: inventory, extract-packages, extract-trust, validate-data
- **Hooks**: post-extract validation, conflict detection
- **Models**: Fable 5 (complex reasoning), Sonnet (execution)

## Effort Level

- Phase 0 (Inventory): `high` (need good analysis)
- Phase 1-5 (Extraction): `high` (parallel execution)
- Phase 6 (MCP): `medium` (straightforward)

## Mulai

```bash
cd phases/phase-0-inventory
claude
```

Atau jalankan semua sekaligus:
```bash
claude /workflows full-ingest
```
