/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const DATA_LOG_PREFIX = '[baselode:data]';

/**
 * Convert any value to an Error object
 * @param {*} error - Value to convert (Error, string, or other)
 * @param {string} fallbackMessage - Message to use if error is not Error or string
 * @returns {Error} Error object
 */
export function toError(error, fallbackMessage = 'Unknown error') {
  if (error instanceof Error) return error;
  const message = typeof error === 'string' && error.trim() ? error : fallbackMessage;
  return new Error(message);
}

/**
 * Wrap an error with contextual information about where it occurred
 * @param {string} context - Context description (e.g., function name)
 * @param {*} error - Original error
 * @param {string} fallbackMessage - Fallback message if error cannot be parsed
 * @returns {Error} Wrapped error with context and original as cause
 */
export function withDataErrorContext(context, error, fallbackMessage = 'Operation failed') {
  const baseError = toError(error, fallbackMessage);
  const wrapped = new Error(`${context}: ${baseError.message}`);
  wrapped.cause = baseError;
  return wrapped;
}

/**
 * Log a warning message with optional error object
 * @param {string} message - Warning message
 * @param {Error} [error] - Optional error object to log
 */
export function logDataWarning(message, error) {
  if (error !== undefined) {
    console.warn(`${DATA_LOG_PREFIX} ${message}`, error);
    return;
  }
  console.warn(`${DATA_LOG_PREFIX} ${message}`);
}

/**
 * Log an informational message
 * @param {string} message - Info message
 */
export function logDataInfo(message) {
  console.info(`${DATA_LOG_PREFIX} ${message}`);
}