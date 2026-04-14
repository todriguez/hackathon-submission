/**
 * Stub for metering/channel-fsm — payment channels are not used in the hackathon demo.
 * The full implementation lives in semantos-core monorepo.
 */

export enum ChannelState {
  CREATED = 'CREATED',
  FUNDED = 'FUNDED',
  ACTIVE = 'ACTIVE',
  CLOSING = 'CLOSING',
  SETTLED = 'SETTLED',
}

export interface MeteringChannel {
  state: ChannelState;
  channelId: string;
  balance: [number, number];
  nonce: number;
}

export function createChannel(..._args: any[]): MeteringChannel {
  throw new Error('Payment channels not available in standalone demo. Use semantos-core for full implementation.');
}

export function fund(..._args: any[]): MeteringChannel { throw new Error('Not available in standalone demo'); }
export function activate(..._args: any[]): MeteringChannel { throw new Error('Not available in standalone demo'); }
export function tick(..._args: any[]): MeteringChannel { throw new Error('Not available in standalone demo'); }
export function requestClose(..._args: any[]): MeteringChannel { throw new Error('Not available in standalone demo'); }
export function confirmClose(..._args: any[]): MeteringChannel { throw new Error('Not available in standalone demo'); }
export function settle(..._args: any[]): MeteringChannel { throw new Error('Not available in standalone demo'); }
