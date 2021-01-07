const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
const queueURL = process.env.AWS_SQS_QUEUE_URL;

const params = {
  // Remove DelaySeconds parameter and value for FIFO queues
  DelaySeconds: 10,
  MessageAttributes: {
    Title: {
      DataType: 'String',
      StringValue: 'The Whistler'
    },
    Author: {
      DataType: 'String',
      StringValue: 'John Grisham'
    },
    WeeksOn: {
      DataType: 'Number',
      StringValue: '6'
    }
  },
  MessageBody: 'Information about current NY Times fiction bestseller for week of 12/11/2016.',
  // MessageDeduplicationId: 'TheWhistler',  // Required for FIFO queues
  // MessageGroupId: 'Group1',  // Required for FIFO queues
  QueueUrl: queueURL
};

sqs.sendMessage(params, (err, data) => {
  if (err) {
    console.log('Error', err);
  } else {
    console.log('Success', data.MessageId);
  }
});
