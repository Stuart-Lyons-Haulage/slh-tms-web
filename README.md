# SLH TMS Web

Container Apps deployment is triggered automatically from the `main` branch.

Production-oriented React and TypeScript operations portal for the [SLH TMS API](https://github.com/danwilliams201302-max/slh-tms-api). The API remains the system of record; this project does not alter backend architecture.

See [`docs/BACKEND_CONTRACT.md`](docs/BACKEND_CONTRACT.md) for the inspected endpoint, model, authentication, and integration inventory.

## Current API integration

The current backend exposes authenticated master data, approval staging, and RoadTech Falcon telemetry. Those pages are live in this portal:

- **Operations dashboard**: staging review count.
- **Staging review**: list, approve, and reject staged imports.
- **Live tracking**: `/api/v1/tracking/dot/telemetry` provider view.
- **Master data & CRM**: customers, vehicles, drivers, and trailers.

Order intake, planning, loads, allocation, exceptions, reporting, exports, and admin are navigable operational workspaces. They deliberately show a readiness state until versioned API endpoints exist. This avoids inventing client-side records or bypassing the staging approval model.

## Local development

1. Copy `.env.example` to `.env.local` and enter your App Service URL plus Entra registration values.
2. Create a single-tenant Entra **SPA** app registration, add `http://localhost:5173` as a redirect URI, and grant delegated access to `api://<API-CLIENT-ID>/Tms.Access`.
3. Install dependencies with `npm install`, then run `npm run dev`.

The API requires bearer tokens issued by the configured tenant, for the `Tms.Access` delegated scope. The frontend uses MSAL with session storage and obtains this scope before every API call. The API must allow the frontend origin through CORS before browsers can call it; configure CORS in the existing API deployment rather than weakening authentication.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | API origin, without `/api/v1` suffix. |
| `VITE_ENTRA_TENANT_ID` | Microsoft Entra tenant ID. |
| `VITE_ENTRA_CLIENT_ID` | Frontend SPA app registration client ID. |
| `VITE_ENTRA_API_SCOPE` | Usually `api://<API-CLIENT-ID>/Tms.Access`. |

`VITE_` variables are public build-time configuration. Never put a client secret, database credential, or tracking provider credential in this project.

## Azure deployment

1. Create an Azure Static Web Apps resource (or an Azure Storage static website/CDN) and configure its production environment with the four `VITE_` values.
2. In Entra, add the production Static Web Apps URL as a SPA redirect URI.
3. Configure the API’s CORS allow-list with the local and production frontend origins, retaining JWT audience, issuer, and `Tms.Access` checks.
4. Build with `npm run build`; publish `dist/`. The included GitHub Actions workflow can deploy once its Azure Static Web Apps token is added as `AZURE_STATIC_WEB_APPS_API_TOKEN`.
5. Verify sign-in, `/api/v1/staging`, master-data lists, and telemetry using a user assigned the API’s delegated permission.

## Backend contract observed

`GET /api/v1/health` is anonymous. All operational routes require a valid Entra JWT for the API audience and `Tms.Access` delegated scope. Staging approval and telemetry additionally use the existing write/approve policies, currently backed by that same scope.
