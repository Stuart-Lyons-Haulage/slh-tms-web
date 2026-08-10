# SLH TMS API contract observed on `main`

Inspected from commit `d7be6f446c5deca58b67042f2461b62d05f7c37f` of `danwilliams201302-max/slh-tms-api`. All controller routes are beneath `/api/v1`.

## Authentication and authorisation

The API is single-tenant Microsoft Entra JWT bearer authentication. Set the correct API audience (`api://<API-CLIENT-ID>`) and issuer (`https://login.microsoftonline.com/<TENANT-ID>/v2.0`; the tenant v1 issuer is also accepted). All routes use the fallback authenticated policy except the two health endpoints.

Operational access requires the delegated `Tms.Access` scope in the `scp` claim. `TmsWrite` and `TmsApprove` currently enforce that same scope; app roles documented in the API README are not currently evaluated in controller policies.

## Endpoints

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | Anonymous | Lightweight liveness endpoint. |
| GET | `/health/ready` | Anonymous | Azure SQL readiness check. |
| GET | `/customers?q=` | Authenticated | Active customers, 100 maximum. |
| GET | `/vehicles?q=` | Authenticated | Active vehicles, 100 maximum. |
| GET | `/drivers?q=` | Authenticated | Active drivers, 100 maximum. |
| GET | `/trailers?q=` | Authenticated | Active trailers, 100 maximum. |
| GET | `/sites?q=` | Authenticated | Active collection/delivery sites, 100 maximum. |
| GET | `/market-contacts?q=` | Authenticated | Active market contacts, 100 maximum. |
| GET | `/staging?status=&entityType=&take=` | Authenticated | List staged imports; `take` is 1–500. |
| POST | `/staging` | `Tms.Access` | Create an idempotent staged import; returns 202 or existing result. |
| GET | `/staging/{id}` | Authenticated | Read a staged import. |
| POST | `/staging/{id}/approve` | `Tms.Access` | Approve and promote supported imports. |
| POST | `/staging/{id}/reject` | `Tms.Access` | Reject a staged import. |
| GET | `/tracking/dot/telemetry` | `Tms.Access` | Read RoadTech Falcon telemetry preview. |

The backend README’s health URL omits `/api/v1`; the program maps the actual routes above.

## Models and integrations

- **Customer**: ID, code, name, active.
- **Vehicle**: registration, fleet number, abbreviation, transmission, DVS compliance, fuel-provider metadata, active. Fuel PIN secret name is never rendered by this portal.
- **Driver**: employee number, display/tacho name, driver type/group, skills, active.
- **Trailer**: number, type, standard/Euro capacity, active.
- **Site**: external code, name, driver-facing name, collection address/instructions, map link, active.
- **Market contact**: market, name, stand/location, active.
- **Staging**: entity type, idempotency key, raw source payload, lifecycle status, source and audit/review metadata. Staging supports customer, driver, vehicle, trailer, site and market contact promotion. Order promotion is expressly deferred.
- **DOT / RoadTech**: configuration and credentials stay server-side. The client returns a provider envelope and raw provider-mapped telemetry records; no genuine deployed response was available to safely finalise a richer mapping.
- **Sage HR**: `SageHrClient` and configuration exist but there is no controller endpoint. It must be surfaced through a server-side, authenticated API endpoint before a browser can use availability data.

## Required next backend increment

Orders, loads, allocation, capacity conflict checks, planning stops, availability/leave, exceptions, reports, exports, and administration have no API contract in this backend version. Implement versioned authenticated endpoints and domain models before enabling those frontend modules. The frontend must not infer or fabricate operational records.
