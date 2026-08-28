'use strict';

const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { setDoc, doc } = require('firebase/firestore');
const { ref, uploadBytes, getBytes } = require('firebase/storage');

const bytes = new Uint8Array([1, 2, 3]);
let env;

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'smartcutservices-9ce54',
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'), host:'127.0.0.1', port:8080 },
    storage: { rules: fs.readFileSync(path.resolve(__dirname, '../../storage.rules'), 'utf8'), host:'127.0.0.1', port:9199 }
  });
});
test.after(async () => env?.cleanup());

test('claim evidence is readable only by its customer and assigned vendor', async () => {
  await env.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'autoClaims', 'claim12345678'), { customerUid:'alice', vendorId:'vendor1', status:'submitted' }));
  const objectPath = 'auto-parts/claims/alice__claim12345678/proof.jpg';
  await assertSucceeds(uploadBytes(ref(env.authenticatedContext('alice').storage(), objectPath), bytes, { contentType:'image/jpeg' })).catch((error)=>{throw new Error(`owner-upload: ${error.message}`);});
  await assertSucceeds(getBytes(ref(env.authenticatedContext('alice').storage(), objectPath))).catch((error)=>{throw new Error(`owner-read: ${error.message}`);});
  await assertSucceeds(getBytes(ref(env.authenticatedContext('vendor1').storage(), objectPath))).catch((error)=>{throw new Error(`vendor-read: ${error.message}`);});
  await assertFails(getBytes(ref(env.authenticatedContext('vendor2').storage(), objectPath)));
  await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), objectPath)));
});

test('another customer cannot upload evidence into a claim path', async () => {
  await assertFails(uploadBytes(ref(env.authenticatedContext('bob').storage(), 'auto-parts/claims/alice__claim12345678/forged.jpg'), bytes, { contentType:'image/jpeg' }));
  await assertFails(uploadBytes(ref(env.authenticatedContext('alice').storage(), 'auto-parts/claims/alice__claim12345678/script.exe'), bytes, { contentType:'application/x-msdownload' }));
});
