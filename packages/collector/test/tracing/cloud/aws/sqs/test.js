'use strict';

const path = require('path');
const { expect } = require('chai');
const { fail } = expect;
const semver = require('semver');

const constants = require('@instana/core').tracing.constants;
const supportedVersion = require('@instana/core').tracing.supportedVersion;
const config = require('../../../../../../core/test/config');
const { delay, expectExactlyOneMatching, retry, stringifyItems } = require('../../../../../../core/test/test_util');
const ProcessControls = require('../../../../test_util/ProcessControls');
const globalAgent = require('../../../../globalAgent');

const queueURL = 'https://sqs.us-east-2.amazonaws.com/410797082306/node_sensor';

// const defaultTopicName = `nodejs-test-topic-${semver.parse(process.version).major}`;
// const defaultSubscriptionName = `nodejs-test-subscription-${semver.parse(process.version).major}`;

// This suite is skipped if no GCP project ID has been provided via GPC_PROJECT. It also requires to either have GCP
// default credentials to be configured, for example via GOOGLE_APPLICATION_CREDENTIALS, or (for CI) to get
// the credentials as a string from GOOGLE_APPLICATION_CREDENTIALS_CONTENT.
let mochaSuiteFn;

if (!supportedVersion(process.versions.node)) {
  mochaSuiteFn = describe.skip;
} else {
  mochaSuiteFn = describe;
}

const retryTime = config.getTestTimeout() * 2;

