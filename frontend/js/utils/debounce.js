/**
 * Debounce and Throttle Utilities
 * Performance optimization for event handlers
 */

/**
 * Creates a debounced version of a function that delays execution
 * until after the specified wait time has elapsed since the last call.
 *
 * @param {Function} fn - The function to debounce
 * @param {number} wait - The delay in milliseconds (default: 250ms)
 * @param {Object} options - Options object
 * @param {boolean} options.leading - Execute on the leading edge (default: false)
 * @param {boolean} options.trailing - Execute on the trailing edge (default: true)
 * @returns {Function} The debounced function with a cancel() method
 */
export function debounce(fn, wait = 250, options = {}) {
  const { leading = false, trailing = true } = options;

  let timeoutId = null;
  let lastArgs = null;
  let lastThis = null;
  let lastCallTime = 0;
  let lastInvokeTime = 0;

  function invokeFunc(time) {
    const args = lastArgs;
    const thisArg = lastThis;
    lastArgs = lastThis = null;
    lastInvokeTime = time;
    return fn.apply(thisArg, args);
  }

  function leadingEdge(time) {
    lastInvokeTime = time;
    timeoutId = setTimeout(timerExpired, wait);
    return leading ? invokeFunc(time) : undefined;
  }

  function remainingWait(time) {
    const timeSinceLastCall = time - lastCallTime;
    const timeWaiting = wait - timeSinceLastCall;
    return timeWaiting;
  }

  function shouldInvoke(time) {
    const timeSinceLastCall = time - lastCallTime;
    return (
      lastCallTime === 0 ||
      timeSinceLastCall >= wait ||
      timeSinceLastCall < 0
    );
  }

  function timerExpired() {
    const time = Date.now();
    if (shouldInvoke(time)) {
      return trailingEdge(time);
    }
    timeoutId = setTimeout(timerExpired, remainingWait(time));
  }

  function trailingEdge(time) {
    timeoutId = null;
    if (trailing && lastArgs) {
      return invokeFunc(time);
    }
    lastArgs = lastThis = null;
    return undefined;
  }

  function cancel() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    lastArgs = lastThis = null;
    lastCallTime = lastInvokeTime = 0;
    timeoutId = null;
  }

  function flush() {
    if (timeoutId === null) {
      return undefined;
    }
    return trailingEdge(Date.now());
  }

  function debounced(...args) {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);

    lastArgs = args;
    lastThis = this;
    lastCallTime = time;

    if (isInvoking) {
      if (timeoutId === null) {
        return leadingEdge(time);
      }
    }

    if (timeoutId === null) {
      timeoutId = setTimeout(timerExpired, wait);
    }

    return undefined;
  }

  debounced.cancel = cancel;
  debounced.flush = flush;

  return debounced;
}

/**
 * Creates a throttled version of a function that only executes
 * at most once per specified time period.
 *
 * @param {Function} fn - The function to throttle
 * @param {number} wait - The minimum time between calls in milliseconds
 * @param {Object} options - Options object
 * @param {boolean} options.leading - Execute on the leading edge (default: true)
 * @param {boolean} options.trailing - Execute on the trailing edge (default: true)
 * @returns {Function} The throttled function with a cancel() method
 */
export function throttle(fn, wait = 250, options = {}) {
  const { leading = true, trailing = true } = options;
  return debounce(fn, wait, { leading, trailing, maxWait: wait });
}

/**
 * Creates an async debounced function that cancels pending executions
 * when a new call comes in before the previous one completes.
 *
 * @param {Function} fn - The async function to debounce
 * @param {number} wait - The delay in milliseconds
 * @returns {Function} The debounced async function
 */
export function debounceAsync(fn, wait = 250) {
  let timeoutId = null;
  let currentPromise = null;
  let abortController = null;

  async function debounced(...args) {
    // Cancel any pending timeout
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    // Abort any in-flight request
    if (abortController) {
      abortController.abort();
    }

    return new Promise((resolve, reject) => {
      timeoutId = setTimeout(async () => {
        abortController = new AbortController();
        try {
          const result = await fn.apply(this, [...args, abortController.signal]);
          resolve(result);
        } catch (error) {
          if (error.name !== 'AbortError') {
            reject(error);
          }
        } finally {
          abortController = null;
        }
      }, wait);
    });
  }

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  };

  return debounced;
}
