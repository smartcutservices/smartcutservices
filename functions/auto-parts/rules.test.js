'use strict';

const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { setDoc, doc, getDoc, updateDoc } = require('firebase/firestore');

let env;
test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'smartcut-auto-parts-rules-test',
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'), host:'127.0.0.1', port:8080 }
  });
});
test.after(async () => { if (env) await env.cleanup(); });

async function seed(callback) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => callback(context.firestore()));
}

test('only the owner can read a vehicle saved in My Garage', async () => {
  await seed((db) => setDoc(doc(db,'clients','alice','garageVehicles','rav4'),{ownerUid:'alice',make:'Toyota'}));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('alice').firestore(),'clients','alice','garageVehicles','rav4')));
  await assertFails(getDoc(doc(env.authenticatedContext('bob').firestore(),'clients','alice','garageVehicles','rav4')));
});

test('garage vehicles cannot be written directly by their owner', async () => {
  await seed((db) => setDoc(doc(db,'clients','alice','garageVehicles','rav4'),{ownerUid:'alice',make:'Toyota'}));
  await assertFails(updateDoc(doc(env.authenticatedContext('alice').firestore(),'clients','alice','garageVehicles','rav4'),{make:'Honda'}));
});

test('only published canonical parts are public', async () => {
  await seed(async(db)=>{
    await setDoc(doc(db,'autoParts','published'),{publicationStatus:'published',title:'Filtre'});
    await setDoc(doc(db,'autoParts','draft'),{publicationStatus:'draft',title:'Secret'});
  });
  const publicDb=env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(publicDb,'autoParts','published')));
  await assertFails(getDoc(doc(publicDb,'autoParts','draft')));
});

test('a part request is isolated to its customer', async () => {
  await seed((db)=>setDoc(doc(db,'autoPartRequests','r1'),{customerUid:'alice',status:'open'}));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('alice').firestore(),'autoPartRequests','r1')));
  await assertFails(getDoc(doc(env.authenticatedContext('bob').firestore(),'autoPartRequests','r1')));
});

test('a quote is visible only to its customer and responding vendor', async () => {
  await seed((db)=>setDoc(doc(db,'autoPartQuotes','q1'),{customerUid:'alice',vendorId:'vendor1',status:'submitted'}));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('alice').firestore(),'autoPartQuotes','q1')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('vendor1').firestore(),'autoPartQuotes','q1')));
  await assertFails(getDoc(doc(env.authenticatedContext('vendor2').firestore(),'autoPartQuotes','q1')));
});

test('booking data is isolated to customer and garage', async () => {
  await seed((db)=>setDoc(doc(db,'autoGarageBookings','b1'),{customerUid:'alice',garageId:'garage1',status:'held'}));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('alice').firestore(),'autoGarageBookings','b1')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('garage1').firestore(),'autoGarageBookings','b1')));
  await assertFails(getDoc(doc(env.authenticatedContext('bob').firestore(),'autoGarageBookings','b1')));
});

test('no client can directly change a booking status', async () => {
  await seed((db)=>setDoc(doc(db,'autoGarageBookings','b1'),{customerUid:'alice',garageId:'garage1',status:'held'}));
  await assertFails(updateDoc(doc(env.authenticatedContext('alice').firestore(),'autoGarageBookings','b1'),{status:'confirmed'}));
});

test('a claim is visible only to its customer and assigned vendor', async () => {
  await seed((db)=>setDoc(doc(db,'autoClaims','c1'),{customerUid:'alice',vendorId:'vendor1',status:'submitted'}));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('alice').firestore(),'autoClaims','c1')));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('vendor1').firestore(),'autoClaims','c1')));
  await assertFails(getDoc(doc(env.authenticatedContext('vendor2').firestore(),'autoClaims','c1')));
});

test('claim status cannot be changed directly by a customer or vendor', async () => {
  await seed((db)=>setDoc(doc(db,'autoClaims','c1'),{customerUid:'alice',vendorId:'vendor1',status:'submitted'}));
  await assertFails(updateDoc(doc(env.authenticatedContext('alice').firestore(),'autoClaims','c1'),{status:'approved'}));
  await assertFails(updateDoc(doc(env.authenticatedContext('vendor1').firestore(),'autoClaims','c1'),{status:'approved'}));
});

test('a catalog request is isolated to the requesting vendor', async () => {
  await seed((db)=>setDoc(doc(db,'autoPartCatalogRequests','catalog1'),{vendorId:'vendor1',status:'pending',partNumber:'ABC-123'}));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('vendor1').firestore(),'autoPartCatalogRequests','catalog1')));
  await assertFails(getDoc(doc(env.authenticatedContext('vendor2').firestore(),'autoPartCatalogRequests','catalog1')));
  await assertFails(updateDoc(doc(env.authenticatedContext('vendor1').firestore(),'autoPartCatalogRequests','catalog1'),{status:'approved'}));
});
