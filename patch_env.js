const fs = require('fs');
const path = 'apps/web/src/lib/env.ts';
let code = fs.readFileSync(path, 'utf8');
code = code.replace(
  'v("FURLPAY_ENV"),',
  'v("FURLPAY_ENV"),\n      v("BLOCKAID_API_KEY"),'
);
fs.writeFileSync(path, code);
