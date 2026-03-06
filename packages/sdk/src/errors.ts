import type { DeployStep } from "./types.js";

/** Base error class for all SDK errors. */
export class ClawRunError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ClawRunError";
  }
}

/** HTTP non-2xx response from the deployed instance API. */
export class ApiError extends ClawRunError {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(statusCode: number, responseBody: string) {
    super(`API request failed with status ${statusCode}`);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

/** Network-level failure (fetch rejected, timeout, DNS, etc.). */
export class NetworkError extends ClawRunError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NetworkError";
  }
}

/** A deploy step failed. */
export class DeployError extends ClawRunError {
  readonly step: DeployStep;

  constructor(step: DeployStep, message: string, options?: ErrorOptions) {
    super(`Deploy failed at step "${step}": ${message}`, options);
    this.name = "DeployError";
    this.step = step;
  }
}

/** An error event received on the chat stream. */
export class ChatStreamError extends ClawRunError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ChatStreamError";
  }
}

/** Sandbox operations attempted without provider configuration. */
export class ProviderNotConfiguredError extends ClawRunError {
  constructor() {
    super("Sandbox provider not configured. Pass provider config when creating the instance.");
    this.name = "ProviderNotConfiguredError";
  }
}
