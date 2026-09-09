import express from 'express';

const app = express();
app.use(express.json());

app.post('/create-payment', (req, res) => {
  res.json({ id: 'test', url: 'https://checkout.furlpay.com/test' });
});

app.post('/webhook', (req, res) => {
  console.log('Webhook received', req.body);
  res.send('OK');
});

app.listen(3000, () => console.log('Listening on port 3000'));
