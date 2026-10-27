// src/utils/saveRegistry.js
// Lets the app shell trigger a save that lives inside an editor component —
// used by the "Unsaved changes → Save and continue" dialog. An editor registers
// its save function while mounted; it resolves true when the score was saved.
export const saveRegistry = {
  solfa: null, // () => Promise<boolean>
}