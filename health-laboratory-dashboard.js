import { bootClinicalProviderDashboard } from './health-clinical-provider-dashboard.js?v=20260901-1';

bootClinicalProviderDashboard({
  providerType: 'laboratory',
  roleLabel: 'Laboratoire',
  statusField: 'labStatus',
  profileField: 'labProfile',
  examCollection: 'healthLabExams',
  centerIdField: 'laboratoryId',
  catalogUrl: './health-exam-catalog.json',
  saveExamFn: 'healthSaveLabExam'
});
