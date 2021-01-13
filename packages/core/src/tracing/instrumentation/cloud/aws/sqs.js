'use strict';

const shimmer = require('shimmer');
const cls = require('../../../cls');
const {
  traceIdHeaderNameLowerCase,
  spanIdHeaderNameLowerCase,
  traceLevelHeaderNameLowerCase,
  ENTRY,
  EXIT,
  isExitSpan
} = require('../../../constants');
const requireHook = require('../../../../util/requireHook');
const tracingUtil = require('../../../tracingUtil');

const queueNameRE = /\/(\w+)$/;

const logger = require('../../../../logger').getLogger('tracing/sqs', newLogger => {
  logger = newLogger;
});

let isActive = false;

function getQueueName(queueURL) {
  const match = queueURL.match(queueNameRE);

  if (match && match.length >= 2) {
    return match[1];
  }
  return '';
}

function finishSpan(err, data, span) {
  if (err) {
    addErrorToSpan(err, span);
  }
  if (typeof data === 'string') {
    span.data.sqs.messageId = data;
  }

  span.d = Date.now() - span.ts;
  span.transmit();
}

function addErrorToSpan(err, span) {
  if (err) {
    span.ec = 1;
    if (err.message) {
      span.data.sqs.error = err.message;
    } else if (typeof err === 'string') {
      span.data.sqs.error = err;
    }
  }
}

function propagateSuppression(attributes) {
  if (!attributes || typeof attributes !== 'object') {
    return;
  }
  attributes[traceLevelHeaderNameLowerCase] = '0';
}

function propagateTraceContext(attributes, span) {
  if (!attributes || typeof attributes !== 'object') {
    return;
  }
  attributes[traceIdHeaderNameLowerCase] = span.t;
  attributes[spanIdHeaderNameLowerCase] = span.s;
  attributes[traceLevelHeaderNameLowerCase] = '1';
}

function shimSendMessage(original) {
  return function () {
    if (isActive) {
      const originalArgs = new Array(arguments.length);
      for (let i = 0; i < originalArgs.length; i++) {
        originalArgs[i] = arguments[i];
      }

      return instrumentedSendMessage(this, original, originalArgs);
    }

    return original.apply(this, arguments);
  };
}

function instrumentedSendMessage(ctx, originalSendMessage, originalArgs) {
  /**
   * sendMessage argument:
  * {
  *   MessageBody: 'message sent via promise',
  *   QueueUrl: 'https://sqs.us-east-2.amazonaws.com/410797082306/node_sensor'
  * }
   */
  const attributes = Object.assign({}, originalArgs[0]);

  if (cls.tracingSuppressed()) {
    propagateSuppression(attributes);
  }

  const parentSpan = cls.getCurrentSpan();

  if (!parentSpan || isExitSpan(parentSpan)) {
    return originalSendMessage.apply(ctx, originalArgs);
  }

  return cls.ns.runAndReturn(() => {
    const span = cls.startSpan('sqs', EXIT);
    span.ts = Date.now();
    span.stack = tracingUtil.getStackTrace(instrumentedSendMessage);
    span.data.sqs = {
      sort: '',
      queue: getQueueName(originalArgs[0].QueueUrl)
    };

    propagateTraceContext(attributes, span);

    const originalCallback = originalArgs[1];
    if (typeof originalCallback === 'function') {
      originalArgs[1] = cls.ns.bind(function(err, data) {
        finishSpan(err, data, span);
        originalCallback.apply(this, arguments);
      });
    }

    const awsRequest = originalSendMessage.apply(ctx, originalArgs);

    if (typeof awsRequest.promise === 'function') {
      awsRequest.promise = cls.ns.bind(awsRequest.promise);
    }

    // this is what the promise actually does
    awsRequest.on('complete', function onComplete(resp) {
      if (resp && resp.error) {
        finishSpan(resp.error, null, span);
        throw resp.error;
      } else {
        finishSpan(null, resp, span);
        return resp;
      }
    });

    return awsRequest;
  });
}

function shimReceiveMessage(originalReceiveMessage) {
  return function () {
    if (isActive) {
      const parentSpan = cls.getCurrentSpan();
      if (parentSpan) {
        logger.warn(
          // eslint-disable-next-line max-len
          `Cannot start a AWS SQS entry span when another span is already active. Currently, the following span is active: ${JSON.stringify(
            parentSpan
          )}`
        );
        return originalReceiveMessage.apply(this, arguments);
      }

      const originalArgs = new Array(arguments.length);
      for (let i = 0; i < originalArgs.length; i++) {
        originalArgs[i] = arguments[i];
      }
      return instrumentReceiveMessage(this, originalReceiveMessage, originalArgs);
    }

    return originalReceiveMessage.apply(this, arguments);
  };
}

function instrumentReceiveMessage(ctx, originalReceiveMessage, originalArgs) {
  console.log('**** receive message called with', originalArgs);

  const attributes = Object.assign({}, originalArgs[0]);

  return cls.ns.runAndReturn(() => {
    if (tracingUtil.readAttribCaseInsensitive(attributes, traceLevelHeaderNameLowerCase) === '0') {
      cls.setTracingLevel('0');
      return originalReceiveMessage.apply(ctx, originalArgs);
    }

    // is callback case
    const originalCallback = originalArgs[1];
    if (typeof originalCallback === 'function') {
      originalArgs[1] = cls.ns.bind(function(err, messageData) {
        console.log('err', err, 'data', messageData);
        const span = cls.startSpan('sqs', ENTRY);
        span.ts = Date.now();
        span.stack = tracingUtil.getStackTrace(instrumentedSendMessage);
        span.data.sqs = {
          sort: '',
          queue: getQueueName(originalArgs[0].QueueUrl)
        };

        propagateTraceContext(attributes, span);

        if (err || (messageData && messageData.Messages && messageData.Messages.length > 0)) {
          finishSpan(err, messageData, span);
        } else {
          console.log('*************** NO MESSAGE, NO TRACE');
        }

        originalCallback.apply(this, arguments);
      });
    }

    const res = originalReceiveMessage.apply(ctx, originalArgs);

    return res;
  });
}

function instrumentSQS(AWS) {
  // /aws-sdk/lib/service.js#defineMethods
  shimmer.wrap(AWS.Service, 'defineMethods', function (original) {
    return function (svc) {
      const res = original.apply(this, arguments);

      if (
        svc &&
        svc.prototype &&
        typeof svc.prototype.serviceIdentifier === 'string' &&
        svc.prototype.serviceIdentifier.toLowerCase() === 'sqs') {
        shimmer.wrap(svc.prototype, 'sendMessage', shimSendMessage);
        shimmer.wrap(svc.prototype, 'receiveMessage', shimReceiveMessage);
      }

      return res;
    };
  });
}

exports.init = function init() {
  requireHook.onModuleLoad('aws-sdk', instrumentSQS);
};

exports.activate = function activate() {
  isActive = true;
};

exports.deactivate = function deactivate() {
  isActive = false;
};
