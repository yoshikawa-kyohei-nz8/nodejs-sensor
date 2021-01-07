const { receiveMessages } = require('./sqsUtil');

const queueURL = process.env.AWS_SQS_QUEUE_URL;

(async () => {
  try {
    const data = await receiveMessages(queueURL);
    console.log('Messages received!', data);
  } catch(err) {
    console.log('Error receiving messages', err);
  }
})();
