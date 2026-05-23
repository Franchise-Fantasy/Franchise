/**
 * Tracks an in-flight notification / deep-link navigation so the index
 * screen's auth redirect (`router.replace('/(tabs)')`) doesn't clobber it on
 * cold start. Both effects fire in the same tick when AppState finishes
 * loading, and the index effect reads `pathname` before the deep-link nav has
 * committed — so a runtime flag is the only reliable signal that a tap owns
 * the launch navigation. The notification handler sets this true the moment it
 * sees a target screen and releases it once it has navigated.
 */
let pending = false;

export function setPendingDeepLink(value: boolean) {
  pending = value;
}

export function hasPendingDeepLink() {
  return pending;
}
