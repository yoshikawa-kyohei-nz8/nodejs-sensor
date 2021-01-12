'use strict';

// const agentPort = process.env.INSTANA_AGENT_PORT;

require('../../../../../')();

const bodyParser = require('body-parser');
const express = require('express');
// const morgan = require('morgan');
// const request = require('request-promise');

// const asyncRoute = require('../../../../test_util/asyncExpressRoute');
const { sqs } = require('./sqsUtil');
const queueURL = process.env.AWS_SQS_QUEUE_URL;
const port = process.env.APP_PORT || 3215;
const logPrefix = `AWS SQS Message Sender (${process.pid}):\t`;

const app = express();

app.use(bodyParser.json());

function log() {
  /* eslint-disable no-console */
  const args = Array.prototype.slice.call(arguments);
  args[0] = `${logPrefix}${args[0]}`;
  console.log.apply(console, args);
}

app.get('/', (_req, res) => {
  res.send('Ok');
});

app.post('/send-callback', (_req, res) => {
  const sendParams = {
    MessageBody: 'message sent via callback function',
    QueueUrl: queueURL
  };
  
  sqs.sendMessage(sendParams, (err, data) => {
    if (err) {
      console.log(err);
      res.status(501).send({
        status: 'ERROR',
        data: String(err)
      });
    } else {
      res.send({
        status: 'OK',
        data
      });
    }
  });
});

app.post('/send-promise', async (_req, res) => {
  const sendParams = {
    MessageBody: 'message sent via promise',
    QueueUrl: queueURL
  };

  try {
    const data = await sqs.sendMessage(sendParams).promise();
    res.send({
      status: 'OK',
      data
    });
  } catch(err) {
    console.log(err);
    res.status(501).send({
      status: 'ERROR',
      data: String(err)
    });
  }
});


app.post('/send-promise2', async (_req, res) => {
  const sendParams = {
    MessageBody: 'message sent via promise 2',
    QueueUrl: queueURL
  };

  try {
    const awsRequest = sqs.sendMessage(sendParams);
    const data = await awsRequest.promise();
    res.send({
      status: 'OK',
      data
    });
  } catch(err) {
    console.log(err);
    res.status(501).send({
      status: 'ERROR',
      data: String(err)
    });
  }
});


app.listen(port, () => {
  log(`Listening on port: ${port}`);
});
