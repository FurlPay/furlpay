// Example express middleware for webhook verification
// import express from 'express';
// import { constructEvent } from '@furlpay/js';

// const app = express();
// const endpointSecret = "whsec_...";

// app.post('/webhook', express.raw({type: 'application/json'}), (request, response) => {
//   const sig = request.headers['furlpay-signature'] as string;
//   
//   let event;
//   try {
//     event = constructEvent(request.body, sig, endpointSecret);
//   } catch (err) {
//     response.status(400).send(`Webhook Error`);
//     return;
//   }
//
//   switch (event.type) {
//     case 'payment.completed':
//       console.log('Payment was completed!', event.data);
//       break;
//     default:
//       console.log(`Unhandled event type ${event.type}`);
//   }
//
//   response.send();
// });
