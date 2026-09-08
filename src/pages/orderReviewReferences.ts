type ReferencePayload = Record<string, unknown> & {
  customerPo?: string;
  poRef?: string;
  customerRef?: string;
  productPo?: string;
  cratePo?: string;
  transportPo?: string;
  collectionReference?: string;
  loadReference?: string;
  loadRef?: string;
};

const text = (value: unknown) => String(value ?? "").trim();

export function driverReference(payload: ReferencePayload) {
  return text(payload.customerPo)
    || text(payload.poRef)
    || text(payload.customerRef)
    || text(payload.productPo)
    || text(payload.cratePo)
    || text(payload.transportPo)
    || text(payload.collectionReference)
    || text(payload.loadReference)
    || text(payload.loadRef);
}
