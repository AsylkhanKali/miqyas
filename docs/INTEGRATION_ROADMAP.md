# MIQYAS — Integration Roadmap

**Last updated:** May 2026  
**Contact:** Miqyasdev@gmail.com

---

## Overview

MIQYAS provides an open REST API and event-driven webhook system that connects to the construction management, EAM, and CMMS tools your teams already use. Progress deviations detected on-site flow automatically into your existing workflows — no manual data entry, no delays.

---

## Current Integration Status

### ✅ Procore (Live)

Full bidirectional integration via OAuth2.

| Capability | Status |
|-----------|--------|
| OAuth2 authorization | ✅ Live |
| RFI creation from deviations | ✅ Live |
| Issue creation | ✅ Live |
| Bulk push (batch sync) | ✅ Live |
| Field mapping (custom templates) | ✅ Live |
| Push audit log | ✅ Live |

**How it works:** When MIQYAS detects a behind-schedule element, it creates an RFI or Issue in your Procore project automatically — with element name, deviation severity, activity context, and recommended action.

---

### ✅ REST API (Live)

A fully documented REST API available at `/api/docs` (OpenAPI 3.0 / Swagger UI).

```
Base URL: https://your-miqyas-instance.com/api/v1
Auth:     X-API-Key: mq_<your-key>
```

**Key endpoints for integration:**

| Endpoint | Description |
|----------|-------------|
| `GET /projects` | List all projects with status |
| `GET /projects/{id}/schedules/{id}/activities` | Full activity list with deviation data |
| `GET /projects/{id}/bim/elements` | BIM elements with progress status |
| `GET /projects/{id}/reports/{id}/download` | Download PDF progress report |
| `POST /api-keys` | Generate API key for your system |

---

### ✅ Webhooks (Live)

Real-time event push to any HTTPS endpoint. Payloads are HMAC-SHA256 signed for security.

**Events:**

| Event | Trigger |
|-------|---------|
| `progress.updated` | CV pipeline recalculates progress for a project |
| `capture.analyzed` | Full site analysis completes (new video uploaded + processed) |
| `deviation.critical` | One or more elements flagged as critically behind schedule |
| `report.ready` | PDF progress report is generated and available for download |

**Setup:**
```http
POST /api/v1/webhooks
{
  "url": "https://your-system.com/miqyas-events",
  "events": ["deviation.critical", "report.ready"],
  "project_id": "<optional, filter by project>"
}
```

**Verifying signatures:**
```python
import hmac, hashlib
expected = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
assert request.headers["X-Miqyas-Signature"] == f"sha256={expected}"
```

---

## Planned Integrations

### 🔜 SAP EAM / SAP PM (Q3 2026)

Target: Companies running SAP Plant Maintenance or SAP S/4HANA Asset Management.

| Capability | Plan |
|-----------|------|
| Work Order creation from deviations | Planned |
| Asset ↔ BIM element mapping | Planned |
| Notification to SAP maintenance queues | Planned |
| Status sync back from SAP → MIQYAS | Planned |

**Data flow:** `MIQYAS deviation detected → SAP Work Order created → Assigned to maintenance team → Completion status synced back`

---

### 🔜 Oracle Primavera Unifier (Q3 2026)

Target: Large-scale infrastructure and capital projects running Oracle Unifier.

| Capability | Plan |
|-----------|------|
| Project status push | Planned |
| RFI and change order creation | Planned |
| Schedule baseline comparison | Planned |
| Two-way progress sync | Planned |

---

### 🔜 IBM Maximo (Q4 2026)

Target: Asset-heavy industries (oil & gas, utilities, heavy construction).

| Capability | Plan |
|-----------|------|
| Work order generation | Planned |
| Asset record linking | Planned |
| Inspection result push | Planned |

---

### 🔜 Microsoft Project + Teams (Q4 2026)

Target: Teams already using Microsoft 365 ecosystem.

| Capability | Plan |
|-----------|------|
| Schedule sync (MS Project XML) | Planned |
| Teams notifications for critical deviations | Planned |
| Power BI data connector | Planned |

---

### 🔜 Fieldwire / PlanGrid (Q4 2026)

Target: Field teams doing punch lists and task management.

| Capability | Plan |
|-----------|------|
| Task creation from deviations | Planned |
| Photo + BIM element linking | Planned |
| Field completion sync | Planned |

---

## Integration Architecture

```
MIQYAS Core
    │
    ├── REST API (/api/v1)          ← Pull: any system queries on demand
    │       Auth: X-API-Key
    │
    ├── Webhooks                    ← Push: events fired on completion
    │       Signed: HMAC-SHA256
    │       Events: progress.updated, deviation.critical,
    │               capture.analyzed, report.ready
    │
    └── Native Integrations
            ├── Procore   (OAuth2 + direct API push)   ✅ Live
            ├── SAP EAM   (REST/OData)                 🔜 Q3 2026
            ├── Oracle    (REST/SOAP)                  🔜 Q3 2026
            ├── Maximo    (REST)                       🔜 Q4 2026
            └── MS Teams  (Bot Framework)              🔜 Q4 2026
```

---

## Getting Started

1. **Request an API key** — contact Miqyasdev@gmail.com or generate via `/api/v1/api-keys`
2. **Browse the API** — live docs at `https://your-instance.com/api/docs`
3. **Register a webhook** — `POST /api/v1/webhooks` with your endpoint URL
4. **Connect Procore** — open Settings → Integrations in the MIQYAS dashboard

For custom integration requirements or enterprise onboarding, contact: **Miqyasdev@gmail.com**
