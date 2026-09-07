/* eslint-disable react-refresh/only-export-components */

export type DotImportRow = {
  clientKey: string;
  name: string;
  status: "Matched" | "NeedsLinking" | "AlreadyImported" | "PossibleRename" | "Invalid";
  suggestedSiteId?: string | null;
  possibleRenameGeofenceId?: string | null;
};

export type DotImportDecision = {
  siteId?: string;
  skip?: boolean;
  confirmRenameGeofenceId?: string;
};

export type SiteOption = { id: string; externalCode: string; name: string; active: boolean };

export function filterImportSites(_sites: SiteOption[], _query: string): SiteOption[] {
  return [];
}

export function importRowsReady(_rows: DotImportRow[], _decisions: Record<string, DotImportDecision>): boolean {
  return false;
}
