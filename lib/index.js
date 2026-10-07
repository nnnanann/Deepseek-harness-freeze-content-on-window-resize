/**
 * freeze-content-on-window-resize — host half.
 *
 * This package exists for its browser half. `dsh.client` in package.json turns
 * `client/client.js` into a bundle the DSH Web shell serves under `/plugins`, and
 * this module is the Loader row that makes the package part of a profile; the
 * browser half is the code that freezes the reading column.
 *
 * It provides no host-side behavior on purpose: no tools, no services, no
 * configuration, nothing model-facing.
 */
function apply() {}

export { apply };