mochaSuiteFn('tracing/cloud/aws/sqs', function() {
  this.timeout(config.getTestTimeout() * 3);

  globalAgent.setUpCleanUpHooks();
  const agentControls = globalAgent.instance;

  describe.only('tracing enabled, no suppression', function() {

    const senderControls = new ProcessControls({
      appPath: path.join(__dirname, 'sendMessage'),
      port: 3215,
      useGlobalAgent: true,
      env: {
        AWS_SQS_QUEUE_URL: queueURL
      }
    });
    const receiverControls = new ProcessControls({
      appPath: path.join(__dirname, 'receiveMessage'),
      useGlobalAgent: true,
      env: {
        AWS_SQS_QUEUE_URL: queueURL
      }
    });
    ProcessControls.setUpHooksWithRetryTime(retryTime, senderControls, receiverControls);

    // ['promise', 'callback'].forEach(apiVariant => {
      // [false, 'publisher'].forEach(withError => {
        // const mochaTestFn = apiVariant === 'callback' && withError === 'publisher' ? it.skip : it;

        // It's not clear how to trigger a non-sync error in the publisher, so we skip that combination.
        it(`must trace AWS SQS publish and consume messages`, () => {
          const apiPath = `/send-callback`;
          // const queryParams = [withError ? `withError=${withError}` : null].filter(param => !!param).join('&');
          // const apiPathWithQuery = queryParams ? `${apiPath}?${queryParams}` : `${apiPath}`;

          return senderControls
            .sendRequest({
              method: 'POST',
              path: apiPath,
            })
            .then(response => verify(response, apiPath, false /*withError*/));
        });
      // });
    // });

    function verify(response, apiPath, withError) {
      return retry(() => {
        return agentControls.getSpans().then(spans => verifySpans(spans, apiPath, null, withError));
      }, retryTime);
    }

    function verifySpans(spans, apiPath, messageId, withError) {
      const httpEntry = verifyHttpEntry(spans, apiPath);
      const sqsExit = verifySQSExit(spans, httpEntry, messageId, withError);
      if (withError !== 'publisher') {
        const sqsEntry = verifySQSEntry(spans, sqsExit, messageId, withError);
        // const httpExit = verifyHttpExit(spans, sqsEntry);
      }
    }

    function verifyHttpEntry(spans, apiPath) {
      return expectExactlyOneMatching(spans, [
        span => expect(span.p).to.not.exist,
        span => expect(span.k).to.equal(constants.ENTRY),
        span => expect(span.f.e).to.equal(String(senderControls.getPid())),
        span => expect(span.f.h).to.equal('agent-stub-uuid'),
        span => expect(span.n).to.equal('node.http.server'),
        span => expect(span.data.http.url).to.equal(apiPath)
      ]);
    }

    function verifyHttpExit(spans, parentSpan) {
      return expectExactlyOneMatching(spans, [
        span => expect(span.p).to.exist,
        span => expect(span.p).to.equal(parentSpan.s),
        span => expect(span.t).to.equal(parentSpan.t),
        span => expect(span.k).to.equal(constants.EXIT),
        span => expect(span.f.e).to.equal(String(receiverControls.getPid())),
        span => expect(span.f.h).to.equal('agent-stub-uuid'),
        span => expect(span.n).to.equal('node.http.client'),
      ]);
    }

    function verifySQSExit(spans, parent, messageId, withError) {
      return expectExactlyOneMatching(spans, [
        span => expect(span.n).to.equal('sqs'),
        span => expect(span.k).to.equal(constants.EXIT),
        span => expect(span.t).to.equal(parent.t),
        span => expect(span.p).to.equal(parent.s),
        span => expect(span.f.e).to.equal(String(senderControls.getPid())),
        span => expect(span.f.h).to.equal('agent-stub-uuid'),
        span => expect(span.error).to.not.exist,
        withError ? span => expect(span.ec).to.equal(1) : span => expect(span.ec).to.equal(0),
        span => expect(span.async).to.not.exist,
        span => expect(span.data).to.exist,
        span => expect(span.data.sqs).to.be.an('object'),
        span => expect(span.data.sqs.sort).to.equal('publish'),
        span => expect(span.data.sqs.queue).to.equal('node_sensor'),
        // if (withError === 'publisher') {
        //   expect(span.data.sqs.error).to.equal('Data must be in the form of a Buffer.');
        // } else {
        //   expect(span.data.sqs.messageId).to.equal(messageId);
        // }
      ]);
    }

    function verifySQSEntry(spans, parent, messageId, withError) {
      return expectExactlyOneMatching(spans, [
        span => expect(span.n).to.equal('sqs'),
        span => expect(span.k).to.equal(constants.ENTRY),
        span => expect(span.t).to.equal(parent.t),
        span => expect(span.p).to.equal(parent.s),
        span => expect(span.f.e).to.equal(String(receiverControls.getPid())),
        span => expect(span.f.h).to.equal('agent-stub-uuid'),
        span => expect(span.error).to.not.exist,
        withError ? span => expect(span.ec).to.equal(1) : span => expect(span.ec).to.equal(0),
        span => expect(span.async).to.not.exist,
        span => expect(span.data).to.exist,
        span => expect(span.data.sqs).to.be.an('object'),
        span => expect(span.data.sqs.sort).to.equal('consume'),
        span => expect(span.data.sqs.queue).to.equal('node_sensor'),
      ]);
    }
  });

  // describe('tracing enabled but suppressed', () => {

  //   const publisherControls = new ProcessControls({
  //     appPath: path.join(__dirname, 'publisher'),
  //     port: 3216,
  //     useGlobalAgent: true,
  //     env: {
  //       GCP_PROJECT: projectId,
  //       GCP_PUBSUB_TOPIC: topicName,
  //       GCP_PUBSUB_SUBSCRIPTION: subscriptionName
  //     }
  //   });
  //   const subscriberControls = new ProcessControls({
  //     appPath: path.join(__dirname, 'subscriber'),
  //     useGlobalAgent: true,
  //     env: {
  //       GCP_PROJECT: projectId,
  //       GCP_PUBSUB_TOPIC: topicName,
  //       GCP_PUBSUB_SUBSCRIPTION: subscriptionName
  //     }
  //   });
  //   ProcessControls.setUpHooksWithRetryTime(retryTime, publisherControls, subscriberControls);

  //   it('should not trace when suppressed', () =>
  //     publisherControls
  //       .sendRequest({
  //         method: 'POST',
  //         path: '/publish-promise',
  //         headers: {
  //           'X-INSTANA-L': '0'
  //         }
  //       })
  //       .then(response => {
  //         return retry(() => verifyResponseAndMessage(response, subscriberControls), retryTime)
  //           .then(() => delay(config.getTestTimeout() / 4))
  //           .then(() => agentControls.getSpans())
  //           .then(spans => {
  //             if (spans.length > 0) {
  //               fail(`Unexpected spans (Google Cloud Run/suppressed: ${stringifyItems(spans)}`);
  //             }
  //           });
  //       }));
  // });

  // describe('tracing disabled', function() {
  //   this.timeout(config.getTestTimeout() * 2);

  //   const topicName = defaultTopicName;
  //   const subscriptionName = defaultSubscriptionName;

  //   const publisherControls = new ProcessControls({
  //     appPath: path.join(__dirname, 'publisher'),
  //     port: 3216,
  //     useGlobalAgent: true,
  //     tracingEnabled: false,
  //     env: {
  //       GCP_PROJECT: projectId,
  //       GCP_PUBSUB_TOPIC: topicName,
  //       GCP_PUBSUB_SUBSCRIPTION: subscriptionName
  //     }
  //   });
  //   const subscriberControls = new ProcessControls({
  //     appPath: path.join(__dirname, 'subscriber'),
  //     useGlobalAgent: true,
  //     tracingEnabled: false,
  //     env: {
  //       GCP_PROJECT: projectId,
  //       GCP_PUBSUB_TOPIC: topicName,
  //       GCP_PUBSUB_SUBSCRIPTION: subscriptionName
  //     }
  //   });
  //   ProcessControls.setUpHooksWithRetryTime(retryTime, publisherControls, subscriberControls);

  //   it('should not trace when disabled', () =>
  //     publisherControls
  //       .sendRequest({
  //         method: 'POST',
  //         path: '/publish-promise'
  //       })
  //       .then(response => {
  //         return retry(() => verifyResponseAndMessage(response, subscriberControls), retryTime)
  //           .then(() => delay(config.getTestTimeout() / 4))
  //           .then(() => agentControls.getSpans())
  //           .then(spans => {
  //             if (spans.length > 0) {
  //               fail(`Unexpected spans (Google Cloud Run/suppressed: ${stringifyItems(spans)}`);
  //             }
  //           });
  //       }));
  // });
});

function verifyResponseAndMessage(response, subscriberControls) {
  expect(response).to.be.an('object');
  const messageId = response.messageId;
  expect(messageId).to.be.a('string');
  const receivedMessages = subscriberControls.getIpcMessages();
  expect(receivedMessages).to.be.an('array');
  expect(receivedMessages).to.have.lengthOf.at.least(1);
  const message = receivedMessages.filter(({ id }) => id === messageId)[0];
  expect(message).to.exist;
  expect(message.content).to.equal('test message');
  return messageId;
}
