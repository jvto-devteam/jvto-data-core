# Phase 3: Operational Master Data

Extract master data operasional dari new-backoffice MySQL.

## Sumber Data

MySQL lokal: 127.0.0.1:3007, DB: jvto, user: root

## Tables

- hotels, room_hotels
- vendors, guide_drivers
- cars (vehicles)
- destinations, activities
- price_tiers

## Output

- `output/hotels.json`
- `output/vendors.json`
- `output/crews.json`
- `output/vehicles.json`
- `output/destinations.json`
- `output/activities.json`

## Subagents

Spawn subagents paralel per entity type.

## Validation

- Setiap entity punya id, name, status
- Hitung completeness score per record
- Deteksi duplikat
