/**
 * Host face: no server behavior. The plugin's substance ships via
 * exports["./client"], discovered through the package.json `dsh.client`
 * declaration by the client-modules scan; the Loader row for this package
 * imports this root, whose no-op apply satisfies the host-side activation.
 */

export function apply(): void {}
