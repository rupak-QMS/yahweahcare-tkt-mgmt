// ============================================================
// Microsoft Graph integration — fetch user profile after login
// ============================================================

import 'isomorphic-fetch';
import { Client } from '@microsoft/microsoft-graph-client';

export interface GraphUser {
  id: string;                  // Microsoft Object ID (oid)
  displayName: string;
  givenName?: string;
  surname?: string;
  mail?: string;
  userPrincipalName: string;
  jobTitle?: string;
  department?: string;
  officeLocation?: string;
  employeeId?: string;
  mobilePhone?: string;
}

/**
 * Fetch the signed-in user's profile from Microsoft Graph.
 */
export async function fetchGraphProfile(accessToken: string): Promise<GraphUser> {
  const client = Client.init({
    authProvider: (done) => done(null, accessToken),
  });
  const me = await client
    .api('/me')
    .select('id,displayName,givenName,surname,mail,userPrincipalName,jobTitle,department,officeLocation,employeeId,mobilePhone')
    .get();
  return me as GraphUser;
}

/**
 * Fetch the user's profile photo as a base64 data URL.
 * Graph returns 404 if the user has no photo — we swallow that.
 */
export async function fetchGraphPhoto(accessToken: string): Promise<string | null> {
  try {
    const client = Client.init({ authProvider: (done) => done(null, accessToken) });
    const blob: ArrayBuffer = await client.api('/me/photo/$value').get();
    const base64 = Buffer.from(blob).toString('base64');
    return `data:image/jpeg;base64,${base64}`;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404) return null;
    return null;
  }
}
