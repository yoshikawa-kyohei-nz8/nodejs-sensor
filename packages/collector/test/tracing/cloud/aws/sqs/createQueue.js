const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });

const params = {
  QueueName: 'node_sensor_queue',
  Attributes: {
    // ReceiveMessageWaitTimeSeconds: '13',
    DelaySeconds: '60',
    MessageRetentionPeriod: '86400'
  }
};

sqs.createQueue(params, (err, data) => {
  if (err) {
    console.log('Error', err);
  } else {
    console.log('Success', data);
  }
});
