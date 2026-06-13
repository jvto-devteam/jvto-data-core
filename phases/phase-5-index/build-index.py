import json
from pathlib import Path

BASE = Path("/Users/macbook/Code/jvto-data-core/phases")
P5 = Path("/Users/macbook/Code/jvto-data-core/phases/phase-5-index")

# Load sources
packages_data = json.loads((BASE / "phase-1-packages/output/packages.json").read_text())
trust_data = json.loads((BASE / "phase-2-trust/output/trust-claims.json").read_text())
policies_data = json.loads((BASE / "phase-2-trust/output/policies.json").read_text())
faq_data = json.loads((BASE / "phase-2-trust/output/faq-snippets.json").read_text())

packages = packages_data["packages"]
trust_claims = trust_data["trust_claims"]
policies = policies_data["policies"]
faqs = faq_data["faq"]

DEST_NORMALIZE = {
    "bromo": "dest_bromo",
    "mount bromo": "dest_bromo",
    "ijen": "dest_ijen",
    "mount ijen": "dest_ijen",
    "madakaripura": "dest_madakaripura",
    "madakaripura waterfall": "dest_madakaripura",
    "tumpak sewu": "dest_tumpak_sewu",
    "tumpak sewu waterfall": "dest_tumpak_sewu",
    "papuma": "dest_papuma",
    "papuma beach": "dest_papuma",
    "malang": "dest_malang",
    "malang city": "dest_malang",
    "taman safari prigen": "dest_taman_safari_prigen",
}

DEST_LABELS = {
    "dest_bromo": "Mount Bromo",
    "dest_ijen": "Mount Ijen (Kawah Ijen)",
    "dest_madakaripura": "Madakaripura Waterfall",
    "dest_tumpak_sewu": "Tumpak Sewu Waterfall",
    "dest_papuma": "Papuma Beach",
    "dest_malang": "Malang City",
    "dest_taman_safari_prigen": "Taman Safari Prigen",
}

ORIGINS = {"surabaya", "bali", "surabaya city"}


def get_canonical_dests(pkg):
    seen = set()
    result = []
    for d in pkg.get("destinations", []):
        norm = DEST_NORMALIZE.get(d.lower())
        if norm and norm not in seen:
            seen.add(norm)
            result.append(norm)
    return result


def get_min_price(pkg):
    prices = [t["price_idr"] for t in pkg.get("price_tiers", []) if t.get("price_idr")]
    return min(prices) if prices else None


def safe_id(pkg_id):
    return pkg_id.replace("/", "_").replace("-", "_")


def make_pkg_content(pkg):
    name = pkg["name"]
    duration = pkg.get("duration", "")
    origin = (pkg.get("origin") or "").title()
    canonical_dests = get_canonical_dests(pkg)
    dest_labels = [DEST_LABELS[d] for d in canonical_dests]
    min_price = get_min_price(pkg)
    flags = pkg.get("flags", {})

    parts = [f"{name}."]
    parts.append(f"Duration: {duration}.")
    parts.append(f"Departing from: {origin}.")
    if dest_labels:
        parts.append(f"Destinations: {', '.join(dest_labels)}.")
    if min_price:
        parts.append(f"Price from IDR {min_price:,} per person (group of 2+).")
    if pkg.get("ferry_included"):
        parts.append("Bali-Java ferry crossing included.")
    if flags.get("ijen_relevant"):
        parts.append("Includes Kawah Ijen crater — health screening required (BBKSDA SE.1658/KSA.9/2024).")
    if flags.get("visits_madakaripura"):
        parts.append("Includes Madakaripura Waterfall — Indonesia's tallest waterfall.")
    if flags.get("is_specialty"):
        parts.append("Specialty tour with unique family-friendly or wildlife experiences.")
    parts.append("Private tour: dedicated vehicle and crew, no mixed groups.")
    parts.append("All-inclusive: private AC vehicle, accommodation with breakfast, entrance fees, licensed English-speaking guide, Ijen gas mask and safety gear when applicable.")
    parts.append(f"Data confidence: {pkg.get('confidence', 'unknown')}.")
    return " ".join(parts)


