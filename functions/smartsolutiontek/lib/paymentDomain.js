'use strict';

function validatePaymentResource(resource, request, resolver = {}) {
  if (!resource || resource.organizationId !== request.organizationId) {
    const error = new Error('La ressource n’appartient pas a cette organisation.');
    error.status = 403;
    error.code = 'resource-organization-mismatch';
    throw error;
  }
  if (resolver.applicationId && resolver.applicationId !== request.applicationId) {
    const error = new Error('Application incoherente pour cette ressource.');
    error.status = 400;
    error.code = 'resource-application-mismatch';
    throw error;
  }
  const amount = Number(resolver.computeAmount ? resolver.computeAmount(resource) : NaN);
  if (!Number.isFinite(amount) || amount <= 0) {
    const error = new Error('Aucun montant a payer pour cette ressource.');
    error.status = 400;
    error.code = 'nothing-to-pay';
    throw error;
  }
  return { amount };
}

module.exports = { validatePaymentResource };
