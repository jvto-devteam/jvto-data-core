export const meta = {
  name: 'phase-1-packages',
  description: 'Extract package data from 3 sources and merge into phases/phase-1-packages/output/',
  phases: [
    { title: 'Extract', detail: 'Parallel extraction from llm-wiki (gh api), jvto-web (gh api), backoffice (MySQL)' },
    { title: 'Merge & Write', detail: 'Merge, conflict detection, write 3 output files' },
  ],
}

const PACKAGE_SCHEMA = {
  type: 'object',
  properties: {
    source: { type: 'string' },
    packages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          package_id: { type: 'string' },
          name: { type: 'string' },
          slug: { type: 'string' },
          duration: { type: 'string' },
          origin: { type: 'string' },
          public_url: { type: 'string' },
          destinations: { type: 'array', items: { type: 'string' } },
          price_tiers: { type: 'array', items: { type: 'object' } },
          flags: { type: 'object' },
          db_id: { type: 'number' },
          is_publish: { type: 'boolean' }
        },
        required: ['package_id', 'slug', 'name']
      }
    },
    total_packages: { type: 'number' },
    sha_registry: { type: 'string' },
    sha_pricing: { type: 'string' },
    notes: { type: 'string' }
  },
  required: ['source', 'packages', 'total_packages']
}

phase('Extract')

const [wikiData, webData, backofficeData] = await parallel([

  () => agent(`
You are extractor-llm-wiki. Extract package data from GitHub repo sambuko82/llm-wiki.

Run these commands:

\`\`\`bash
# Get registry + pricing files
REGISTRY=$(gh api repos/sambuko82/llm-wiki/contents/output/products/package-readiness/package-registry.json | jq -r '{sha: .sha, content: .content}')
REGISTRY_SHA=$(echo "$REGISTRY" | jq -r '.sha')
REGISTRY_DATA=$(echo "$REGISTRY" | jq -r '.content' | base64 -d)

PRICING=$(gh api repos/sambuko82/llm-wiki/contents/output/products/package-readiness/package-pricing.json | jq -r '{sha: .sha, content: .content}')
PRICING_SHA=$(echo "$PRICING" | jq -r '.sha')
PRICING_DATA=$(echo "$PRICING" | jq -r '.content' | base64 -d)

echo "REGISTRY_SHA=$REGISTRY_SHA"
echo "PRICING_SHA=$PRICING_SHA"
echo "=== REGISTRY ==="
echo "$REGISTRY_DATA"
echo "=== PRICING ==="
echo "$PRICING_DATA"
\`\`\`

After getting the raw data, merge registry + pricing by package_id/slug to produce:
- For each package: { package_id, name (from title), slug, duration, origin, public_url, destinations (derive from title/slug: ["Bromo"] or ["Bromo","Ijen"] etc), flags: {ijen_relevant, visits_madakaripura, is_specialty}, price_tiers: [{min_pax, max_pax, price_idr, currency}], ferry_included }
- source_trace: { repo: "llm-wiki", registry_path: "output/products/package-readiness/package-registry.json", pricing_path: "...", sha_registry, sha_pricing }

Return JSON:
{
  "source": "llm-wiki",
  "packages": [...],
  "total_packages": 16,
  "sha_registry": "...",
  "sha_pricing": "...",
  "notes": "..."
}
`, { label: 'extractor-llm-wiki', phase: 'Extract', schema: PACKAGE_SCHEMA }),

  () => agent(`
You are extractor-jvto-web. Extract package data from GitHub repo jvto-devteam/jvto-web.

Run these commands:

\`\`\`bash
REGISTRY=$(gh api repos/jvto-devteam/jvto-web/contents/src/data/package-readiness/package-registry.json | jq -r '{sha: .sha, content: .content}')
REGISTRY_SHA=$(echo "$REGISTRY" | jq -r '.sha')
REGISTRY_DATA=$(echo "$REGISTRY" | jq -r '.content' | base64 -d)

PRICING=$(gh api repos/jvto-devteam/jvto-web/contents/src/data/package-readiness/package-pricing.json | jq -r '{sha: .sha, content: .content}')
PRICING_SHA=$(echo "$PRICING" | jq -r '.sha')
PRICING_DATA=$(echo "$PRICING" | jq -r '.content' | base64 -d)

echo "REGISTRY_SHA=$REGISTRY_SHA"
echo "PRICING_SHA=$PRICING_SHA"
echo "=== REGISTRY ==="
echo "$REGISTRY_DATA"
echo "=== PRICING ==="
echo "$PRICING_DATA"
\`\`\`

Merge registry + pricing by slug. Same output format as llm-wiki extractor but source="jvto-web" and paths are src/data/package-readiness/*.

Return JSON:
{
  "source": "jvto-web",
  "packages": [...],
  "total_packages": 16,
  "sha_registry": "...",
  "sha_pricing": "...",
  "notes": "if SHAs match llm-wiki, note 'identical to llm-wiki'"
}
`, { label: 'extractor-jvto-web', phase: 'Extract', schema: PACKAGE_SCHEMA }),

  () => agent(`
You are extractor-backoffice. Extract package data from a local MySQL database.

The DB credentials (from /Users/macbook/Code/new-backoffice/.env):
- Host: 127.0.0.1
- Port: 3007
- Database: jvto
- User: root
- Password: (empty)

Run these MySQL queries:

\`\`\`bash
# Packages with duration name
mysql -h 127.0.0.1 -P 3007 -u root jvto --batch --silent -e "
SELECT p.id, p.slug, p.name, p.is_publish, p.code, d.name as duration_name
FROM packages p
LEFT JOIN durations d ON p.duration_id = d.id
WHERE p.id IN (73,48,47,29,28,85,65,86,91,63,80,32,33,34,54,56,43,55,74,82,83,84)
ORDER BY p.id;
" 2>/dev/null

# Package prices
mysql -h 127.0.0.1 -P 3007 -u root jvto --batch --silent -e "
SELECT pp.package_id, pp.price, pp.klook_retail_price, pt.name as price_tier_name, pt.min_pax, pt.max_pax
FROM package_prices pp
LEFT JOIN price_tiers pt ON pp.price_tier_id = pt.id
WHERE pp.package_id IN (73,48,47,29,28,85,65,86,91,63,80,32,33,34,54,56,43,55,74,82,83,84)
ORDER BY pp.package_id, pt.min_pax;
" 2>/dev/null

# Package destinations
mysql -h 127.0.0.1 -P 3007 -u root jvto --batch --silent -e "
SELECT pd.package_id, d.name as destination_name
FROM package_destinations pd
LEFT JOIN destinations d ON pd.destination_id = d.id
WHERE pd.package_id IN (73,48,47,29,28,85,65,86,91,63,80,32,33,34,54,56,43,55,74,82,83,84)
ORDER BY pd.package_id, pd.sort_order;
" 2>/dev/null
\`\`\`

Combine the results into package objects. Map DB slug to match static JSON slugs (DB may use different casing or format — normalize to lowercase-hyphenated).

For price_tiers, use DB prices (price field, in IDR). If price_tiers table has min_pax/max_pax use those, otherwise just include the price.

Return JSON:
{
  "source": "new-backoffice",
  "packages": [
    {
      "package_id": "bromo-1d1n",
      "name": "...",
      "slug": "bromo-1d1n",
      "duration": "1D1N",
      "db_id": 73,
      "is_publish": true,
      "destinations": ["Bromo"],
      "price_tiers": [{"min_pax": 2, "max_pax": 2, "price_idr": 1550000}, ...]
    }
  ],
  "total_packages": 22,
  "notes": "..."
}

If MySQL is not reachable, return: { "source": "new-backoffice", "packages": [], "total_packages": 0, "notes": "mysql unreachable: <error>" }
`, { label: 'extractor-backoffice', phase: 'Extract', schema: PACKAGE_SCHEMA }),
])

