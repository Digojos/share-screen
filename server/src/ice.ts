import { createHmac } from 'node:crypto';
import type { IceConfigResponse } from './types.js';

/**
 * Credenciais TURN efemeras no formato REST do coturn (`use-auth-secret`):
 *   username   = <unix-timestamp-de-expiracao>:<identificador>
 *   credential = base64(HMAC-SHA1(username, segredo-estatico))
 *
 * O segredo nunca sai do servidor — o front recebe apenas o par ja derivado,
 * valido por algumas horas.
 */
const TURN_TTL_SECONDS = Number(process.env.TURN_TTL_SECONDS ?? 6 * 60 * 60);

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function buildIceConfig(identity: string): IceConfigResponse {
  const stunUrls = splitList(process.env.STUN_URLS);
  const turnUrls = splitList(process.env.TURN_URLS);
  const secret = process.env.TURN_SECRET;

  const iceServers: IceConfigResponse['iceServers'] = [];
  if (stunUrls.length > 0) iceServers.push({ urls: stunUrls });

  const hasTurn = turnUrls.length > 0 && Boolean(secret);
  if (hasTurn) {
    const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
    const username = `${expiry}:${identity}`;
    const credential = createHmac('sha1', secret as string).update(username).digest('base64');
    iceServers.push({ urls: turnUrls, username, credential });
  }

  return { iceServers, hasTurn };
}
