'use strict';

require('../../../../../')();

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
  WaitTimeSeconds: 10
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

async function receivePromise() {
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
  }
}

function receiveCallback(cb) {
  sqs.receiveMessage(receiveParams, (err, messagesData) => {
    if (err) {
      log(err);
      cb();
    } else if (messagesData.Messages) {
      const deleteParams = {
        QueueUrl: queueURL,
        ReceiptHandle: messagesData.Messages[0].ReceiptHandle
      };

      sqs.deleteMessage(deleteParams, (err, _data) => {
        if (err) {
          log(err);
          cb();
        } else {
          log(prettiefy({status: 'OK', data: messagesData}));
          cb();
        }
      });
    } else {
      log('No messages found. Restart the polling');
      cb();
    }
  });
}

const validTypes = ['promise', 'callback'];

async function pollForMessages() {
  const receivedType = process.argv[2];

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

pollForMessages();
