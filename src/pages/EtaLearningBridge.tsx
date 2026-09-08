/**
 * ETA learning is applied by the canonical server-side wallboard/ETA projection.
 * Keeping the correction in the API ensures the signed-in Operations wallboard and
 * the physical TV consume the same learned HGV timing instead of applying a second
 * browser-only adjustment.
 */
export function EtaLearningBridge() {
  return null;
}
