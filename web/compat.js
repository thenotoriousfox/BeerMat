// What older phones lack, filled in before the pages use it, so a team's phone from about 2020 on still plays (iOS 14,
// Chrome 86): newer browsers keep their own. The pages import this first.
if (!AbortSignal.timeout) AbortSignal.timeout = ms => {const c = new AbortController(); setTimeout(() => c.abort(new DOMException('The request timed out', 'TimeoutError')), ms); return c.signal;};
if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', {configurable: true, writable: true, value(i) {i = Math.trunc(i) || 0; return this[i < 0 ? this.length + i : i];}});
// Drafts are plain answers (text, numbers, lists): a JSON copy does.
if (typeof structuredClone !== 'function') globalThis.structuredClone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
// <dialog> (the team menu) before iOS 15.4: shown and closed by its open attribute (style.css hides it closed).
if (typeof HTMLDialogElement !== 'function' || !HTMLDialogElement.prototype.showModal) {
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.showModal = dialog.show = () => dialog.setAttribute('open', '');
    dialog.close = () => {if (!dialog.hasAttribute('open')) return; dialog.removeAttribute('open'); dialog.dispatchEvent(new Event('close'));};
    for (const form of dialog.querySelectorAll('form[method=dialog]')) form.addEventListener('submit', e => {e.preventDefault(); dialog.close();});
  }
}
