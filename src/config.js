// @ts-check
/**
 * Where the board keeps its data, and how it signs you in.
 *
 * ## NOTHING SECRET GOES IN THIS FILE
 *
 * A tenant id, a client id and a site path are not secrets — they identify, they do
 * not authorise. They appear in the browser's network tab either way, and Microsoft
 * documents them as public values for a single-page app.
 *
 * What must NEVER appear here, or anywhere else in this repo:
 *   - a client secret or certificate
 *   - an API key of any kind
 *   - a connection string
 *   - a token
 *
 * The sign-in flow is authorization code with PKCE, which is designed precisely so a
 * browser app needs no secret. If a future change seems to need one, the change is
 * wrong — it means work has drifted into the browser that belongs in a small
 * server-side function. See CLAUDE.md hard rule 3.
 *
 * ## Filling this in
 *
 * Three values, all from IT:
 *   tenantId  - the directory the sign-in happens against
 *   clientId  - the app registration for this page
 *   siteId    - which SharePoint site holds the lists
 *
 * Until they are filled in, the app runs on the in-memory demo board, so it stays
 * usable and the whole thing can be demonstrated before any of this exists.
 */

/**
 * @typedef {object} BoardConfig
 * @property {'local'|'demo'|'sharepoint'} mode
 * @property {string} tenantId
 * @property {string} clientId
 * @property {string} siteId
 * @property {string} [redirectUri]
 */

/** @type {BoardConfig} */
export const CONFIG = {
  /**
   * 'local'      - YOUR board, saved in this browser. The default, so the plain
   *                address is always the real one. Nothing is shared and nothing
   *                leaves the machine; download a copy to move it or back it up.
   * 'demo'       - in-memory, invented data, thrown away on reload. Also at
   *                `?board=demo`, which is the easier way to reach it.
   * 'sharepoint' - the real lists, shared, signed in. Needs the three ids below.
   */
  mode: 'local',

  /**
   * Your directory (tenant) id, from the app registration's Overview page.
   * Looks like '72f988bf-86f1-41af-91ab-2d7cd011db47'.
   */
  tenantId: '',

  /**
   * The Application (client) id of the app registration, same page.
   * Also a GUID.
   */
  clientId: '',

  /**
   * Which SharePoint site. Two forms work:
   *   'contoso.sharepoint.com:/sites/TechOpsBoard:'   - readable, resolved on use
   *   'contoso.sharepoint.com,<site-guid>,<web-guid>' - the exact id, slightly faster
   *
   * tools/find-site-id.md explains how to get either one.
   */
  siteId: '',

  /**
   * Where Microsoft sends you back to after signing in. Must match a Redirect URI
   * registered on the app registration exactly, including the trailing slash.
   * Defaults to wherever the page is being served from, which is right for both
   * localhost and the deployed site.
   */
  redirectUri: undefined
};

/** The Graph permissions the app asks for, and why each is needed. */
export const SCOPES = [
  // Read the signed-in user's own profile, to work out who they are on the roster.
  'User.Read',
  // Read and write list items on sites the signed-in user can already reach.
  // DELEGATED, so it grants no more than the person already has: it cannot read a
  // site they could not open in a browser themselves. Worth saying to IT in those
  // words, because the name sounds broader than it is.
  'Sites.ReadWrite.All'
];

/**
 * Is the configuration complete enough to talk to SharePoint?
 * @param {BoardConfig} [cfg]
 */
export function isConfigured(cfg) {
  const c = cfg || CONFIG;
  return c.mode === 'sharepoint' && !!c.tenantId && !!c.clientId && !!c.siteId;
}

/**
 * What is missing, in words, for the message shown on screen when the app is set to
 * 'sharepoint' but cannot start.
 * @param {BoardConfig} [cfg]
 * @returns {string[]}
 */
export function missingConfig(cfg) {
  const c = cfg || CONFIG;
  const missing = [];
  if (!c.tenantId) missing.push('tenantId (the directory id from the app registration)');
  if (!c.clientId) missing.push('clientId (the application id from the app registration)');
  if (!c.siteId) missing.push('siteId (which SharePoint site holds the lists)');
  return missing;
}
