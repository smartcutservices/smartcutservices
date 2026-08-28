'use strict';

/**
 * SmartSolutionTek shared core — entry point.
 *
 * Exports a factory function that takes the reused internals from the existing
 * functions/index.js (verifyBearerUser, createMoncashRedirect, retrieveMoncashPayment,
 * the MonCash secret params, db, REGION) and returns every SmartSolutionTek Cloud
 * Function, each renamed with an `sst` prefix so it can never collide with an
 * existing export in functions/index.js.
 *
 * Called from functions/index.js with a single additive block at the very end of
 * the file (after __sstInternals is assigned):
 *
 *   Object.assign(exports, require('./smartsolutiontek')(module.exports.__sstInternals));
 *
 * Nothing above that point in functions/index.js is touched.
 */

function buildSmartSolutionTek(sstInternals) {
  if (!sstInternals || !sstInternals.db) {
    throw new Error('smartsolutiontek requires sstInternals (db, verifyBearerUser, createMoncashRedirect, ...).');
  }
  const { db, REGION: region } = sstInternals;

  const { registerOrganizationFunctions } = require('./organizations');
  const { registerCommissionFunctions } = require('./commissions');
  const { registerPageFunctions } = require('./pages');
  const { registerPaymentFunctions } = require('./payments');
  const { registerPayoutFunctions } = require('./payouts');
  const { registerFormFunctions } = require('./forms'); // also registers the "submission" resource resolver
  const { registerShopFunctions } = require('./shops'); // also registers the "shop_order" resource resolver
  const { registerCourseFunctions } = require('./courses'); // also registers the "enrollment" resource resolver
  const { registerServiceFunctions } = require('./services'); // also registers the "booking" resource resolver
  const { registerFoodFunctions } = require('./food'); // also registers the "food_order" resource resolver

  const organizationFns = registerOrganizationFunctions({ db, sstInternals, region });
  const commissionFns = registerCommissionFunctions({ db, sstInternals, region });
  const pageFns = registerPageFunctions({ db, sstInternals, region });
  // Resource resolvers must be registered before the payments module's functions are built.
  const formFns = registerFormFunctions({ db, sstInternals, region });
  const shopFns = registerShopFunctions({ db, sstInternals, region });
  const courseFns = registerCourseFunctions({ db, sstInternals, region });
  const serviceFns = registerServiceFunctions({ db, sstInternals, region });
  const foodFns = registerFoodFunctions({ db, sstInternals, region });
  const paymentFns = registerPaymentFunctions({ db, sstInternals, region });
  const payoutFns = registerPayoutFunctions({ db, sstInternals, region });

  const all = {
    ...organizationFns, ...commissionFns, ...pageFns,
    ...formFns, ...shopFns, ...courseFns, ...serviceFns, ...foodFns,
    ...paymentFns, ...payoutFns
  };

  const prefixed = {};
  for (const [name, fn] of Object.entries(all)) {
    prefixed[`sst${name.charAt(0).toUpperCase()}${name.slice(1)}`] = fn;
  }
  return prefixed;
}

module.exports = buildSmartSolutionTek;
