'use strict';

const instana = require('../../../../../')();
const express = require('express');
const port = 3125;
const agentPort = process.env.INSTANA_AGENT_PORT;
const request = require('request-promise');

const app = express();

const { sqs } = require('./sqsUtil');
const queueURL = process.env.AWS_SQS_QUEUE_URL;
const logPrefix = `AWS SQS Message Receiver (${process.pid}):\t`;

const receiveParams = {
  AttributeNames: [
    'SentTimestamp'
  ],
  MaxNumberOfMessages: 1,
  MessageAttributeNames: [
    'All'
  ],
  QueueUrl: queueURL,
  VisibilityTimeout: 20,
  WaitTimeSeconds: 5
};

function log() {
  /* eslint-disable no-console */
  const args = Array.prototype.slice.call(arguments);
  args[0] = `${logPrefix}${args[0]}`;
  console.log.apply(console, args);
}

function prettiefy(jsonObject) {
  return JSON.stringify(jsonObject, null, '  ');
}

let isQueueing = false;

app.get('/', (req, res) => {
  if (isQueueing) {
    res.send('OK');
  } else {
    res.status(500).send('Not ready yet.');
  }
});

app.listen(port, () => {
  `+++++++++++++++++++++ receiver server started at port ${port}`
});

async function receivePromise() {
  isQueueing = true;
  try {
    const data = await sqs.receiveMessage(receiveParams).promise();

    if (data.Messages) {
      const deleteParams = {
        QueueUrl: queueURL,
        ReceiptHandle: data.Messages[0].ReceiptHandle
      };

      await sqs.deleteMessage(deleteParams).promise();
    }

    log(prettiefy({status: 'OK', data}));

  } catch(err) {
    log(err);
    return log(prettiefy({status: 'ERROR', data: String(err)}));
  } finally {
    isQueueing = false;
  }
}

function receiveCallback(cb) {

  isQueueing = true;
  sqs.receiveMessage(receiveParams, (err, messagesData) => {
    const span = instana.currentSpan();
    span.disableAutoEnd();

    if (err) {
      log(err);
      isQueueing = false;
      cb();
      span.end(1);
    } else if (messagesData.Messages) {
      log(prettiefy({status: 'OK', data: messagesData}));

      console.log('+++++++++++++++++++++ before setTimeout');
      // THE TIMEOUT CAN RUN BEFORE DELETE MESSAGE HAPPENS
      setTimeout(() => {
        console.log(`**************** calling server http://127.0.0.1:${agentPort}`);
        request(`http://127.0.0.1:${agentPort}`)
          .then(() => {
            log('The follow up request after receiving a message has happened.');
            span.end();
          })
          .catch(err => {
            log('The follow up request after receiving a message has failed.', err);
            span.end(1);
          });
      }, 100);

      const deleteParams = {
        QueueUrl: queueURL,
        ReceiptHandle: messagesData.Messages[0].ReceiptHandle
      };

      sqs.deleteMessage(deleteParams, (err, _data) => {
        if (err) {
          log(err);
          isQueueing = false;
          cb();
        } else {
          log(`Messages deleted with params ${deleteParams}`);
          isQueueing = false;
          cb();
        }
      });
    } else {
      isQueueing = false;
      // log('No messages found. Restart the polling');
      cb();
    }
  });
}

const validTypes = ['promise', 'callback'];

async function pollForMessages() {
  const receivedType = process.env.RECEIVE_METHOD || 'callback';

  if (!receivedType || !validTypes.includes(receivedType.toLowerCase()) ) {
    log('*************************************************************');
    log(`Provide one of the valid options: ${validTypes.join(', ')}`);
    log('*************************************************************');
    return;
  }

  log(`\n********** Polling type "${receivedType}" ************\n`);

  if (receivedType === 'promise') {
    await receivePromise();
    pollForMessages();
  } else if (receivedType === 'callback') {
    receiveCallback(() => {
      pollForMessages();
    });
  } else {
    log(`End with command ${receivedType}`);
  }
}

setTimeout(pollForMessages, 2000);
// pollForMessages();