def extract_keywords(pkg):
    name = pkg["name"].lower()
    duration = (pkg.get("duration") or "").lower().replace(" ", "")
    origin = (pkg.get("origin") or "").lower()
    flags = pkg.get("flags", {})

    kws = set()
    # Destinations
    for kw in ["bromo", "ijen", "madakaripura", "tumpak sewu", "papuma", "malang", "taman safari"]:
        if kw in name:
            kws.add(kw.replace(" ", "-"))
    # Duration codes
    for code in ["1d1n", "2d1n", "3d2n", "4d3n", "5d4n", "6d5n"]:
        if code in duration:
            kws.add(code)
        # Also add just the day count
    for d in ["1d", "2d", "3d", "4d", "5d", "6d"]:
        if d in duration:
            kws.add(d)
    # Activities
    for kw in ["midnight", "sunrise", "blue fire", "crater", "waterfall", "beach", "safari", "volcano", "overland", "expedition", "discovery"]:
        if kw in name:
            kws.add(kw.replace(" ", "-"))
    # Origin
    if origin in {"surabaya", "bali"}:
        kws.add(origin)
    elif "surabaya" in origin:
        kws.add("surabaya")
    elif "bali" in origin:
        kws.add("bali")
    # Flag-derived
    if flags.get("ijen_relevant"):
        kws.add("ijen")
        kws.add("blue-fire")
    if flags.get("ferry_included") or pkg.get("ferry_included"):
        kws.add("ferry")
    return sorted(kws)


# ── RAG CHUNKS ──────────────────────────────────────────────────────────────
chunks = []

