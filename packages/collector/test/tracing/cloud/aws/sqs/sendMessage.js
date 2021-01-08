'use strict';

// const agentPort = process.env.INSTANA_AGENT_PORT;

require('../../../../../')();

const bodyParser = require('body-parser');
const express = require('express');
// const morgan = require('morgan');
// const request = require('request-promise');

// const asyncRoute = require('../../../../test_util/asyncExpressRoute');
const { sendMessage, sqs } = require('./sqsUtil');
const queueURL = process.env.AWS_SQS_QUEUE_URL;
const port = process.env.APP_PORT || 3216;
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
  const params = {
    MessageBody: 'message sent via callback function',
    QueueUrl: queueURL
  };

  sqs.sendMessage(params, (err, data) => {
    if (err) {
      res.status(501).send({
        status: 'ERROR',
        data: err
      });  
    } else {
      res.send({
        status: 'OK',
        data
      });  
    }
  });
});



app.post('/sendmessage', async (req, res) => {
  try {
    const data = await sendMessage(queueURL, 'test message from standalone nodejs app');
    res.send({
      status: 'OK',
      data: data
    });
  } catch (err) {
    log('Error sending message', err);
    res.status(501).send({
      status: 'ERROR',
      data: err
    });
  }
});

app.listen(port, () => {
  log(`Listening on port: ${port}`);
});

