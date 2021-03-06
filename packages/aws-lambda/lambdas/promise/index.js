'use strict';

// eslint-disable-next-line no-unused-vars
exports.handler = (event, context) => {
  console.log('Starting up');
  setTimeout(() => {
    console.log('Still running');
  }, 1000);

  return new Promise(resolve => {
    resolve({
      message: 'Stan says hi!'
    });
  });
};
