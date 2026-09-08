/**
 * ETA learning is now applied by the canonical server-side wallboard/ETA projection.
 *
 * This component intentionally does not intercept browser fetch calls. Keeping ETA
 * correction in the API means the signed-in Operations wallboard and the TV consume
 * the same learned HGV timing rather than applying a second client-only adjustment.
 */
export function EtaLearningBridge() {
  return null;
}
