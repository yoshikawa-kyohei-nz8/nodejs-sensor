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

// const logger = require('../../../../logger').getLogger('tracing/sqs', newLogger => {
//   logger = newLogger;
// });

let isActive = false;

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
      fakeAttribute: `test ${Math.random() * 1e5}`
      // op: 'publish',
      // projid: ctx.topic && (ctx.topic.parent || ctx.topic.pubsub || {}).projectId,
      // top: unqualifyName(ctx.topic && ctx.topic.name),
      // messageId: message.id
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

    // cls.ns.bindEmitter(awsRequest);

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

function shimReceiveMessage(original) {
  return function () {
    if (isActive) {
      const originalArgs = new Array(arguments.length);
      for (let i = 0; i < originalArgs.length; i++) {
        originalArgs[i] = arguments[i];
      }
      return instrumentReceiveMessage(this, original, originalArgs);
    }

    return original.apply(this, arguments);
  };
}

function instrumentReceiveMessage(ctx, originalReceiveMessage, originalArgs) {
  const res = originalReceiveMessage.apply(ctx, originalArgs);
  // console.log('*** receiveMessage was called with ', originalArgs);
  return res;
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
