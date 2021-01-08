'use strict';

require('../../../../../')();

const bodyParser = require('body-parser');
const express = require('express');
// const morgan = require('morgan');
// const request = require('request-promise');
// const asyncRoute = require('../../../../test_util/asyncExpressRoute');
const { sqs } = require('./sqsUtil');

const queueURL = process.env.AWS_SQS_QUEUE_URL;

// const agentPort = process.env.INSTANA_AGENT_PORT;

const port = process.env.APP_PORT || 3216;
const logPrefix = `AWS SQS Message Receiver (${process.pid}):\t`;

const app = express();

app.use(bodyParser.json());

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
  WaitTimeSeconds: 0
};

function log() {
  /* eslint-disable no-console */
  const args = Array.prototype.slice.call(arguments);
  args[0] = `${logPrefix}${args[0]}`;
  console.log.apply(console, args);
}

app.get('/', (_req, res) => {
  res.send('Ok');
});

app.get('/receive-callback', (_req, res) => {

  sqs.receiveMessage(receiveParams, (err, messagesData) => {
    if (err) {
      return res.status(501).send({
        status: 'ERROR',
        data: err
      });
    } else if (messagesData.Messages) {
      const deleteParams = {
        QueueUrl: queueURL,
        ReceiptHandle: messagesData.Messages[0].ReceiptHandle
      };

      sqs.deleteMessage(deleteParams, (err, _data) => {
        if (err) {
          return res.status(501).send({
            status: 'ERROR',
            data: String(err)
          });
        }
      });
    }

    res.send({
      status: 'OK',
      data: messagesData
    });
  });
});

app.get('/receive-promise', async (_req, res) => {

  try {
    const data = await sqs.receiveMessage(receiveParams).promise();

    if (data.Messages) {
      const deleteParams = {
        QueueUrl: queueURL,
        ReceiptHandle: data.Messages[0].ReceiptHandle
      };

      await sqs.deleteMessage(deleteParams).promise();
    }

    res.send({
      status: 'OK',
      data
    });

  } catch(err) {
    console.log('vem aki', err);
    return res.status(501).send({
      status: 'ERROR',
      data: String(err)
    });
  }
});

app.listen(port, () => {
  log(`Listening on port: ${port}`);
});
