/*
 * Copyright (C) 2026 Tamara Vasey
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const DATA_LOG_PREFIX = '[baselode:data]';

export function toError(error, fallbackMessage = 'Unknown error') {
  if (error instanceof Error) return error;
  const message = typeof error === 'string' && error.trim() ? error : fallbackMessage;
  return new Error(message);
}

export function withDataErrorContext(context, error, fallbackMessage = 'Operation failed') {
  const baseError = toError(error, fallbackMessage);
  const wrapped = new Error(`${context}: ${baseError.message}`);
  wrapped.cause = baseError;
  return wrapped;
}

export function logDataWarning(message, error) {
  if (error !== undefined) {
    console.warn(`${DATA_LOG_PREFIX} ${message}`, error);
    return;
  }
  console.warn(`${DATA_LOG_PREFIX} ${message}`);
}

export function logDataInfo(message) {
  console.info(`${DATA_LOG_PREFIX} ${message}`);
}