const jwt = require('jsonwebtoken');
const fs = require('fs');

const TEAM_ID = ' 9G67H3M2C7';
const CLIENT_ID = 'com.chewers.franchisev2.signin';
const KEY_ID = '9SB59A278W';
const KEY_PATH = 'C:\\Users\\Joe\\Downloads\\AuthKey_9SB59A278W.p8';

const privateKey = fs.readFileSync(KEY_PATH);
const now = Math.floor(Date.now() / 1000);

const token = jwt.sign(
  {
    iss: TEAM_ID,
    iat: now,
    exp: now + 60 * 60 * 24 * 180, // 180 days (max 6 months)
    aud: 'https://appleid.apple.com',
    sub: CLIENT_ID,
  },
  privateKey,
  { algorithm: 'ES256', header: { alg: 'ES256', kid: KEY_ID } }
);

console.log(token);
