/**
 * Circuit breaker pattern for protecting against cascading failures
 * when domains or services become unreliable.
 *
 * States:
 *  - CLOSED   : Normal operation, requests flow through.
 *  - OPEN     : Too many failures, requests are rejected immediately.
 *  - HALF_OPEN: Recovery probe in progress, one test request allowed.
 */

import { getLogger } from '../shared/logger.js';

const log = getLogger('queue', { component: 'circuit-breaker' });

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitRecord {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: number;
  lastStateChangeAt: number;
}

const DEFAULTS = {
  /** Number of consecutive failures before opening the circuit. */
  FAILURE_THRESHOLD: 5,
  /** Time in ms before an OPEN circuit transitions to HALF_OPEN. */
  RECOVERY_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes
  /** Number of successes in HALF_OPEN before closing the circuit. */
  HALF_OPEN_SUCCESS_THRESHOLD: 1,
} as const;

export class CircuitBreaker {
  private readonly circuits = new Map<string, CircuitRecord>();
  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly halfOpenSuccessThreshold: number;

  constructor(options?: {
    failureThreshold?: number;
    recoveryTimeoutMs?: number;
    halfOpenSuccessThreshold?: number;
  }) {
    this.failureThreshold = options?.failureThreshold ?? DEFAULTS.FAILURE_THRESHOLD;
    this.recoveryTimeoutMs = options?.recoveryTimeoutMs ?? DEFAULTS.RECOVERY_TIMEOUT_MS;
    this.halfOpenSuccessThreshold =
      options?.halfOpenSuccessThreshold ?? DEFAULTS.HALF_OPEN_SUCCESS_THRESHOLD;
  }

  /**
   * Returns `true` if the circuit for the given domain is closed or half-open
   * (i.e., requests are allowed to proceed).
   */
  canExecute(domain: string): boolean {
    const circuit = this.getOrCreate(domain);

    switch (circuit.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN: {
        const elapsed = Date.now() - circuit.lastStateChangeAt;
        if (elapsed >= this.recoveryTimeoutMs) {
          // Transition to HALF_OPEN and allow a single test request
          this.transition(domain, circuit, CircuitState.HALF_OPEN);
          return true;
        }
        log.debug(
          { domain, timeUntilRecoveryMs: this.recoveryTimeoutMs - elapsed },
          'Circuit OPEN, rejecting request',
        );
        return false;
      }

      case CircuitState.HALF_OPEN:
        // In HALF_OPEN state, allow requests through for testing
        return true;

      default:
        return true;
    }
  }

  /**
   * Records a successful request for the given domain.
   * In HALF_OPEN state, sufficient successes will close the circuit.
   */
  recordSuccess(domain: string): void {
    const circuit = this.getOrCreate(domain);

    switch (circuit.state) {
      case CircuitState.HALF_OPEN:
        circuit.successCount += 1;
        if (circuit.successCount >= this.halfOpenSuccessThreshold) {
          this.transition(domain, circuit, CircuitState.CLOSED);
          log.info({ domain }, 'Circuit breaker CLOSED after successful recovery');
        }
        break;

      case CircuitState.CLOSED:
        // Reset failure count on success
        circuit.failureCount = 0;
        circuit.successCount += 1;
        break;

      default:
        // Unexpected success in OPEN state -- just record it
        circuit.successCount += 1;
        break;
    }
  }

  /**
   * Records a failed request for the given domain.
   * Accumulating failures past the threshold will open the circuit.
   */
  recordFailure(domain: string): void {
    const circuit = this.getOrCreate(domain);

    circuit.failureCount += 1;
    circuit.lastFailureAt = Date.now();

    switch (circuit.state) {
      case CircuitState.CLOSED:
        if (circuit.failureCount >= this.failureThreshold) {
          this.transition(domain, circuit, CircuitState.OPEN);
          log.warn(
            { domain, failureCount: circuit.failureCount },
            'Circuit breaker OPENED after consecutive failures',
          );
        }
        break;

      case CircuitState.HALF_OPEN:
        // Test request failed -- re-open the circuit
        this.transition(domain, circuit, CircuitState.OPEN);
        log.warn(
          { domain },
          'Circuit breaker re-OPENED after failed recovery probe',
        );
        break;

      case CircuitState.OPEN:
        // Already open, just accumulate stats
        break;
    }
  }

  /**
   * Returns the current state of the circuit for a domain.
   * If no circuit exists, returns CLOSED (healthy default).
   */
  getState(domain: string): CircuitState {
    const circuit = this.circuits.get(domain);
    if (!circuit) {
      return CircuitState.CLOSED;
    }

    // Check for automatic OPEN -> HALF_OPEN transition
    if (circuit.state === CircuitState.OPEN) {
      const elapsed = Date.now() - circuit.lastStateChangeAt;
      if (elapsed >= this.recoveryTimeoutMs) {
        this.transition(domain, circuit, CircuitState.HALF_OPEN);
      }
    }

    return circuit.state;
  }

  /**
   * Resets the circuit for a domain back to CLOSED with zero counters.
   */
  reset(domain: string): void {
    this.circuits.delete(domain);
    log.info({ domain }, 'Circuit breaker manually reset');
  }

  /**
   * Returns a snapshot of all tracked circuits for monitoring.
   */
  getAllCircuits(): ReadonlyMap<string, Readonly<CircuitRecord>> {
    return this.circuits;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private getOrCreate(domain: string): CircuitRecord {
    let circuit = this.circuits.get(domain);
    if (!circuit) {
      circuit = {
        state: CircuitState.CLOSED,
        failureCount: 0,
        successCount: 0,
        lastFailureAt: 0,
        lastStateChangeAt: Date.now(),
      };
      this.circuits.set(domain, circuit);
    }
    return circuit;
  }

  private transition(
    domain: string,
    circuit: CircuitRecord,
    newState: CircuitState,
  ): void {
    const oldState = circuit.state;
    circuit.state = newState;
    circuit.lastStateChangeAt = Date.now();

    // Reset counters on state change
    if (newState === CircuitState.CLOSED) {
      circuit.failureCount = 0;
      circuit.successCount = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      circuit.successCount = 0;
    }

    log.debug(
      { domain, from: oldState, to: newState },
      'Circuit state transition',
    );
  }
}
