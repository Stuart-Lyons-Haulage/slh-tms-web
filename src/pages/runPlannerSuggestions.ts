export type RunSuggestionLine = {
  orderId?: string;
  collectionSite: string;
  deliverySite: string;
};

export type RunSuggestionOrder = {
  id: string;
  reference: string;
  collection: string;
  destination: string;
  outstandingPallets: number;
};

export type RunSuggestionSite = {
  name: string;
  externalCode: string;
  driverTextName?: string;
  aliases?: string;
  operationalRegion?: string;
  active?: boolean;
};

export type RunJobSuggestion<TOrder extends RunSuggestionOrder = RunSuggestionOrder> = {
  order: TOrder;
  score: number;
  reasons: string[];
};

const normalise = (value: unknown) => String(value ?? "").trim().replace(/[^a-z0-9]/gi, "").toUpperCase();

function siteFor(sites: RunSuggestionSite[], value: string) {
  const target = normalise(value);
  if (!target) return undefined;
  return sites.find((site) => [
    site.name,
    site.driverTextName,
    site.externalCode,
    ...(site.aliases || "").split(/[,;|]/),
  ].some((candidate) => normalise(candidate) === target));
}

function regionFor(sites: RunSuggestionSite[], value: string) {
  return normalise(siteFor(sites, value)?.operationalRegion);
}

export function suggestJobsForRun<TOrder extends RunSuggestionOrder>(
  lines: RunSuggestionLine[],
  candidates: TOrder[],
  sites: RunSuggestionSite[],
  remainingCapacity: number,
  limit = 6,
): RunJobSuggestion<TOrder>[] {
  const usedLines = lines.filter((line) => line.orderId || line.collectionSite.trim() || line.deliverySite.trim());
  if (!usedLines.length) return [];

  const currentOrderIds = new Set(usedLines.flatMap((line) => line.orderId ? [line.orderId] : []));
  const collections = new Set(usedLines.map((line) => normalise(line.collectionSite)).filter(Boolean));
  const deliveries = new Set(usedLines.map((line) => normalise(line.deliverySite)).filter(Boolean));
  const collectionRegions = new Set(usedLines.map((line) => regionFor(sites, line.collectionSite)).filter(Boolean));
  const deliveryRegions = new Set(usedLines.map((line) => regionFor(sites, line.deliverySite)).filter(Boolean));
  const directions = new Set(usedLines.map((line) => {
    const from = regionFor(sites, line.collectionSite);
    const to = regionFor(sites, line.deliverySite);
    return from && to ? `${from}->${to}` : "";
  }).filter(Boolean));

  return candidates
    .filter((order) => order.outstandingPallets > 0 && !currentOrderIds.has(order.id))
    .map((order) => {
      let score = 0;
      const reasons: string[] = [];
      const collection = normalise(order.collection);
      const destination = normalise(order.destination);
      const collectionRegion = regionFor(sites, order.collection);
      const destinationRegion = regionFor(sites, order.destination);
      const direction = collectionRegion && destinationRegion ? `${collectionRegion}->${destinationRegion}` : "";

      if (collections.has(collection)) {
        score += 8;
        reasons.push("Same collection");
      }
      if (deliveries.has(destination)) {
        score += 8;
        reasons.push("Same delivery");
      }
      if (deliveries.has(collection)) {
        score += 7;
        reasons.push("Collects from an existing delivery");
      }
      if (collections.has(destination)) {
        score += 4;
        reasons.push("Returns towards an existing collection");
      }
      if (direction && directions.has(direction)) {
        score += 4;
        reasons.push("Same directional flow");
      } else {
        if (collectionRegion && collectionRegions.has(collectionRegion)) {
          score += 2;
          reasons.push("Same collection region");
        }
        if (destinationRegion && deliveryRegions.has(destinationRegion)) {
          score += 3;
          reasons.push("Same delivery region");
        }
      }

      if (score > 0 && remainingCapacity > 0 && order.outstandingPallets <= remainingCapacity) {
        score += 2;
        reasons.push("Fits remaining capacity");
      }

      return { order, score, reasons };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score
      || left.order.outstandingPallets - right.order.outstandingPallets
      || left.order.reference.localeCompare(right.order.reference))
    .slice(0, limit);
}
