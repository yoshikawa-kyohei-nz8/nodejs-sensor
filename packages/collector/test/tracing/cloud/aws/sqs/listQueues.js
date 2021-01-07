const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });

const params = {};

sqs.listQueues(params, (err, data) => {
  if (err) {
    console.log('Error', err);
  } else {
    console.log('Success', data);
  }
});
