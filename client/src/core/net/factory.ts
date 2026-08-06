import type { Transport } from './transport'
import { WebSocketTransport } from './websocketTransport'
import { WebTransportTransport } from './webtransportTransport'

/** 特性检测：WebTransport 可用且被请求时使用，否则回退 WebSocket。 */
export function createTransport(preferWebTransport = false): Transport {
  if (preferWebTransport && typeof globalThis.WebTransport === 'function') {
    return new WebTransportTransport()
  }
  return new WebSocketTransport()
}
