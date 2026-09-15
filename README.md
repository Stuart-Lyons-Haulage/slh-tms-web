# SLH TMS Web

Production React and TypeScript operations portal for the [SLH TMS API](https://github.com/Stuart-Lyons-Haulage/slh-tms-api). The API and Azure SQL database remain the system of record for transactional operations; Microsoft Lists governs business master data and is synchronised into the API's operational projection. This repository owns the user-facing portal, planner, operations wallboard, TV wallboard, live runs, staging review, imports, reporting and operational screens.

The production portal runs in Azure Container Apps and publishes automatically when `main` changes.

## Production

| Item | Value |
| --- | --- |
| Portal | `https://slh-tms-portal-prod.gentlepond-08dba66b.uksouth.azurecontainerapps.io/` |
| API proxy | `/tms-api` |
| API backing service | `https://slh-tms-api-prod.gentlepond-08dba66b.uksouth.azurecontainerapps.io` |
| Runtime | Azure Container Apps with Nginx |
| Authentication | Microsoft Entra SPA sign-in |
| API scope | `api://497f6ea5-9753-43ee-8ccf-afaa0a3869c2/Tms.Access` |

Browser code never receives RoadTech, TachoMaster, Fleetio, Sage HR, SQL or SMS credentials. All provider calls go through the API.

## Main Screens

| Screen | Purpose |
| --- | --- |
| Dashboard | Operational summary and navigation into live workflows |
| Staging / Review orders | Review staged manual, spreadsheet and email-derived orders before promotion |
| Planner / Allocation | Build and adjust loads, stops, routes, allocations and capacity |
| Planner import | Import planner source-line JSON and reset/re-import a planning day safely |
| Runs / Loads | Manage saved runs, allocation, dispatch readiness and driver messages |
| Operations wallboard | Live operational control board for today's runs |
| TV wallboard / Live runs TV | Office display using the same live run-progress evidence as the main wallboard |
| Tracking | Live RoadTech/Falcon fleet view |
| Drivers & TachoMaster | Driver master data, TachoMaster linkage and availability imports |
| Daily compliance | Fleetio walkround, TachoMaster, DOT/Falcon and TMS reconciliation |
| Pallet control / Reporting / Management | Operational reporting and support workflows |

## Operational Workflow

1. Enter a single order, upload a spreadsheet, or ingest email-derived work into staging.
2. Review staged rows, required fields, dates, pallets, duplicates and evidence before promotion.
3. Approve reviewed work into operational orders.
4. Import or create planner runs, then allocate driver, vehicle and trailer.
5. Save stops with usable site/postcode coordinates so routing and geofence matching can work.
6. Dispatch only after the API has checked allocation, live sign-on/card evidence, legal-hours data where available, route feasibility and acknowledged warnings.
7. Operations control the day through the wallboard, live runs, tracking, run screens and exception panels.
8. Completed geofence departures flow back into progress/completion states.

`docs/POWER_AUTOMATE_EMAIL_INTAKE.md` defines the safe Power Automate email-to-staging handoff. Email automation must never bypass staging approval.

## Operations Wallboard

The operations wallboard and TV wallboard are evidence-driven. They do not show a run as live simply because it is planned.

The wallboard displays:

- allocated driver, vehicle and trailer;
- signed-on/card-confirmed status and time where known;
- whether legal-hours metrics are available;
- live tracking state from RoadTech/Falcon;
- current stop or next stop;
- actual geofence arrival/departure where known;
- completed stop count and progress percentage;
- predicted ETA to the next stop where live tracking supports it;
- completed/finished state after the final linked stop has departed; and
- clear exception text where live evidence is missing or mismatched.

The tacho/card labels are intentionally specific:

| Label | Meaning |
| --- | --- |
| `Tacho signed on` | TachoMaster duty/profile evidence matched the planned driver/vehicle |
| `Card confirmed` | Falcon live card/driver evidence matched, but this is not by itself a full legal-hours calculation |
| `Card confirmed, hours missing` | Driver/card presence is live, but TachoMaster did not provide usable drive/work metrics |
| `Not signed on` | No live TachoMaster duty or Falcon card/driver evidence matched the allocation |
| `Tacho mismatch` | Live identity exists but does not match the planned driver/vehicle |
| `TachoMaster unavailable` | Provider/config/runtime failure, not a driver status |

Planned start time is schedule context only. It must not be shown as live ETA. ETA text should come from live vehicle location, route calculation and next-stop evidence, or it should say that ETA is still calculating/missing.

## TV Wallboard

Supported TV paths:

- `/tv`
- `/operations-wallboard/tv`
- `/live-runs/tv`

The TV uses the same API-backed run progress as the main wallboard. It can be opened by an authenticated Lyons account or by the configured TV access key/pairing flow. TV keys are passed to the API proxy by Nginx and must remain server-side.

The TV wallboard refreshes automatically and is designed to survive staggered API/web deployments with fallback loading behaviour.

## Tracking and TachoMaster Display Rules

RoadTech/Falcon and TachoMaster are separate evidence types even when they use the same RoadTech API host:

- RoadTech/Falcon supplies live vehicle movement, position and sometimes live card/driver identity.
- TachoMaster supplies driver profile, card, duty history and legal-hours metrics.
- Falcon card confirmation can prove that a card/driver is present in a moving vehicle.
- TachoMaster legal-hours metrics are needed before the UI can claim enough drive time or break-aware ETA confidence.

The UI must not collapse these into a vague `Pending` state where stronger evidence exists. It should show exactly what is known and what is missing.

## Staging and Planner Import

Staging means review-before-live, not RoadTech API staging.

Planner source-line imports post to the resilient backend endpoint:

`POST /api/v1/planning/import-plan`

The Planner Import screen supports:

- source-line preview;
- held/excluded run visibility;
- capacity warnings;
- manual actual/ETA source lines;
- clean planning-day reset through the protected backend reset endpoint; and
- idempotent re-imports without deleting audit history.

## Local Development

1. Copy `.env.example` to `.env.local` if present, or create `.env.local`.
2. Enter the API, Entra and Azure Maps values.
3. Install dependencies with `pnpm install`.
4. Run the local portal with `pnpm run dev`.

The API requires a bearer token issued by the configured tenant for the `Tms.Access` delegated scope. Configure API CORS for the local and production portal origins; do not weaken API authentication.

## Build Configuration

All `VITE_` values are public build-time configuration. Never put client secrets, connection strings or RoadTech credentials in this repository.

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | API origin or proxy, without `/api/v1`. Production uses `/tms-api`. |
| `VITE_ENTRA_TENANT_ID` | Microsoft Entra tenant ID. |
| `VITE_ENTRA_CLIENT_ID` | Portal SPA application/client ID. |
| `VITE_ENTRA_API_SCOPE` | Normally `api://<API-CLIENT-ID>/Tms.Access`. |
| `VITE_AZURE_MAPS_CLIENT_ID` | Azure Maps account client ID / unique ID for map rendering. |
| `VITE_GRAPH_SITES_SCOPE` | Delegated Graph scope for mailbox intake SharePoint List work, normally `Sites.ReadWrite.All`. |
| `VITE_GRAPH_MAIL_SCOPE` | Delegated Graph scope for reading the shared mailbox source message, normally `Mail.Read.Shared`. |
| `VITE_MAILBOX_INTAKE_LIST_ID` | SharePoint List ID for the TMS mailbox queue. Defaults to the live SLH intake list where configured. |
| `VITE_MAILBOX_INTAKE_ADDRESS` | Shared mailbox to read source messages from. Defaults to `info@lyonshaulage.com` where configured. |

Production defaults are supplied by the GitHub Actions workflow where safe. Provider secrets remain in the API Container App and Key Vault.

## Azure Container Apps Deployment

The production workflow is `.github/workflows/slh-tms-portal-prod-AutoDeployTrigger-9ef45802-17f2-425d-9502-8db65f35c937.yml`.

Deployment flow:

1. Push to `main`.
2. GitHub Actions signs in to Azure with OIDC.
3. The workflow builds the Nginx portal image.
4. The image is pushed to Azure Container Registry.
5. The workflow waits for any existing Container App operation to settle.
6. The exact image for the Git SHA is deployed to `slh-tms-portal-prod`.
7. The workflow verifies the production portal root URL.
8. The workflow verifies the same-origin `/tms-api/api/v1/health` proxy returns healthy API output.

Azure Container Apps updates are asynchronous. A CLI timeout does not always mean the deployment failed. The workflow deliberately retries and confirms the image before marking the release finished.

## CI

Every branch and pull request runs:

- `pnpm install --frozen-lockfile`;
- `pnpm run lint`;
- `pnpm run test`; and
- `pnpm run build`.

The production build supplies test-safe `VITE_` values in CI. Production deployment supplies the real public build values through the deploy workflow.

## Manual Production Verification

After a wallboard or integration-facing release, verify:

1. Web GitHub checks are green.
2. API GitHub checks are green if the backend changed.
3. Production API `/api/v1/health` reports the intended API revision.
4. Production portal deploy workflow has verified `/` and `/tms-api/api/v1/health`.
5. Operations wallboard opens after sign-in.
6. TV wallboard opens by authenticated account or TV access flow.
7. Live runs show signed-on/card-confirmed/not-signed-on explicitly.
8. ETA fields do not use planned start as live ETA.
9. Completed geofence departures count as completed stops and final completion.
10. Exceptions are clear where evidence is missing.

## Security

- Do not commit credentials, customer files, provider payloads or operational exports.
- Do not put secrets into `VITE_` variables.
- Keep Entra authentication and API bearer-token validation intact.
- Keep RoadTech, TachoMaster, Fleetio, Sage HR, SQL and SMS credentials server-side.
- Do not bypass staging review with browser-side shortcuts.
- Do not hide missing live evidence behind planned times or generic healthy-looking states.

## Reference

- `docs/BACKEND_CONTRACT.md` - inspected versioned API routes and authentication.
- `docs/POWER_AUTOMATE_EMAIL_INTAKE.md` - Power Automate email order intake contract.
- `docs/DRIVER_SMS_DELIVERY.md` - secure Azure Communication Services driver-message setup.
- `docs/CUSTOMER_ETA_UPDATES.md` - customer ETA update behaviour.
- `docs/portal-deployment-resilience.md` - Container Apps release recovery rules.

## Master Data: read-only in TMS, governed in Microsoft Lists

The current portal must present Master Data as a read-only operational view.
Microsoft Lists is the business-maintained governance surface for customers,
contacts, sites/geofences, drivers, vehicles, trailers, fuel cards, markets and
email-route CRM mappings. The API maintains the synchronised SQL projection
needed for fast, resilient operational reads; it remains the transaction store
for orders, plans, runs, allocations, tracking, ETAs and audit history. This is
not a conflict: Lists governs master-data changes, SQL supports live operations.

Do not add client-side Graph writes, parallel editable master screens or browser
credentials. A master-data change belongs in the governed List and reconciliation
workflow; the UI should expose freshness, warning and reconciliation state.

The master view is expected to make the following operational fields visible
where authorised: customer/account/contact and ETA-recipient detail; site
address, aliases, instructions, map/geofence and region; drivers' employment,
grade/type/group/agency/skills/contact and unique tachograph card/TachoMaster
identity; vehicles/trailers, compliance and allocation detail; fuel-card
provider/allocation and PIN or secret-reference state; and market/sender/stall
CRM mappings. Actual fuel PINs and any provider credentials must never be
rendered, exported or stored in a `VITE_` variable.

### Master-data retention rules

The historical master-data work makes the intent unambiguous: a name-only List
is not an acceptable migration. Retain the complete record and its identity/audit
metadata for every driver, site, vehicle, trailer, fuel card, customer, contact
and market route.

- Drivers retain email, mobile, grade/coding, employment or agency status,
  skills, licence/compliance detail, TachoMaster ID, unique tachograph card and
  allocated vehicle. Never merge two people merely because their names match.
- A delivery/collection site is a distinct physical location. Keep individual
  Aldi, Amazon, Waitrose and Morrisons locations, their address, aliases,
  coordinates/geofence, map link, booking/timing/cut-off and driver instruction.
  An alias must not turn several sites into one generic customer row.
- Vehicles, trailers and fuel cards retain their identifiers, capacity,
  compliance/tracking state, allocation and notes. Full fuel PINs may be held
  in the access-controlled Fuel Cards/Vehicle Lists because operations requires
  them, but they must never be exposed by the portal, VITE configuration, logs,
  CI output or ordinary exports.
- Customer contacts and inbound sender routes are related but different:
  addresses learned from order intake are candidates; a planner-approved
  `ReceivesEtaUpdates` contact is an outbound communication recipient.

The UI should expose freshness, review and reconciliation state, but not become
an alternate master-data editor. If a required field is missing from a List
projection, surface it as a data-quality exception rather than hiding it behind
a title-only card or a made-up default.

The current API source polls the governed Lists every ten minutes. Earlier
operational discussion called for a once-hourly office-master refresh; confirm
the intended cadence with operations rather than assuming the historic choice
is still deployed. In either case, planning and dispatch continue against the
SQL projection and must not wait for SharePoint.

## Business rules that must survive UI work

- Order intake is approval-first: manual, spreadsheet and mailbox work goes to
  staging, then a planner reviews it before promotion. Keep the source-email
  preview/evidence links useful; do not turn a preview/replay action into a
  direct live-order write.
- The API handles email body, non-inline attachments and specialist workbooks;
  the Power Automate definition retains message and attachment identity. Exact
  sender routes beat domains, subject-specific routes beat generic routes, and
  conflicts require review. UI labels must not imply an automatic match is safe.
- Barfoots/Barefoots and Summer Berry are never allowed to fall into NWF,
  Drayton or a generic depot default. Surface ambiguous mapping as an exception,
  even if a similar customer/site is available. Preserve this negative rule in
  import, review, picker and bulk-edit features.
- Markets are governed data, including Covent Garden and New Spitalfields,
  sender and stall/contact context. Do not reduce a market route to a loose
  postcode/city lookup when a specific mapping is missing.
- AM/PM, Transfers, Markets, waves, overnight/night-out work and driver/vehicle/
  trailer swaps are planning facts that need explicit reviewed input. Capacity,
  including the operational 26-pallet expectation, must be checked against the
  API result and allocated equipment rather than recreated as a UI-only rule.
- Morrisons and Waitrose are standard-pallet rules; Aldi from Barfoots/NWF is
  euro; Langmeads-to-Aldi Atherstone is euro, otherwise Langmeads is standard.
  Keep warnings visible for unknown pallet type and capacity rather than hiding
  them to make a board look complete.
- A planned driver/vehicle does not make a run live. Live status comes from
  RoadTech/Falcon, TachoMaster and linked geofence evidence. Do not show planned
  start as a live ETA, and do not mark completion until the final linked stop
  has departed.

## Practical support runbook

| Situation | Portal/operator response |
| --- | --- |
| Master data looks stale | Check master-data/reconciliation health in the API-backed view; correct the governed List record and ask for controlled sync. Do not make a browser-side workaround. |
| Email/order missing or wrong | Open source evidence and staging history, retain the original message/attachment identity, then replay through the normal API intake path after fixing mapping/parser data. Planner review remains required. |
| Live run, TV board or ETA looks wrong | Compare the wallboard evidence labels, tracking freshness and stop/geofence linkage. Show the specific missing/mismatch state; do not substitute planned times. |
| Deployment looks incomplete | Use the production release marker, portal root and same-origin `/tms-api/api/v1/health` check; Container Apps can finish asynchronously. Use the existing workflow/revision process to roll back to a tested image. |

## Packs, exports and audit expectations

Customer load-plan/ETA output, customer-facing communication, driver messages
and operational exports are API-backed, reviewed operational artifacts—not
browser truth. Customer ETA export selection is planner-controlled in the
current `main` history. Preserve the selected customer, planning date, source
evidence and send/audit state when changing these screens. A driver pack or
customer/load export must display the same allocation, pallet, site and live
evidence context used by the run/dispatch screen; never reconstruct it from a
separate client-side master-data cache.

Use `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm test:e2e`
for a meaningful portal change. The CI workflow runs those commands on branches
and pull requests and blocks new global runtime patches/type suppressions. Add
a regression for changed planner, intake, master-data, dispatch, TV or
wallboard behaviour rather than relying on a visual smoke test alone.

## ChatGPT / new-engineer handover context

This portal is an operational control surface, not the place where business
master data or live-provider secrets are edited. Its contract is deliberately
evidence-first: staging before promotion; governed mappings before automation;
consistent API-backed live progress across planner, operations board, TV board
and exports; and conspicuous exceptions instead of optimistic defaults.

Repository evidence confirms the web/API contract and checked-in workflows, but
cannot prove the current Power Automate deployment, Microsoft Lists contents,
Sage HR filter, RoadTech/TachoMaster/Fleetio data, customer commercial rules,
current sender mappings or live secret configuration. Treat those as operations
verification items, especially for NWF, TSBC/COOP, Summer Berry, Barfoots,
NISA, Aldi, Morrisons, Waitrose, Amazon, Crosspoint/PCC, IFCO/JS and London
Markets. Before changing any rule, validate it against the governed Lists and a
real, reviewed production example.
