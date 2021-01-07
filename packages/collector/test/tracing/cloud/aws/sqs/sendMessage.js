const { sendMessage } = require('./sqsUtil');

const queueURL = process.env.AWS_SQS_QUEUE_URL;

(async () => {
  try {
    const data = await sendMessage(queueURL, 'test message from standalone nodejs app');
    console.log('Message sent!', data);
  } catch(err) {
    console.log('Error sending message', err)
  }
})();
