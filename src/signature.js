import crypto from 'crypto';
import fetch from 'node-fetch';

import { account, domain } from './util.js';
import { getPrivateKey } from './activity-pub-db.js';

/**
 * Returns base-64 encoded SHA-256 digest of provided data
 *
 * @param {string} data - UTF-8 string to be hashed
 *
 * @returns {string}
 */
function getDigest(data) {
  return crypto.createHash('sha256').update(data).digest('base64');
}

/**
 * Returns base-64 encoded string signed with user's RSA private key
 *
 * @param {string} privkey - Postmarks user's private key
 * @param {string} data - UTF-8 string to sign
 *
 * @returns {string}
 */
function getSignature(privkey, data) {
  const signer = crypto.createSign('sha256');
  signer.update(data);
  signer.end();
  return signer.sign(privkey).toString('base64');
}

/**
 * Returns object of params to be used for HTTP signature
 *
 * @param {BodyInit | null} [body] - Request body for signature digest (usually a JSON string, optional)
 * @param {string} method - Request HTTP method name
 * @param {string} url -
 *
 * @returns {Object}
 */
function getSignatureParams(body, method, url) {
  const urlObj = new URL(url);
  const path = `${urlObj.pathname}${urlObj.search}`;
  const requestTarget = `${method.toLowerCase()} ${path}`;
  const hostParam = urlObj.hostname;

  const date = new Date();
  const dateParam = date.toUTCString();

  const params = {
    '(request-target)': requestTarget,
    host: hostParam,
    date: dateParam,
  };

  // add digest param if request body is present
  if (body) {
    const digest = getDigest(body);
    const digestParam = `SHA-256=${digest}`;
    params['digest'] = digestParam;
  }

  return params;
}

/**
 * Returns the full "Signature" header to be included in the signed request
 *
 * @param {string} signature - Base-64 encoded request signature
 * @param {string[]} signatureKeys - Array of param names used when generating the signature
 *
 * @returns {string}
 */
function getSignatureHeader(signature, signatureKeys) {
  return [
    `keyId="https://${domain}/u/${account}"`,
    `algorithm="rsa-sha256"`,
    `headers="${signatureKeys.join(' ')}"`,
    `signature="${signature}"`,
  ].join(',');
}

/**
 * Signs a fetch request with the account's RSA private key
 *
 * @param {URL | RequestInfo} url - URL (passed to fetch)
 * @param {RequestInit} [init={}] - Optional fetch init object
 *
 * @returns {Promise<Response>}
 */
export async function signedFetch(url, init = {}) {
  const privkey = await getPrivateKey(`${account}@${domain}`);
  if (!privkey) {
    throw new Error(`No private key found for ${account}.`);
  }

  const { headers = {}, body = null, ...rest } = init;
  const { method = body ? 'POST' : 'GET' } = init; // guess method if not provided
  const isJSON = body && typeof body === 'string'; // assume string body is JSON

  const signatureParams = getSignatureParams(body, method, url);
  const signatureKeys = Object.keys(signatureParams);
  const stringToSign = Object.entries(signatureParams)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const signature = getSignature(privkey, stringToSign);
  const signatureHeader = getSignatureHeader(signature, signatureKeys);

  const contentTypeHeader = isJSON ? { 'Content-Type': 'application/json' } : {};

  return fetch(url, {
    body,
    method,
    headers: {
      Accept: 'application/json',
      ...contentTypeHeader,
      ...headers,
      Host: signatureParams.host,
      Date: signatureParams.date,
      Digest: signatureParams.digest,
      Signature: signatureHeader,
    },
    ...rest,
  });
}
