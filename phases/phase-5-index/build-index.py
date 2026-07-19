#!/usr/bin/env python3
"""
Phase 5 — build AI-ready indexes (RAG chunks, entity graph, search index).

Rewritten for the CURRENT nested `packages.json` schema (web-API, `packageId` +
`product.*`). Everything package-derived is keyed on the canonical **`packageId`**
(e.g. `package-SUB-4D3N-001`) so the search/graph/RAG layer joins to what the MCP
tools (`search_packages`/`get_package`) actually serve. This replaces the previous
build, which was written for the old flat schema (slug `package_id`) and left the
indexes describing a superseded 35-entity world that no longer resolved.

Paths are repo-relative (runs anywhere). Inputs are all committed, so this runs
offline with no DB. Trust/policy/faq handling is unchanged (phase-2 files as-is).
"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]      # .../phases
P5 = Path(__file__).resolve().parent            # .../phase-5-index

packages_data = json.loads((BASE / "phase-1-packages/output/packages.json").read_text())
sources_data = json.loads((BASE / "phase-1-packages/output/package-sources.json").read_text())
trust_data = json.loads((BASE / "phase-2-trust/output/trust-claims.json").read_text())
policies_data = json.loads((BASE / "phase-2-trust/output/policies.json").read_text())
faq_data = json.loads((BASE / "phase-2-trust/output/faq-snippets.json").read_text())

packages = packages_data["packages"]
trust_claims = trust_data["trust_claims"]
policies = policies_data["policies"]
faqs = faq_data["faq"]

# Stamp indexes with the SAME snapshot id as their package source, so a staleness
# check (index generated_at >= packages generated_at) holds by construction.
GEN = packages_data.get("generated_at", "unknown")

DEST_PATTERNS = [
    ("ijen", "dest_ijen"),
    ("bromo", "dest_bromo"),
    ("madakaripura", "dest_madakaripura"),
    ("tumpak sewu", "dest_tumpak_sewu"),
    ("papuma", "dest_papuma"),
    ("taman safari", "dest_taman_safari_prigen"),
    ("malang", "dest_malang"),
]
DEST_LABELS = {
    "dest_bromo": "Mount Bromo",
    "dest_ijen": "Mount Ijen (Kawah Ijen)",
    "dest_madakaripura": "Madakaripura Waterfall",
    "dest_tumpak_sewu": "Tumpak Sewu Waterfall",
    "dest_papuma": "Papuma Beach",
    "dest_malang": "Malang City",
    "dest_taman_safari_prigen": "Taman Safari Prigen",
}


def safe_id(pkg_id: str) -> str:
    return pkg_id.replace("/", "_").replace("-", "_")


def get_canonical_dests(prod: dict) -> list:
    seen, result = set(), []
    for item in prod.get("route", []) or []:
        low = str(item).lower()
        for pat, did in DEST_PATTERNS:
            if pat in low and did not in seen:
                seen.add(did)
                result.append(did)
    return result


def get_min_price(prod: dict):
    off = prod.get("offers", {}) or {}
    lp = (off.get("aggregateOffer") or {}).get("lowPrice")
    if lp:
        return lp
    tiers = [t.get("pricePerPerson") for t in (off.get("tiers") or []) if t.get("pricePerPerson")]
    return min(tiers) if tiers else None


def get_flags(prod: dict) -> dict:
    hay = " ".join([
        prod.get("name", "") or "",
        " ".join(prod.get("route", []) or []),
        " ".join(prod.get("tags", []) or []),
    ]).lower()
    origin = (prod.get("originCity") or "").lower()
    end = (prod.get("endCity") or prod.get("originCity") or "").lower()
    return {
        "ijen_relevant": "ijen" in hay,
        "visits_madakaripura": "madakaripura" in hay,
        "is_specialty": any(k in hay for k in ("safari", "family", "wildlife", "specialty")),
        "ferry_included": bool(origin and end and origin != end),
    }


# slug-tail -> source repos, bridging the scheme-A packages to scheme-B source lineage.
def _tail(s: str) -> str:
    return str(s or "").rstrip("/").split("/")[-1]


SRC_BY_TAIL = {}
for e in sources_data.get("entities", []):
    repos = sorted({s.get("repo") for s in e.get("sources", []) if s.get("repo")})
    SRC_BY_TAIL[_tail(e.get("entity_id", ""))] = repos


def pkg_source_repos(prod: dict) -> list:
    return SRC_BY_TAIL.get(_tail(prod.get("slug")), [])


def make_pkg_content(pkg: dict) -> str:
    prod = pkg["product"]
    name = prod["name"]
    duration = prod.get("marketedDurationLabel", "")
    origin = (prod.get("originCity") or "").title()
    labels = [DEST_LABELS[d] for d in get_canonical_dests(prod)]
    price = get_min_price(prod)
    flags = get_flags(prod)

    parts = [f"{name}.", f"Duration: {duration}.", f"Departing from: {origin}."]
    if labels:
        parts.append(f"Destinations: {', '.join(labels)}.")
    if price:
        parts.append(f"Price from IDR {price:,} per person (group of 2+).")
    if flags["ferry_included"]:
        parts.append("Bali-Java ferry crossing included.")
    if flags["ijen_relevant"]:
        parts.append("Includes Kawah Ijen crater — health screening required (BBKSDA SE.1658/KSA.9/2024).")
    if flags["visits_madakaripura"]:
        parts.append("Includes Madakaripura Waterfall — Indonesia's tallest waterfall.")
    if flags["is_specialty"]:
        parts.append("Specialty tour with unique family-friendly or wildlife experiences.")
    parts.append("Private tour: dedicated vehicle and crew, no mixed groups.")
    parts.append("All-inclusive: private AC vehicle, accommodation with breakfast, entrance fees, "
                 "licensed English-speaking guide, Ijen gas mask and safety gear when applicable.")
    return " ".join(parts)


def extract_keywords(pkg: dict) -> list:
    prod = pkg["product"]
    name = (prod.get("name") or "").lower()
    duration = (prod.get("marketedDurationLabel") or "").lower().replace(" ", "")
    origin = (prod.get("originCity") or "").lower()
    route = " ".join(prod.get("route", []) or []).lower()
    hay = f"{name} {route}"
    flags = get_flags(prod)

    kws = set()
    for kw in ["bromo", "ijen", "madakaripura", "tumpak sewu", "papuma", "malang", "taman safari"]:
        if kw in hay:
            kws.add(kw.replace(" ", "-"))
    for code in ["1d1n", "2d1n", "3d2n", "4d3n", "5d4n", "6d5n"]:
        if code in duration:
            kws.add(code)
    for d in ["1d", "2d", "3d", "4d", "5d", "6d"]:
        if d in duration:
            kws.add(d)
    for kw in ["midnight", "sunrise", "blue fire", "crater", "waterfall", "beach",
               "safari", "volcano", "overland", "expedition", "discovery"]:
        if kw in name:
            kws.add(kw.replace(" ", "-"))
    if "surabaya" in origin:
        kws.add("surabaya")
    elif "bali" in origin:
        kws.add("bali")
    if flags["ijen_relevant"]:
        kws.update({"ijen", "blue-fire"})
    if flags["ferry_included"]:
        kws.add("ferry")
    return sorted(kws)


# ── RAG CHUNKS ──────────────────────────────────────────────────────────────
chunks = []
for pkg in packages:
    prod = pkg["product"]
    pid = pkg["packageId"]
    repos = pkg_source_repos(prod)
    chunks.append({
        "chunk_id": f"pkg_{safe_id(pid)}_chunk_1",
        "entity_type": "package",
        "entity_id": pid,
        "content": make_pkg_content(pkg),
        "metadata": {
            "source": ", ".join(repos) or "jvto-web-api",
            "confidence": "high",
            "freshness": "fresh",
        },
    })

for claim in trust_claims:
    evidence_summary = "; ".join(claim.get("evidence", [])[:3])
    chunks.append({
        "chunk_id": f"trust_{claim['claim_id']}_chunk_1",
        "entity_type": "trust",
        "entity_id": claim["claim_id"],
        "content": (
            f"JVTO Trust Claim ({claim['category']}): {claim['claim']} "
            f"Evidence: {evidence_summary}. "
            f"Validation: {claim.get('validation', 'unknown')}."
        ),
        "metadata": {
            "source": claim.get("source_trace", {}).get("repo", "llm-wiki"),
            "confidence": "high" if claim.get("validation") == "pass" else "medium",
            "freshness": "fresh",
        },
    })

for policy in policies:
    chunks.append({
        "chunk_id": f"policy_{policy['policy_id']}_chunk_1",
        "entity_type": "policy",
        "entity_id": policy["policy_id"],
        "content": f"JVTO Policy — {policy['name']}: {policy['description']} Category: {policy['category']}.",
        "metadata": {"source": policy.get("source", "llm-wiki"), "confidence": "high", "freshness": "fresh"},
    })

for i, faq in enumerate(faqs):
    faq_id = f"faq_{faq['category']}_{i + 1}"
    chunks.append({
        "chunk_id": f"{faq_id}_chunk_1",
        "entity_type": "faq",
        "entity_id": faq_id,
        "content": f"FAQ: {faq['question']} Answer: {faq['answer']}",
        "metadata": {"source": "llm-wiki", "confidence": "high", "freshness": "fresh"},
    })

rag_output = {
    "generated_at": GEN,
    "total_chunks": len(chunks),
    "chunk_types": {t: sum(1 for c in chunks if c["entity_type"] == t)
                    for t in ["package", "trust", "policy", "faq"]},
    "chunks": chunks,
}

# ── ENTITY GRAPH ─────────────────────────────────────────────────────────────
nodes, edges = [], []
all_dests = set()
for pkg in packages:
    all_dests.update(get_canonical_dests(pkg["product"]))
for dest_id in sorted(all_dests):
    nodes.append({"id": dest_id, "type": "destination", "label": DEST_LABELS.get(dest_id, dest_id)})

for pkg in packages:
    prod = pkg["product"]
    pid = pkg["packageId"]
    flags = get_flags(prod)
    nodes.append({
        "id": pid,
        "type": "package",
        "label": prod["name"],
        "properties": {
            "duration": prod.get("marketedDurationLabel"),
            "origin": prod.get("originCity"),
            "min_price_idr": get_min_price(prod),
            "confidence": "high",
            "ijen_relevant": flags["ijen_relevant"],
            "visits_madakaripura": flags["visits_madakaripura"],
            "is_specialty": flags["is_specialty"],
            "ferry_included": flags["ferry_included"],
            "source_repos": pkg_source_repos(prod),
        },
    })
    for dest_id in get_canonical_dests(prod):
        edges.append({"source": pid, "target": dest_id, "relation": "includes"})
    if flags["ijen_relevant"]:
        edges.append({"source": pid, "target": "policy_health_screening_ijen", "relation": "requires"})

for policy in policies:
    nodes.append({
        "id": policy["policy_id"],
        "type": "policy",
        "label": policy["name"],
        "properties": {"category": policy["category"], "source": policy.get("source")},
    })
for claim in trust_claims:
    nodes.append({
        "id": claim["claim_id"],
        "type": "trust",
        "label": claim["claim"][:70] + ("..." if len(claim["claim"]) > 70 else ""),
        "properties": {"category": claim["category"], "validation": claim.get("validation")},
    })

graph_output = {
    "generated_at": GEN,
    "total_nodes": len(nodes),
    "total_edges": len(edges),
    "node_types": {t: sum(1 for n in nodes if n["type"] == t)
                   for t in ["package", "destination", "policy", "trust"]},
    "edge_relations": {r: sum(1 for e in edges if e["relation"] == r) for r in ["includes", "requires"]},
    "nodes": nodes,
    "edges": edges,
}

# ── SEARCH INDEX ─────────────────────────────────────────────────────────────
documents = []
for pkg in packages:
    prod = pkg["product"]
    pid = pkg["packageId"]
    labels = [DEST_LABELS[d] for d in get_canonical_dests(prod)]
    price = get_min_price(prod)
    flags = get_flags(prod)
    documents.append({
        "id": pid,
        "type": "package",
        "title": prod["name"],
        "content": make_pkg_content(pkg),
        "keywords": extract_keywords(pkg),
        "searchable_fields": {
            "name": prod["name"],
            "destinations": ", ".join(labels),
            "origin": prod.get("originCity", ""),
            "duration": prod.get("marketedDurationLabel", ""),
            "price_from_idr": str(price) if price else "",
            "confidence": "high",
            "ferry_included": "yes" if flags["ferry_included"] else "no",
            "ijen_relevant": "yes" if flags["ijen_relevant"] else "no",
        },
    })

for claim in trust_claims:
    text = f"{claim['claim']} {claim['category']}".lower()
    kws = [claim["category"]]
    for kw in ["safety", "policy", "credential", "review", "payment", "refund",
               "cancellation", "guide", "partner", "press"]:
        if kw in text:
            kws.append(kw)
    documents.append({
        "id": claim["claim_id"],
        "type": "trust",
        "title": claim["claim"][:80],
        "content": claim["claim"],
        "keywords": sorted(set(kws)),
        "searchable_fields": {
            "category": claim["category"],
            "validation": claim.get("validation", ""),
            "claim": claim["claim"],
        },
    })

for policy in policies:
    text = f"{policy['name']} {policy['description']} {policy['category']}".lower()
    kws = [policy["category"]]
    for kw in ["cancellation", "refund", "payment", "deposit", "safety", "ijen", "health",
               "inclusion", "exclusion", "vehicle", "klook", "insurance", "visa", "ferry"]:
        if kw in text:
            kws.append(kw)
    documents.append({
        "id": policy["policy_id"],
        "type": "policy",
        "title": policy["name"],
        "content": policy["description"],
        "keywords": sorted(set(kws)),
        "searchable_fields": {
            "name": policy["name"],
            "category": policy["category"],
            "source": policy.get("source", ""),
        },
    })

for i, faq in enumerate(faqs):
    faq_id = f"faq_{faq['category']}_{i + 1}"
    text = f"{faq['question']} {faq['answer']} {faq['category']}".lower()
    kws = [faq["category"]]
    for kw in ["safety", "cancellation", "refund", "payment", "deposit", "ijen", "bromo", "health",
               "private", "review", "guide", "insurance", "visa", "season", "time", "temperature"]:
        if kw in text:
            kws.append(kw)
    documents.append({
        "id": faq_id,
        "type": "faq",
        "title": faq["question"],
        "content": f"Q: {faq['question']} A: {faq['answer']}",
        "keywords": sorted(set(kws)),
        "searchable_fields": {
            "question": faq["question"],
            "category": faq["category"],
            "answer_preview": faq["answer"][:200],
        },
    })

search_output = {
    "generated_at": GEN,
    "total_documents": len(documents),
    "document_types": {t: sum(1 for d in documents if d["type"] == t)
                       for t in ["package", "trust", "policy", "faq"]},
    "documents": documents,
}

# ── WRITE FILES ───────────────────────────────────────────────────────────────
out_dir = P5 / "indexes"
out_dir.mkdir(exist_ok=True)
(out_dir / "rag-chunks.json").write_text(json.dumps(rag_output, indent=2, ensure_ascii=False) + "\n")
(out_dir / "entity-graph.json").write_text(json.dumps(graph_output, indent=2, ensure_ascii=False) + "\n")
(out_dir / "search-index.json").write_text(json.dumps(search_output, indent=2, ensure_ascii=False) + "\n")

print(f"RAG chunks: {len(chunks)} ({rag_output['chunk_types']})")
print(f"Graph: {len(nodes)} nodes, {len(edges)} edges ({graph_output['node_types']})")
print(f"Search: {len(documents)} documents ({search_output['document_types']})")
bridged = sum(1 for p in packages if pkg_source_repos(p["product"]))
print(f"Source-lineage bridged: {bridged}/{len(packages)} packages; stamped generated_at={GEN}")
print("Done. Written to indexes/")
