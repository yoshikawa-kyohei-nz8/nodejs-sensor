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

  attributes[traceLevelHeaderNameLowerCase] = {
    DataType: 'String',
    StringValue: '0'
  };
}

function propagateTraceContext(attributes, span) {
  if (!attributes || typeof attributes !== 'object') {
    return;
  }

  attributes[traceIdHeaderNameLowerCase] = {
    DataType: 'String',
    StringValue: span.t
  };

  attributes[spanIdHeaderNameLowerCase] = {
    DataType: 'String',
    StringValue: span.s
  };

  attributes[traceLevelHeaderNameLowerCase] = {
    DataType: 'String',
    StringValue: '1'
  };
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
   * Send Message Attribues format
   * {
   *    ...
   *    MessageAttributes: {
   *      CustomAttribute: {
   *        DataType: 'String',
   *        StringValue: 'Custom Value'
   *      }
   *    }
   * }
   */
  let attributes = originalArgs[0].MessageAttributes;

  if (!attributes) {
    attributes = originalArgs[0].MessageAttributes = {};
  }

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
      sort: 'publish',
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
    awsRequest.on('complete', function onComplete(data) {
      if (data && data.error) {
        finishSpan(data.error, null, span);
        throw data.error;
      } else {
        finishSpan(null, data, span);
        return data;
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

/**
 * Flattens the AWS SQS MessageAttribute format into a basic object structure.
 *
 * @param {SQS MessageAttributes} sqsAttributes The AWS SQS MessageAttribute object
 * @returns {Object} An object in the format { attribute1: value1, attribute2: value2... }
 */
function convertAttributesFromSQS(sqsAttributes) {
  const attributes = {};

  const keys = Object.keys(sqsAttributes);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    if (sqsAttributes[key].DataType === 'String') {
      attributes[key] = sqsAttributes[key].StringValue;
    }
  }

  return attributes;
}

function instrumentReceiveMessage(ctx, originalReceiveMessage, originalArgs) {
  return cls.ns.runAndReturn(() => {
    let span = null;
    let attributes;

    // callback use case
    const originalCallback = originalArgs[1];
    if (typeof originalCallback === 'function') {
      originalArgs[1] = cls.ns.bind(function(err, data) {
        if (err || (data && data.Messages && data.Messages.length > 0)) {
          // TODO: Loop through messages
          attributes = convertAttributesFromSQS(data.Messages[0].MessageAttributes);

          span.t = tracingUtil.readAttribCaseInsensitive(attributes, traceIdHeaderNameLowerCase);
          span.p = tracingUtil.readAttribCaseInsensitive(attributes, spanIdHeaderNameLowerCase);
          span.ts = Date.now();

          if (tracingUtil.readAttribCaseInsensitive(attributes, traceLevelHeaderNameLowerCase) === '0') {
            cls.setTracingLevel('0');
            return originalReceiveMessage.apply(ctx, originalArgs);
          }

          propagateTraceContext(attributes, span);

          try {
            console.log('+++++++++++++ GOES HERE: try');
            return originalCallback.apply(this, arguments);
          } finally {
            console.log('+++++++++++++ GOES HERE: finally');
            setImmediate(() => {
              // Client code is expected to end the span manually, end it automatically in case client code doesn't.
              // Child exit spans won't be captured, but at least the PubSub entry span is there.
              span.d = Date.now() - span.ts;
              span.transmit();
              // finishSpan(err, data, span);
            });
          }

          // finishSpan(err, data, span);
          // console.log('************ SHOULD HAVE FINISHED');
        } else {
          span.cancel();
          return originalCallback.apply(this, arguments);
        }

        // originalCallback.apply(this, arguments);
      });
    }

    span = cls.startSpan('sqs', ENTRY);
    // span.ts = Date.now();
    span.stack = tracingUtil.getStackTrace(instrumentedSendMessage);
    span.data.sqs = {
      sort: 'consume',
      queue: getQueueName(originalArgs[0].QueueUrl)
    };

    return originalReceiveMessage.apply(ctx, originalArgs);
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
