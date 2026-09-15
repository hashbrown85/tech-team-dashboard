// @ts-check
/**
 * Signing in with a company account, and handing tokens to the Graph adapter.
 *
 * Uses MSAL Browser with the authorization-code-plus-PKCE flow — the one designed so
 * a browser app needs no secret. MSAL is loaded from a CDN by index.html rather than
 * bundled, which keeps the no-build-step promise; if that ever becomes a problem, the
 * file can be vendored into assets/ and nothing here changes.
 *
 * Two things this file is careful about:
 *
 *  - **It never stores a token itself.** MSAL caches and refreshes; asking it each
 *    time is cheap and means there is nothing here to go stale or leak.
 *  - **It fails with an explanation.** The most likely failures are organisational,
 *    not technical — consent not granted, Conditional Access blocking the browser —
 *    and "sign-in failed" would send you hunting in the wrong place.
 */

import { CONFIG, SCOPES } from '../config.js';

/**
 * @typedef {object} Session
 * @property {() => Promise<string>} getToken - a Graph bearer token
 * @property {{name: string, username: string} | null} account
 * @property {() => void} signOut
 */

/**
 * Sign in and return a session, or throw with something readable.
 *
 * @param {object} [options]
 * @param {any} [options.msal] - the MSAL namespace; defaults to window.msal
 * @param {import('../config.js').BoardConfig} [options.config]
 * @returns {Promise<Session>}
 */
export async function signIn(options) {
  const opts = options || {};
  const cfg = opts.config || CONFIG;
  const msal = opts.msal || (typeof window !== 'undefined' ? /** @type {any} */ (window).msal : null);

  if (!msal || !msal.PublicClientApplication) {
    throw new Error(
      'The sign-in library did not load. It comes from a CDN, so check whether the ' +
      'corporate network blocks cdnjs.cloudflare.com — if it does, the file needs ' +
      'to be served from this site instead.'
    );
  }

  const app = new msal.PublicClientApplication({
    auth: {
      clientId: cfg.clientId,
      authority: 'https://login.microsoftonline.com/' + cfg.tenantId,
      redirectUri: cfg.redirectUri ||
        (typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '')
    },
    cache: {
      // Session, not local: closing the browser signs you out, which is the safer
      // default for a page that may be open on a shared meeting-room display.
      cacheLocation: 'sessionStorage',
      storeAuthStateInCookie: false
    }
  });

  await app.initialize();

  // Completes a redirect sign-in if we have just come back from one.
  const redirectResult = await app.handleRedirectPromise();

  let account = redirectResult
    ? redirectResult.account
    : app.getAllAccounts()[0] || null;

  if (!account) {
    // A redirect rather than a popup: popups are blocked often enough, and inside a
    // Teams tab they behave differently. A redirect works everywhere.
    await app.loginRedirect({ scopes: SCOPES });
    // The page navigates away here; this promise never settles.
    return await new Promise(function () {});
  }

  app.setActiveAccount(account);

  return {
    account: { name: account.name || account.username, username: account.username },

    getToken: async function () {
      try {
        const res = await app.acquireTokenSilent({ scopes: SCOPES, account: account });
        return res.accessToken;
      } catch (err) {
        // Silent renewal failed — consent revoked, password changed, or a policy
        // now wants interaction. A redirect is the only way through.
        await app.acquireTokenRedirect({ scopes: SCOPES, account: account });
        return await new Promise(function () {});
      }
    },

    signOut: function () {
      app.logoutRedirect({ account: account });
    }
  };
}

/**
 * Turn an MSAL or Graph failure into something worth reading.
 *
 * The common failures here are all organisational, and each sends you somewhere
 * different, so naming them is worth the few lines.
 *
 * @param {any} err
 * @returns {string}
 */
export function explainAuthFailure(err) {
  const text = String((err && (err.errorCode || err.message)) || err || '');

  if (/consent_required|interaction_required|AADSTS65001/i.test(text)) {
    return 'This app has not been granted permission yet. An administrator needs to ' +
      'consent to it once, on the app registration’s API permissions page.';
  }
  if (/AADSTS50011|redirect_uri/i.test(text)) {
    return 'The address this page is served from is not registered as a redirect URI ' +
      'on the app registration. It has to match exactly, including the trailing slash.';
  }
  if (/AADSTS53003|Conditional Access|blocked by Conditional Access/i.test(text)) {
    return 'A Conditional Access policy blocked the sign-in. This is the one worth ' +
      'testing on a colleague’s device early — it often allows managed laptops ' +
      'and refuses everything else.';
  }
  if (/AADSTS700016|unauthorized_client/i.test(text)) {
    return 'The client id in src/config.js is not an app registration in this ' +
      'directory. Check both the client id and the tenant id.';
  }
  if (/403|Forbidden|accessDenied/i.test(text)) {
    return 'Signed in successfully, but this account cannot reach the board’s ' +
      'SharePoint site. Check the site permissions rather than the app registration.';
  }
  if (/404|itemNotFound|listNotFound/i.test(text)) {
    return 'The site was reached but the board’s lists are not there. Run ' +
      'tools/provision.mjs to create them.';
  }
  return 'Could not sign in: ' + text;
}
