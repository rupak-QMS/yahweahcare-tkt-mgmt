// ============================================================
// Microsoft Authentication Library (MSAL) — confidential client
// for server-side OAuth 2.0 / OpenID Connect flow.
// ============================================================

import { ConfidentialClientApplication, LogLevel, type Configuration } from '@azure/msal-node';
import { env } from './env';

const msalConfig: Configuration = {
  auth: {
    clientId: env.AZURE_CLIENT_ID,
    clientSecret: env.AZURE_CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}`,
  },
  system: {
    loggerOptions: {
      loggerCallback(level, message, containsPii) {
        if (containsPii) return;
        const tag = '[msal]';
        if (level === LogLevel.Error)        console.error(tag, message);
        else if (level === LogLevel.Warning) console.warn(tag, message);
        else if (env.LOG_LEVEL === 'debug')  console.log(tag, message);
      },
      piiLoggingEnabled: false,
      logLevel: env.isProduction ? LogLevel.Warning : LogLevel.Info,
    },
  },
};

export const msalClient = new ConfidentialClientApplication(msalConfig);

/** Scopes requested for the access token. Must match consent in Azure. */
export const SCOPES = env.AZURE_SCOPE_LIST;

/**
 * Build the Microsoft sign-in URL.
 *
 * @param state CSRF state — must be verified on the callback.
 * @param codeChallenge PKCE code challenge derived from a per-request verifier.
 */
export async function getAuthCodeUrl(state: string, codeChallenge: string): Promise<string> {
  return msalClient.getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: env.AZURE_REDIRECT_URI,
    state,
    codeChallenge,
    codeChallengeMethod: 'S256',
    prompt: 'select_account',
  });
}

/**
 * Exchange the auth code returned by Microsoft for tokens.
 */
export async function acquireTokenByCode(code: string, codeVerifier: string) {
  return msalClient.acquireTokenByCode({
    code,
    scopes: SCOPES,
    redirectUri: env.AZURE_REDIRECT_URI,
    codeVerifier,
  });
}

/**
 * Build the Microsoft global sign-out URL.
 * After logout, Entra redirects to your registered post-logout URI.
 */
export function getMicrosoftLogoutUrl(): string {
  const url = new URL(`https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/logout`);
  url.searchParams.set('post_logout_redirect_uri', env.AZURE_POST_LOGOUT_REDIRECT_URI);
  return url.toString();
}
