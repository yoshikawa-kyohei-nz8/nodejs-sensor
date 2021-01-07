const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
const queueURL = process.env.AWS_SQS_QUEUE_URL;

const params = {
  Attributes: {
    'RedrivePolicy': '{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-2:410797082306:node_sensor_dead_letter_queue\",\"maxReceiveCount\":\"5\"}',
  },
  QueueUrl: queueURL
};

sqs.setQueueAttributes(params, (err, data) => {
  if (err) {
    console.log('Error', err);
  } else {
    console.log('Success', data);
  }
});
