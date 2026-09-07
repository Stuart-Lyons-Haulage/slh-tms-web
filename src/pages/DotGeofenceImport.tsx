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

export function filterImportSites(sites: SiteOption[], query: string): SiteOption[] {
  void sites; void query;
  return [];
}

export function importRowsReady(rows: DotImportRow[], decisions: Record<string, DotImportDecision>): boolean {
  void rows; void decisions;
  return false;
}
