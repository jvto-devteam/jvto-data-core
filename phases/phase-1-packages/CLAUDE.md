# Phase 1: Package Core Extraction

Extract & normalize package data dari 3 sumber.

## Sumber Data

1. llm-wiki/output/products/package-readiness/package-registry.json
2. jvto-web/src/data/package-readiness/package-registry.json
3. new-backoffice /export-data/packages endpoint

## Output

- `output/packages.json` - Clean package data
- `output/package-sources.json` - Source trace
- `output/package-conflicts.json` - Conflict report

## Subagents

Spawn 3 subagents paralel untuk extract dari setiap sumber.
