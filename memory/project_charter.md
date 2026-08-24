---
name: project_charter
description: MATOOL complete data integration hub with Cloudflare D1, stable IDs, and 1:1 sync to Zapier
metadata:
  type: project
---

**Project Status**: Phase 3 active – DATA-01 (Interessenten) ✅ complete at 3.492/3.492 parity; four schema-mismatch Bereiche remain

**Objective**: Complete 1:1 MATOOL→D1 data sync via Cloudflare Workers + D1, replacing silent losses and generic c00 placeholders with stable numeric MATOOL IDs and full relational detail.

**Current Live Four-Phase Errors**:
1. `schueler` (Mitglieder/Schüler): `matool_paginated_list_schema_mismatch` — nested table row structure not matched; 562 stable IDs target; 19 pages
2. `klassen` (Classes): `matool_klassen_detail_schema_mismatch` — pagination broken; 43 classes target; 20-class rotation bug
3. `lager` (Inventory): `matool_exact_list_schema_mismatch` — 168 pages; stable ID mapping missing; ~4,178 rows
4. `newsletter`: `matool_exact_list_schema_mismatch` — 588 unique IDs; formular rows mixed with data rows

**Infrastructure Verified**:
- Cloudflare Workers Paid, D1 Paid, Staging automated GitHub deploy ✅
- Migrations 0001–0005 applied; Lease/Fencing lock in place
- 297/297 automated tests passing
- No contact/email actions; read-only MATOOL only
- Public URL: `https://matool-middleware-staging.soft-hill-4630.workers.dev/`

**Mandatory Work Order**:
1. Fix schueler parser → 562 IDs (DATA-03)
2. Fix klassen schema → 43 classes (DATA-02)
3. Fix lager → all 168 pages, dedupe (related)
4. Fix newsletter → data/form row separation

Then: Complete Interessenten detail register system, member detail hub pages, class relationships, check-in, articles, tests, Zapier v2 activation, production deploy.

**Non-Negotiable Rules**:
- No silent truncation; all fields full length
- Stable numeric MATOOL ID per entity, never payload-hash
- No PII in GitHub or logs; synthetic test data only
- Public repo constraint: mask all outputs
- 1:1 source-to-D1 parity verification per datenbereich before moving next
- Second unchanged run must yield 0 changes
- All four DATA-Mismatch Bereiche must be cleared before advancing to multi-detail register design
