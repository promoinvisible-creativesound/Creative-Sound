const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  });
}

// The API creates this table on first use too, so running this is optional.
const { ensureTable } = require('../api/_lib/packs');

ensureTable()
  .then(() => console.log('pack_purchases table ready.'))
  .catch((err) => {
    console.error('migration failed:', err);
    process.exit(1);
  });
