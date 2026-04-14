/**
 * PolicyHotSwapper — Atomic policy replacement for the game loop.
 *
 * The game loop holds a reference to the current compiled policy.
 * The shadow loop compiles in background and atomically replaces
 * this reference. No thread locks, no missed hands.
 */

import type { PolicyVersion, GameLoopHandle } from './shadow-loop-types';

/**
 * Simple atomic reference wrapper.
 * In single-threaded JS/Bun, assignment is already atomic.
 * This wrapper provides a clean API and CAS semantics for future use
 * (e.g., worker threads or SharedArrayBuffer).
 */
export class AtomicReference<T> {
  private value: T;

  constructor(initial: T) {
    this.value = initial;
  }

  set(newValue: T): void {
    this.value = newValue;
  }

  get(): T {
    return this.value;
  }

  /** Compare-and-swap: only update if current matches expected. */
  cas(expected: T, newValue: T): boolean {
    if (this.value === expected) {
      this.value = newValue;
      return true;
    }
    return false;
  }
}

export class PolicyHotSwapper implements GameLoopHandle {
  private currentPolicyRef: AtomicReference<PolicyVersion>;

  constructor(initialPolicy: PolicyVersion) {
    this.currentPolicyRef = new AtomicReference(initialPolicy);
  }

  setPolicyReference(policy: PolicyVersion): void {
    this.currentPolicyRef.set(policy);
    console.log(`[HotSwapper] Policy reference updated: v${policy.version}`);
  }

  getCurrentPolicy(): PolicyVersion {
    return this.currentPolicyRef.get();
  }
}
