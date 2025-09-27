/**
 * Helper function to generate a pseudo-UUID/GUID for entities.
 * Note: Should ideally be a HLC/Sync GUID for production. This is an MVP placeholder.
 */
export function generateGUID(): string {
  const S4 = () => (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
  return `${S4()}${S4()}-${S4()}-${S4()}-${S4()}-${S4()}${S4()}${S4()}`;
}