for pkg in packages:
    pid = pkg["package_id"]
    sources = [s.get("repo", "") for s in pkg.get("sources", []) if s.get("repo")]
    chunks.append({
        "chunk_id": f"pkg_{safe_id(pid)}_chunk_1",
        "entity_type": "package",
        "entity_id": pid,
        "content": make_pkg_content(pkg),
        "metadata": {
            "source": ", ".join(dict.fromkeys(sources)) or "llm-wiki",
            "confidence": pkg.get("confidence", "medium"),
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
        "metadata": {
            "source": policy.get("source", "llm-wiki"),
            "confidence": "high",
            "freshness": "fresh",
        },
    })

for i, faq in enumerate(faqs):
    faq_id = f"faq_{faq['category']}_{i + 1}"
    chunks.append({
        "chunk_id": f"{faq_id}_chunk_1",
        "entity_type": "faq",
        "entity_id": faq_id,
        "content": f"FAQ: {faq['question']} Answer: {faq['answer']}",
        "metadata": {
            "source": "llm-wiki",
            "confidence": "high",
            "freshness": "fresh",
        },
    })

rag_output = {
    "generated_at": "2026-06-13",
    "total_chunks": len(chunks),
    "chunk_types": {
        "package": sum(1 for c in chunks if c["entity_type"] == "package"),
        "trust": sum(1 for c in chunks if c["entity_type"] == "trust"),
        "policy": sum(1 for c in chunks if c["entity_type"] == "policy"),
        "faq": sum(1 for c in chunks if c["entity_type"] == "faq"),
    },
    "chunks": chunks,
}

# ── ENTITY GRAPH ─────────────────────────────────────────────────────────────
nodes = []
edges = []

# Canonical destination nodes
all_dests = set()
for pkg in packages:
    all_dests.update(get_canonical_dests(pkg))

for dest_id in sorted(all_dests):
    nodes.append({
        "id": dest_id,
        "type": "destination",
        "label": DEST_LABELS.get(dest_id, dest_id),
    })

# Package nodes + edges
for pkg in packages:
    pid = pkg["package_id"]
    min_price = get_min_price(pkg)
    nodes.append({
        "id": pid,
        "type": "package",
        "label": pkg["name"],
        "properties": {
            "duration": pkg.get("duration"),
            "origin": pkg.get("origin"),
            "min_price_idr": min_price,
            "confidence": pkg.get("confidence"),
            "ijen_relevant": pkg.get("flags", {}).get("ijen_relevant", False),
            "visits_madakaripura": pkg.get("flags", {}).get("visits_madakaripura", False),
            "is_specialty": pkg.get("flags", {}).get("is_specialty", False),
            "ferry_included": bool(pkg.get("ferry_included")),
        },
    })
    # package → destination
    for dest_id in get_canonical_dests(pkg):
        edges.append({"source": pid, "target": dest_id, "relation": "includes"})
    # ijen packages → health screening policy
    if pkg.get("flags", {}).get("ijen_relevant"):
        edges.append({"source": pid, "target": "policy_health_screening_ijen", "relation": "requires"})

# Policy nodes
for policy in policies:
    nodes.append({
        "id": policy["policy_id"],
        "type": "policy",
        "label": policy["name"],
        "properties": {
            "category": policy["category"],
            "source": policy.get("source"),
        },
    })

# Trust nodes
for claim in trust_claims:
    nodes.append({
        "id": claim["claim_id"],
        "type": "trust",
        "label": claim["claim"][:70] + ("..." if len(claim["claim"]) > 70 else ""),
        "properties": {
            "category": claim["category"],
            "validation": claim.get("validation"),
        },
    })

graph_output = {
    "generated_at": "2026-06-13",
    "total_nodes": len(nodes),
    "total_edges": len(edges),
    "node_types": {
        t: sum(1 for n in nodes if n["type"] == t)
        for t in ["package", "destination", "policy", "trust"]
    },
    "edge_relations": {
        r: sum(1 for e in edges if e["relation"] == r)
        for r in ["includes", "requires"]
    },
    "nodes": nodes,
    "edges": edges,
}

# ── SEARCH INDEX ─────────────────────────────────────────────────────────────
documents = []

for pkg in packages:
    pid = pkg["package_id"]
    canonical_dests = get_canonical_dests(pkg)
    dest_labels = [DEST_LABELS[d] for d in canonical_dests]
    min_price = get_min_price(pkg)
    origin = pkg.get("origin", "")

    documents.append({
        "id": pid,
        "type": "package",
        "title": pkg["name"],
        "content": make_pkg_content(pkg),
        "keywords": extract_keywords(pkg),
        "searchable_fields": {
            "name": pkg["name"],
            "destinations": ", ".join(dest_labels),
            "origin": origin,
            "duration": pkg.get("duration", ""),
            "price_from_idr": str(min_price) if min_price else "",
            "confidence": pkg.get("confidence", ""),
            "ferry_included": "yes" if pkg.get("ferry_included") else "no",
            "ijen_relevant": "yes" if pkg.get("flags", {}).get("ijen_relevant") else "no",
        },
    })

for claim in trust_claims:
    cid = claim["claim_id"]
    text = f"{claim['claim']} {claim['category']}".lower()
    kws = [claim["category"]]
    for kw in ["safety", "policy", "credential", "review", "payment", "refund", "cancellation", "guide", "partner", "press"]:
        if kw in text:
            kws.append(kw)
    documents.append({
        "id": cid,
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
    pid = policy["policy_id"]
    text = f"{policy['name']} {policy['description']} {policy['category']}".lower()
    kws = [policy["category"]]
    for kw in ["cancellation", "refund", "payment", "deposit", "safety", "ijen", "health", "inclusion", "exclusion", "vehicle", "klook", "insurance", "visa", "ferry"]:
        if kw in text:
            kws.append(kw)
    documents.append({
        "id": pid,
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
    for kw in ["safety", "cancellation", "refund", "payment", "deposit", "ijen", "bromo", "health", "private", "review", "guide", "insurance", "visa", "season", "time", "temperature"]:
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
    "generated_at": "2026-06-13",
    "total_documents": len(documents),
    "document_types": {
        t: sum(1 for d in documents if d["type"] == t)
        for t in ["package", "trust", "policy", "faq"]
    },
    "documents": documents,
}

# ── WRITE FILES ───────────────────────────────────────────────────────────────
out_dir = P5 / "indexes"
out_dir.mkdir(exist_ok=True)

(out_dir / "rag-chunks.json").write_text(json.dumps(rag_output, indent=2, ensure_ascii=False))
(out_dir / "entity-graph.json").write_text(json.dumps(graph_output, indent=2, ensure_ascii=False))
(out_dir / "search-index.json").write_text(json.dumps(search_output, indent=2, ensure_ascii=False))

print(f"RAG chunks: {len(chunks)} ({rag_output['chunk_types']})")
print(f"Graph: {len(nodes)} nodes, {len(edges)} edges ({graph_output['node_types']})")
print(f"Search: {len(documents)} documents ({search_output['document_types']})")
print("Done. Written to indexes/")
