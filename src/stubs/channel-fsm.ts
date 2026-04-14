/**
 * Metered Flow Protocol channel FSM.
 * 8-state finite state machine for payment channel management.
 *
 * Inlined from semantos-core/packages/metering/src/channel-fsm.ts
 * Pure logic — zero external dependencies.
 */

/**
 * Valid states for a metering channel.
 */
export enum ChannelState {
  NEGOTIATING = 'NEGOTIATING',
  FUNDED = 'FUNDED',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  CLOSING_REQUESTED = 'CLOSING_REQUESTED',
  CLOSING_CONFIRMED = 'CLOSING_CONFIRMED',
  SETTLED = 'SETTLED',
  DISPUTED = 'DISPUTED',
}

/**
 * A metering channel represents a payment channel between two parties.
 */
export interface MeteringChannel {
  channelId: string;
  state: ChannelState;
  providerCertId: string;
  consumerCertId: string;
  fundingOutpoint: string | null;
  currentTick: number;
  nSequence: number;
  cumulativeSatoshis: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Result type for FSM operations.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Transition table mapping (fromState, action) to toState.
 */
const transitionTable: Record<
  ChannelState,
  Partial<Record<string, ChannelState>>
> = {
  [ChannelState.NEGOTIATING]: {
    fund: ChannelState.FUNDED,
  },
  [ChannelState.FUNDED]: {
    activate: ChannelState.ACTIVE,
  },
  [ChannelState.ACTIVE]: {
    pause: ChannelState.PAUSED,
    requestClose: ChannelState.CLOSING_REQUESTED,
  },
  [ChannelState.PAUSED]: {
    resume: ChannelState.ACTIVE,
    requestClose: ChannelState.CLOSING_REQUESTED,
  },
  [ChannelState.CLOSING_REQUESTED]: {
    confirmClose: ChannelState.CLOSING_CONFIRMED,
    dispute: ChannelState.DISPUTED,
  },
  [ChannelState.CLOSING_CONFIRMED]: {
    settle: ChannelState.SETTLED,
    dispute: ChannelState.DISPUTED,
  },
  [ChannelState.SETTLED]: {},
  [ChannelState.DISPUTED]: {
    resolve: ChannelState.SETTLED,
  },
};

/**
 * Creates a new channel in NEGOTIATING state.
 */
export function createChannel(
  providerCertId: string,
  consumerCertId: string
): MeteringChannel {
  const now = Date.now();
  return {
    channelId: `ch_${Math.random().toString(36).substr(2, 9)}`,
    state: ChannelState.NEGOTIATING,
    providerCertId,
    consumerCertId,
    fundingOutpoint: null,
    currentTick: 0,
    nSequence: 0,
    cumulativeSatoshis: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Transitions channel from NEGOTIATING to FUNDED.
 */
export function fund(
  channel: MeteringChannel,
  fundingOutpoint: string
): Result<MeteringChannel> {
  if (!canTransition(channel.state, 'fund')) {
    return {
      ok: false,
      error: `Cannot fund channel in state ${channel.state}`,
    };
  }

  return {
    ok: true,
    value: {
      ...channel,
      state: ChannelState.FUNDED,
      fundingOutpoint,
      updatedAt: Date.now(),
    },
  };
}

/**
 * Transitions channel from FUNDED to ACTIVE.
 */
export function activate(channel: MeteringChannel): Result<MeteringChannel> {
  if (!canTransition(channel.state, 'activate')) {
    return {
      ok: false,
      error: `Cannot activate channel in state ${channel.state}`,
    };
  }

  return {
    ok: true,
    value: {
      ...channel,
      state: ChannelState.ACTIVE,
      updatedAt: Date.now(),
    },
  };
}

/**
 * Transitions channel from ACTIVE to PAUSED.
 */
export function pause(channel: MeteringChannel): Result<MeteringChannel> {
  if (!canTransition(channel.state, 'pause')) {
    return {
      ok: false,
      error: `Cannot pause channel in state ${channel.state}`,
    };
  }

  return {
    ok: true,
    value: {
      ...channel,
      state: ChannelState.PAUSED,
      updatedAt: Date.now(),
    },
  };
}

/**
 * Transitions channel from PAUSED to ACTIVE.
 */
export function resume(channel: MeteringChannel): Result<MeteringChannel> {
  if (!canTransition(channel.state, 'resume')) {
    return {
      ok: false,
      error: `Cannot resume channel in state ${channel.state}`,
    };
  }

  return {
    ok: true,
    value: {
      ...channel,
      state: ChannelState.ACTIVE,
      updatedAt: Date.now(),
    },
  };
}

/**
 * Records a tick (increment) in the ACTIVE state.
 * Increments currentTick, nSequence, and cumulativeSatoshis.
 */
export function tick(
  channel: MeteringChannel,
  satoshisThisTick: number
): Result<MeteringChannel> {
  if (channel.state !== ChannelState.ACTIVE) {
    return {
      ok: false,
      error: `Cannot tick channel in state ${channel.state}; must be ACTIVE`,
    };
  }

  if (satoshisThisTick < 0) {
    return {
      ok: false,
      error: 'satoshisThisTick must be non-negative',
    };
  }

  return {
    ok: true,
    value: {
      ...channel,
      currentTick: channel.currentTick + 1,
      nSequence: channel.nSequence + 1,
      cumulativeSatoshis: channel.cumulativeSatoshis + satoshisThisTick,
      updatedAt: Date.now(),
    },
  };
}

/**
 * Transitions channel to CLOSING_REQUESTED.
 * Valid from ACTIVE or PAUSED.
 */
export function requestClose(
  channel: MeteringChannel
): Result<MeteringChannel> {
  if (!canTransition(channel.state, 'requestClose')) {
    return {
      ok: false,
      error: `Cannot request close from state ${channel.state}`,
    };
  }

  return {
    ok: true,
    value: {
      ...channel,
      state: ChannelState.CLOSING_REQUESTED,
      updatedAt: Date.now(),
    },
  };
}

/**
 * Transitions channel from CLOSING_REQUESTED to CLOSING_CONFIRMED.
 */
export function confirmClose(
  channel: MeteringChannel
): Result<MeteringChannel> {
  if (!canTransition(channel.state, 'confirmClose')) {
    return {
      ok: false,
      error: `Cannot confirm close from state ${channel.state}`,
    };
  }

  return {
    ok: true,
    value: {
      ...channel,
      state: ChannelState.CLOSING_CONFIRMED,
      updatedAt: Date.now(),
    },
  };
}

/**
 * Transitions channel from CLOSING_CONFIRMED to SETTLED.
 */
export function settle(
  channel: MeteringChannel,
  settlementTxId: string
): Result<MeteringChannel> {
  if (!canTransition(channel.state, 'settle')) {
    return {
      ok: false,
      error: `Cannot settle channel from state ${channel.state}`,
    };
  }

  return {
    ok: true,
    value: {
      ...channel,
      state: ChannelState.SETTLED,
      updatedAt: Date.now(),
    },
  };
}

/**
 * Transitions channel to DISPUTED.
 * Valid from CLOSING_REQUESTED or CLOSING_CONFIRMED.
 */
export function dispute(
  channel: MeteringChannel,
  reason: string
): Result<MeteringChannel> {
  if (!canTransition(channel.state, 'dispute')) {
    return {
      ok: false,
      error: `Cannot dispute channel from state ${channel.state}; reason: ${reason}`,
    };
  }

  return {
    ok: true,
    value: {
      ...channel,
      state: ChannelState.DISPUTED,
      updatedAt: Date.now(),
    },
  };
}

/**
 * Helper: checks if a transition is valid from a given state.
 */
function canTransition(state: ChannelState, action: string): boolean {
  const validActions = transitionTable[state];
  return validActions !== undefined && action in validActions;
}

/**
 * Returns the list of valid action names for a given state.
 */
export function getValidTransitions(state: ChannelState): string[] {
  const validActions = transitionTable[state];
  return validActions !== undefined ? Object.keys(validActions) : [];
}
