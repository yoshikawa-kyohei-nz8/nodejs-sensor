const AWS = require('aws-sdk');

AWS.config.update({region: 'us-east-2'});

const sqs = new AWS.SQS({apiVersion: '2012-11-05'});
const queueURL = process.env.AWS_SQS_QUEUE_URL;

const params = {
  AttributeNames: ['SentTimestamp'],
  MaxNumberOfMessages: 1,
  MessageAttributeNames: ['All'],
  QueueUrl: queueURL
};

sqs.receiveMessage(params, (err, data) => {
  if (err) {
    console.log('Receive Error', err);
  } else {
    // Make sure we have a message
    if (data.Messages && data.Messages.length > 0) {
      console.log(`messages: ${data.Messages.length}`);
      console.log('data', data);

      const visibilityParams = {
        QueueUrl: queueURL,
        ReceiptHandle: data.Messages[0].ReceiptHandle,
        VisibilityTimeout: 20
      }

      sqs.changeMessageVisibility(visibilityParams, (err, data) => {
        if (err) {
          console.log('Timeout change error', err);
        } else {
          console.log('Timeout Changed', data);
        }
      });
    } else {
      console.log('No messages to change');
    }
  }
});
