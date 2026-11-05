async function storageStatus(request: boolean) {
  let persisted: boolean | null = null;
  let usage: number | null = null;
  let quota: number | null = null;
  try {
    persisted = (await (request ? navigator.storage?.persist?.() : navigator.storage?.persisted?.())) ?? null;
  } catch {
    /* Browser denied the request. */
  }
  try {
    const estimate = await navigator.storage?.estimate?.();
    usage = estimate?.usage ?? null;
    quota = estimate?.quota ?? null;
  } catch {
    /* Storage estimates are optional. */
  }
  return { persisted, usage, quota };
}
export function requestPersistentStorage() {
  return storageStatus(true);
}
export function getStorageStatus() {
  return storageStatus(false);
}