phase('Merge & Write')

log('All extractors done — merging...')

const wiki = wikiData || { source: 'llm-wiki', packages: [], total_packages: 0, notes: 'failed' }
const web = webData || { source: 'jvto-web', packages: [], total_packages: 0, notes: 'failed' }
const bo = backofficeData || { source: 'new-backoffice', packages: [], total_packages: 0, notes: 'failed' }

// Index by slug for merging
function indexBySlug(pkgList) {
  const idx = {}
  for (const p of (pkgList || [])) {
    idx[p.slug] = p
  }
  return idx
}

const wikiIdx = indexBySlug(wiki.packages)
const webIdx = indexBySlug(web.packages)
const boIdx = indexBySlug(bo.packages)

// Union of all slugs
const allSlugs = [...new Set([
  ...Object.keys(wikiIdx),
  ...Object.keys(webIdx),
  ...Object.keys(boIdx),
])]

const mergedPackages = []
const sourceTrace = []
const conflicts = []

for (const slug of allSlugs) {
  const w = wikiIdx[slug]
  const wv = webIdx[slug]
  const b = boIdx[slug]

  // Canonical record: prefer wiki (most complete static data)
  const canonical = w || wv || b
  const merged = {
    package_id: canonical.package_id || slug,
    name: canonical.name,
    slug,
    duration: canonical.duration || (b && b.duration) || null,
    origin: canonical.origin || null,
    public_url: canonical.public_url || null,
    destinations: canonical.destinations || (b && b.destinations) || [],
    flags: canonical.flags || {},
    ferry_included: canonical.ferry_included || null,
    price_tiers: canonical.price_tiers || [],
    db_id: b ? b.db_id : null,
    is_publish: b ? b.is_publish : null,
    sources: [],
    confidence: 'high',
  }

  const sources = []
  if (w) sources.push({ repo: 'llm-wiki', sha_registry: wiki.sha_registry, sha_pricing: wiki.sha_pricing })
  if (wv) sources.push({ repo: 'jvto-web', sha_registry: web.sha_registry, sha_pricing: web.sha_pricing })
  if (b) sources.push({ repo: 'new-backoffice', db_id: b.db_id, is_publish: b.is_publish })
  merged.sources = sources

  if (sources.length < 3) merged.confidence = 'medium'
  if (sources.length < 2) merged.confidence = 'low'

  mergedPackages.push(merged)

  // Source trace entry
  sourceTrace.push({
    entity_id: slug,
    entity_type: 'package',
    sources: sources.map(s => ({
      ...s,
      extracted_at: '2026-06-13',
    }))
  })

  // Conflict detection: compare prices between static JSON and backoffice DB
  if (w && b && w.price_tiers && w.price_tiers.length > 0 && b.price_tiers && b.price_tiers.length > 0) {
    // Compare lowest tier price as a proxy
    const wikiMin = Math.min(...w.price_tiers.map(t => t.price_idr || t.idr_per_person || 0).filter(v => v > 0))
    const boMin = Math.min(...b.price_tiers.map(t => t.price_idr || t.price || 0).filter(v => v > 0))
    if (wikiMin > 0 && boMin > 0 && Math.abs(wikiMin - boMin) / wikiMin > 0.05) {
      conflicts.push({
        package_id: slug,
        conflict_type: 'price_mismatch',
        llm_wiki_min_price: wikiMin,
        jvto_web_min_price: wikiMin,
        backoffice_min_price: boMin,
        delta_pct: Math.round(Math.abs(wikiMin - boMin) / wikiMin * 100),
        severity: Math.abs(wikiMin - boMin) / wikiMin > 0.15 ? 'high' : 'medium',
      })
    }
  }

  // Name conflict
  if (w && b && w.name && b.name && w.name.toLowerCase() !== b.name.toLowerCase()) {
    conflicts.push({
      package_id: slug,
      conflict_type: 'name_mismatch',
      llm_wiki_name: w.name,
      backoffice_name: b.name,
      severity: 'low',
    })
  }
}

