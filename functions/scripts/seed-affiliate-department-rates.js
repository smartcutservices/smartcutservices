'use strict';

// Initialise les taux du programme. Les taux sont modifiables ensuite depuis
// affiliate-admin.html; ils ne sont jamais calculés à partir du prix côté client.
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const FORCE = process.argv.includes('--force');
const taxonomy = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'product-taxonomy.json'), 'utf8'));
for (const extra of ['auto-parts-taxonomy.json', 'digital-download-taxonomy.json']) {
  const file = path.resolve(__dirname, '..', '..', extra);
  if (!fs.existsSync(file)) continue;
  const dep = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (dep?.id && !(taxonomy.departments || []).some(item => item.id === dep.id)) taxonomy.departments.push(dep);
}
if (!admin.apps.length) admin.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: process.env.GCLOUD_PROJECT || 'smartcutservices-9ce54' } : undefined);
const db = admin.firestore();
(async()=>{
  let created=0,updated=0;
  for(const dep of taxonomy.departments||[]){
    const id=String(dep.id||'').trim(); if(!id) continue;
    const ref=db.collection('affiliateDepartmentRates').doc(id); const snap=await ref.get();
    if(snap.exists&&!FORCE) continue;
    const data={id,departmentId:id,label:dep.label||id,affiliateCommissionRate:5,customerDiscountRate:2,active:true,updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedBy:'seed-affiliate-department-rates'};
    await ref.set(data,{merge:true}); snap.exists?updated++:created++;
  }
  console.log(`Affiliate rates ready. created=${created} updated=${updated}`);
})().catch(error=>{console.error(error);process.exit(1);});
