'use strict';

const applicationUnderMonitoring = require('@instana/core').util.applicationUnderMonitoring;

let logger = require('@instana/core').logger.getLogger('metrics');
exports.setLogger = function setLogger(_logger) {
  logger = _logger;
};

exports.payloadPrefix = 'version';
exports.currentPayload = undefined;

const MAX_ATTEMPTS = 20;
const DELAY = 1000;
let attempts = 0;

exports.activate = function activate() {
  attempts++;
  applicationUnderMonitoring.getMainPackageJson((err, packageJson) => {
    if (err) {
      return logger.warn('Failed to determine main package json. Reason: ', err.message, err.stack);
    } else if (!packageJson && attempts < MAX_ATTEMPTS) {
      setTimeout(exports.activate, DELAY).unref();
      return;
    } else if (!packageJson) {
      // final attempt failed, ignore silently
      return;
    }

    exports.currentPayload = packageJson.version;
  });
};