const packages_json = {
  generated_at: '2026-06-13',
  total_packages: mergedPackages.length,
  sources_used: ['llm-wiki', 'jvto-web', 'new-backoffice'],
  packages: mergedPackages,
}

const sources_json = {
  generated_at: '2026-06-13',
  entity_type: 'package',
  total_entities: sourceTrace.length,
  entities: sourceTrace,
}

const conflicts_json = {
  generated_at: '2026-06-13',
  total_conflicts: conflicts.length,
  conflicts,
  notes: [
    wiki.sha_registry === web.sha_registry
      ? 'llm-wiki and jvto-web package-registry.json are IDENTICAL (same SHA)'
      : 'llm-wiki and jvto-web have different registry files',
    wiki.sha_pricing === web.sha_pricing
      ? 'llm-wiki and jvto-web package-pricing.json are IDENTICAL (same SHA)'
      : 'llm-wiki and jvto-web have different pricing files',
    `backoffice contributed ${bo.total_packages} packages`,
  ].filter(Boolean),
}

// Write all 3 files
await agent(`
Create directory and write 3 JSON files to phases/phase-1-packages/output/ in /Users/macbook/Code/jvto-data-core.

Run:
mkdir -p /Users/macbook/Code/jvto-data-core/phases/phase-1-packages/output

Write these exact JSON contents to these files using Node.js (node -e "...") or a heredoc. Use node for reliability with large JSON:

FILE 1: /Users/macbook/Code/jvto-data-core/phases/phase-1-packages/output/packages.json
Content:
${JSON.stringify(packages_json, null, 2)}

FILE 2: /Users/macbook/Code/jvto-data-core/phases/phase-1-packages/output/package-sources.json
Content:
${JSON.stringify(sources_json, null, 2)}

FILE 3: /Users/macbook/Code/jvto-data-core/phases/phase-1-packages/output/package-conflicts.json
Content:
${JSON.stringify(conflicts_json, null, 2)}

After writing, verify all 3 files exist and are valid JSON:
jq '.total_packages' /Users/macbook/Code/jvto-data-core/phases/phase-1-packages/output/packages.json
jq '.total_entities' /Users/macbook/Code/jvto-data-core/phases/phase-1-packages/output/package-sources.json
jq '.total_conflicts' /Users/macbook/Code/jvto-data-core/phases/phase-1-packages/output/package-conflicts.json

Report: "Written OK - packages: N, entities: N, conflicts: N" or any error.
`, { label: 'write-outputs', phase: 'Merge & Write' })

return {
  total_packages: mergedPackages.length,
  total_conflicts: conflicts.length,
  wiki_total: wiki.total_packages,
  web_total: web.total_packages,
  bo_total: bo.total_packages,
  sha_match: wiki.sha_registry === web.sha_registry,
}
