'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeVehicle, fitmentMatchesVehicle, normalizeOffer, normalizePart, normalizePartNumber, selectRelevantAutoVendors, reserveStockValue } = require('./core');

test('normalizes a supported vehicle without trusting arbitrary fields', () => {
  assert.deepEqual(normalizeVehicle({ type: 'truck', make: '  Isuzu ', model: 'NPR', year: '2018', ownerUid: 'bad' }), {
    type: 'truck', make: 'Isuzu', model: 'NPR', year: 2018, engine: '', trim: ''
  });
});

test('matches a vehicle only inside the declared structured fitment', () => {
  const fitment = { type: 'car', make: 'Toyota', model: 'Corolla', yearFrom: 2014, yearTo: 2019, engines: ['1.8L'] };
  assert.equal(fitmentMatchesVehicle(fitment, { type: 'car', make: 'Toyota', model: 'Corolla', year: 2017, engine: '1.8L' }), true);
  assert.equal(fitmentMatchesVehicle(fitment, { type: 'car', make: 'Toyota', model: 'Corolla', year: 2021, engine: '1.8L' }), false);
  assert.equal(fitmentMatchesVehicle(fitment, { type: 'car', make: 'Honda', model: 'Civic', year: 2017, engine: '1.8L' }), false);
});

test('refuses invalid vendor offer amounts and stock', () => {
  assert.throws(() => normalizeOffer({ canonicalPartId: 'p1', price: 0, stock: -1 }), /invalid-offer/);
  assert.equal(normalizeOffer({ canonicalPartId: 'p1', price: '1500', stock: '3', condition: 'used' }).price, 1500);
  assert.equal(normalizeOffer({ canonicalPartId: 'p1', price: '1500', stock: '3', status: 'active' }).status, 'active');
});

test('requires canonical part identity fields', () => {
  assert.throws(() => normalizePart({ title: 'Filtre' }), /invalid-part/);
  assert.equal(normalizePart({ title: 'Filtre à huile', partNumber: 'abc-1', categoryId: 'filters' }).partNumber, 'ABC-1');
});

test('a second competing reservation cannot oversell the last unit', () => {
  let stock = 1;
  stock = reserveStockValue(stock, 1);
  assert.equal(stock, 0);
  assert.throws(() => reserveStockValue(stock, 1), /insufficient-stock/);
});

test('part number search ignores separators and case', () => {
  assert.equal(normalizePartNumber(' 90915-yzz d1 '), '90915YZZD1');
  assert.equal(normalizePartNumber('90915YZZD1'), '90915YZZD1');
});

test('a request is distributed only to approved relevant vendors', () => {
  const applications = [
    { id:'v1', status:'approved', specialties:['Freinage'] },
    { id:'v2', status:'approved', specialties:['Moteur'] },
    { id:'v3', status:'pending', specialties:['Freinage'] }
  ];
  assert.deepEqual(selectRelevantAutoVendors(applications, 'Freinage automobile').map((item) => item.id), ['v1']);
});
