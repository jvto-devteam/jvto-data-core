# Phase 2: Trust & Policy Extraction

Extract & normalize trust claims dan policy data dari 3 sumber.

## Sumber Data

1. llm-wiki/output/website/trust-bundle/ (claims.json, policies.json, faq.json, dll)
2. jvto-web/src/data/trust-claims.json (atau equivalent)
3. new-backoffice /export-data/policies endpoint (MySQL lokal)

## Output

- `output/trust-claims.json` - Semua trust claims dengan evidence
- `output/policies.json` - Deposit, refund, cancellation policies
- `output/faq-snippets.json` - FAQ ready untuk AI/web

## Subagents

Spawn 3 subagents paralel untuk extract dari setiap sumber.

## Validation

- Semua claims punya evidence
- Semua policies punya source trace
- Tidak ada konflik policy antar sumber
