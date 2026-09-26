const fs = require('fs');
const path = 'app/_layout.tsx';
let code = fs.readFileSync(path, 'utf8');
code = code.replace(
  'import { OfflineBanner } from "@/components/OfflineBanner";',
  'import { OfflineBanner } from "@/components/OfflineBanner";\nimport { startTamperDetection } from "@/lib/security/tamperDetection";'
);
code = code.replace(
  'void loadFlags();',
  'void loadFlags();\n    void startTamperDetection();'
);
fs.writeFileSync(path, code);
console.log("Updated!");
