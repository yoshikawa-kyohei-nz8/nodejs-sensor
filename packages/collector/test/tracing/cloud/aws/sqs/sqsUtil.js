const AWS = require('aws-sdk');

AWS.config.update({ region: 'us-east-2' });

const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
// const queueURL = process.env.AWS_SQS_QUEUE_URL;

/**
 * @param {string} queueURL The AWS SQS Queue URL
 * @param {string} messageBody The message body to be sent in to the queue
 * @returns {Promise} Data or error object when errors occur
 */
exports.sendMessage = function sendMessage(queueURL, messageBody) {
  const params = {
    MessageBody: messageBody,
    QueueUrl: queueURL
  };

  return new Promise((resolve, reject) => {
    sqs.sendMessage(params, (err, data) => {
      if (err) {
        return reject(err);
      }

      return resolve(data.MessageId);
    });
  });
};

/**
 * @param {string} queueURL The AWS SQS Queue URL
 * @returns {Promise} Data or error object when errors occur
 */
exports.receiveMessages = function receiveMessages(queueURL) {
  const params = {
    AttributeNames: [
      'SentTimestamp'
    ],
    MaxNumberOfMessages: 10,
    MessageAttributeNames: [
      'All'
    ],
    QueueUrl: queueURL,
    VisibilityTimeout: 20,
    WaitTimeSeconds: 0
  };

  return new Promise((resolve, reject) => {
    sqs.receiveMessage(params, (err, messagesData) => {
      if (err) {
        return reject(err);
      } else if (messagesData.Messages) {
        const deleteParams = {
          QueueUrl: queueURL,
          ReceiptHandle: messagesData.Messages[0].ReceiptHandle
        };
        sqs.deleteMessage(deleteParams, (err, _data) => {
          if (err) {
            return reject(err);
          }
        });
      }

      return resolve(messagesData);
    });
  });
};
