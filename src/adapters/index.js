/**
 * Adapter registry. Adding a platform means dropping a file in this directory
 * and naming it in config/programs.json — nothing else changes.
 */
import * as affiliatewp from './affiliatewp.js';
import * as generic from './generic.js';
import * as manual from './manual.js';

const ADAPTERS = {
  affiliatewp,
  generic,
  manual,
};

export function getAdapter(name) {
  const adapter = ADAPTERS[name];
  if (!adapter) {
    // An unknown adapter name is a config typo, not a reason to lose the run.
    return {
      ...manual,
      name: 'manual',
      resolvedFrom: name,
      fetchStats: async () => {
        const error = new Error(`unknown adapter "${name}" in config/programs.json — falling back to manual entry`);
        error.kind = 'config';
        throw error;
      },
    };
  }
  return adapter;
}

export function adapterNames() {
  return Object.keys(ADAPTERS);
}

export function isManualOnly(name) {
  return getAdapter(name).manualOnly === true;
}
