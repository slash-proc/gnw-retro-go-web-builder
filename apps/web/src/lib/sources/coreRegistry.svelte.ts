/**
 * The reactive view of the core registry: `coreRegistry.current` recomputes whenever a source
 * is added, removed, activated, deactivated or resolved.
 *
 * Split from `coreRegistry.ts` for the same reason `libraryScan.ts` is split from
 * `library.svelte.ts`: the rule belongs in a pure function a node suite can drive with plain
 * objects, and only the subscription needs runes.
 */
import { sources } from "./store.svelte.js";
import { buildCoreRegistry, registryIsAuthoritative, type CoreRegistry } from "./coreRegistry.js";

class CoreRegistryStore {
  readonly current: CoreRegistry = $derived(buildCoreRegistry(sources.rows));

  /** See `registryIsAuthoritative` — false only while no active core is registered. */
  get authoritative(): boolean {
    return registryIsAuthoritative(this.current);
  }
}

export const coreRegistry = new CoreRegistryStore();
