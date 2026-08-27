# SLH TMS Desktop Runtime

The desktop build wraps the existing React TMS in Electron. Dashboard, Control Centre, Planner, Runs, Orders, Import Planner, Live Runs, wallboards, Pallet Control, master data, tracking, ETA evidence, reporting, audit and admin screens continue to use the existing frontend and secured API contracts.

## Build and Run

```bash
pnpm install
pnpm build
pnpm desktop
```

For local development with hot reload:

```bash
pnpm desktop:dev
```

For a Windows installer:

```bash
pnpm desktop:win
```

The Windows output is written to `release/`.

## Runtime Configuration

The desktop shell reads `tms-runtime-config.js`. In development the template is:

```text
desktop/runtime-config/tms-runtime-config.js
```

In an installed desktop build, the first run copies the packaged template to the user's app data folder. Change that file when moving between a development PC, the SLH server, or a different API endpoint. Do not rebuild the desktop app just to change environment values.

Configurable values:

| Value | Purpose |
| --- | --- |
| `environmentName` | Development, Test or Production label |
| `apiBaseUrl` | API origin without a trailing slash |
| `entraTenantId` | Microsoft Entra tenant ID |
| `entraClientId` | Desktop/web public client ID |
| `entraApiScope` | Delegated API scope, normally `api://<API-CLIENT-ID>/Tms.Access` |
| `azureMapsClientId` | Azure Maps client/account ID |
| `featureFlags` | Runtime flags for staged desktop features |

The desktop shell must not contain SQL connection strings, RoadTech credentials, Sage HR keys, mailbox credentials or Microsoft Graph secrets. Those belong to the API/services configuration.
