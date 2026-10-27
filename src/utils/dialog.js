// src/utils/dialog.js
//
// FaithScore's own popups. Replaces the browser's alert() / confirm() /
// prompt() everywhere in the app. It is a tiny service, not a component, so it
// can be called from React handlers AND from plain utility code (the print and
// export functions) — the <DialogHost/> mounted once at the app root draws it.
//
//   await dialog.alert("Could not open this file.", { title: "Open failed", tone: "danger" })
//   if (await dialog.confirm("Delete this score?", { tone: "danger", confirmLabel: "Delete" })) …
//   const name = await dialog.prompt("Save as:", { defaultValue: "My score" })   // string | null
//   const pick = await dialog.choose({ title, message, actions: [...] })          // action id | null
//   dialog.toast("Saved ✓", { tone: "success" })                                  // non-blocking
//
// Every call returns a Promise, so callers simply `await` it (the native
// versions blocked the whole page; these do not).
//
// Tones: 'info' (default) | 'success' | 'warn' | 'danger'

let host = null; // { openModal(item), toast(item) } supplied by <DialogHost/>
const pending = []; // calls made before the host mounted

export function registerDialogHost(h) {
  host = h;
  if (h) while (pending.length) pending.shift()(h);
}

function whenHost(fn, fallback) {
  if (host) return fn(host);
  pending.push(fn);
  // Safety net: if the host never mounts, fall back to the browser's own
  // dialog rather than leaving the caller's promise hanging forever.
  setTimeout(() => {
    const i = pending.indexOf(fn);
    if (i >= 0) {
      pending.splice(i, 1);
      fallback();
    }
  }, 1500);
}

const open = (spec, nativeFallback) =>
  new Promise((resolve) => {
    whenHost(
      (h) => h.openModal({ ...spec, resolve }),
      () => resolve(nativeFallback()),
    );
  });

export const dialog = {
  /** Informational / error message with one OK button. Resolves when closed. */
  alert(message, opts = {}) {
    return open(
      { kind: "alert", message, ...opts },
      () => {
        window.alert(message);
      },
    );
  },

  /** OK / Cancel question. Resolves true or false. */
  confirm(message, opts = {}) {
    return open(
      { kind: "confirm", message, ...opts },
      () => window.confirm(message),
    );
  },

  /**
   * Text question. Resolves the entered string, or null if cancelled.
   * opts: { title, defaultValue, placeholder, confirmLabel, inputType,
   *         validate(value) -> error string | falsy }
   */
  prompt(message, opts = {}) {
    return open(
      { kind: "prompt", message, ...opts },
      () => window.prompt(message, opts.defaultValue ?? ""),
    );
  },

  /**
   * Several buttons. actions: [{ id, label, variant: 'primary'|'danger'|'secondary' }]
   * The action with `primary: true` (or the first) is the Enter key's default.
   * Resolves the chosen action's id, or null if dismissed (Esc / backdrop).
   */
  choose(spec) {
    return open({ kind: "choose", ...spec }, () => null);
  },

  /** Brief non-blocking notice (e.g. "Saved ✓"). Fire and forget. */
  toast(message, opts = {}) {
    whenHost(
      (h) => h.toast({ message, ...opts }),
      () => {},
    );
  },
};

export default dialog;