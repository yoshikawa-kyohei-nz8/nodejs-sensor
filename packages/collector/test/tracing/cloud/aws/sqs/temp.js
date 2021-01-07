const AWS = require('aws-sdk');

AWS.config.update({region: 'us-east-2'});

const sqs = new AWS.SQS({apiVersion: '2012-11-05'});

const queueURL = 'https://sqs.us-east-2.amazonaws.com/410797082306/willian-queue';

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
    if (data.Messages !== null && data.Messages.length > 0) {
      console.log('data:', data);
      const visibilityParams = {
        QueueUrl: queueURL,
        ReceiptHandle: data.Messages[0].ReceiptHandle,
        VisibilityTimeout: 20
      }

      sqs.changeMessageVisibility(visibilityParams, (err, data) => {
        if (err) {
          console.log('Delete Error', err);
        } else {
          console.log('Timeout Changed', data);
        }
      });
    } else {
      console.log('No messages to change');
    }
  }
});
