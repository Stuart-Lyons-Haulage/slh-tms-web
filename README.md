# SLH TMS Web

Production React and TypeScript operations portal for the [SLH TMS API](https://github.com/Stuart-Lyons-Haulage/slh-tms-api). The API and Azure SQL database remain the system of record; this repository only contains the user-facing portal.

The production portal runs in Azure Container Apps and publishes automatically when `main` changes.

## Operational workflow

1. Enter a single order or upload the supplied Excel/CSV template.
2. The portal checks required fields, dates, pallets, duplicates and map links before submitting rows to Staging.
3. A planner reviews the original staged payload, then approves it into an operational order.
4. The Planner groups approved orders into saved loads, allocates driver/vehicle/trailer, locates stops and draws Azure Maps routes.
5. The dispatcher copies a driver brief containing seller, market, stall, map link and driver notes. Connect an approved SMS provider before sending messages directly from the portal.
6. Operations use live and historic RoadTech tracking, exceptions, reporting and CSV exports to control the day.

The Drivers register supports a global search plus independent filters on every data column. Column filters combine, so operations can narrow the register by Tacho identity, compliance, eligibility, licence, activity or contact fields without exporting it first.

`docs/POWER_AUTOMATE_EMAIL_INTAKE.md` defines the safe Power Automate email-to-staging handoff. Email automation must never bypass Staging approval.

## Local development

1. Copy `.env.example` to `.env.local` and enter the API and Entra values.
2. In Entra, configure a single-tenant SPA registration with `http://localhost:5173` as a redirect URI and delegated access to `api://<API-CLIENT-ID>/Tms.Access`.
3. Install dependencies with `npm install`, then run `npm run dev`.

Before opening a pull request, run:

```bash
pnpm test
pnpm lint
pnpm build
```

The API requires a bearer token issued by the configured tenant for the `Tms.Access` delegated scope. Configure API CORS for the local and production portal origins; do not weaken API authentication.

## Build configuration

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | API origin, without `/api/v1`. |
| `VITE_ENTRA_TENANT_ID` | Microsoft Entra tenant ID. |
| `VITE_ENTRA_CLIENT_ID` | Portal SPA application (client) ID. |
| `VITE_ENTRA_API_SCOPE` | Normally `api://<API-CLIENT-ID>/Tms.Access`. |
| `VITE_AZURE_MAPS_CLIENT_ID` | Azure Maps account client ID / unique ID for map rendering. |
| `VITE_GRAPH_SITES_SCOPE` | Delegated Graph scope for the mailbox intake SharePoint List, normally `Sites.ReadWrite.All`. |
| `VITE_GRAPH_MAIL_SCOPE` | Delegated Graph scope for reading the shared mailbox source message, normally `Mail.Read.Shared`. |
| `VITE_MAILBOX_INTAKE_LIST_ID` | SharePoint List ID for the TMS mailbox queue. Defaults to the live SLH intake list. |
| `VITE_MAILBOX_INTAKE_ADDRESS` | Shared mailbox to read source messages from. Defaults to `info@lyonshaulage.com`. |

All `VITE_` values are public build-time configuration. Never put client secrets, connection strings or RoadTech credentials in this repository.

## Azure Container Apps deployment

1. In GitHub repository variables, configure the five `VITE_` settings above.
2. Keep the GitHub Actions Azure OIDC credentials and the Container App contributor role in place.
3. In Entra, add the portal's Container Apps URL as an SPA redirect URI.
4. In the API, allow that same origin through CORS while retaining issuer, audience and `Tms.Access` validation.
5. Push to `main`. The workflow builds an Nginx portal image, pushes it to Azure Container Registry and updates the `slh-tms-portal-prod` revision.
6. After the revision is healthy, sign in and verify Staging, Planner, route calculation, Excel intake and tracking against authorised production data.

## Reference

- `docs/BACKEND_CONTRACT.md` — current inspected versioned API routes and authentication.
- `docs/POWER_AUTOMATE_EMAIL_INTAKE.md` — Power Automate email order intake contract.
- `docs/DRIVER_SMS_DELIVERY.md` — secure Azure Communication Services driver-message setup.
