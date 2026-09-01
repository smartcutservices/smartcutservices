import { bootClinicalProviderDashboard } from './health-clinical-provider-dashboard.js?v=20260831-5';

bootClinicalProviderDashboard({
  providerType: 'laboratory',
  roleLabel: 'Laboratoire',
  statusField: 'labStatus',
  profileField: 'labProfile',
  examCollection: 'healthLabExams',
  resultCollection: 'healthLabResults',
  centerIdField: 'laboratoryId',
  catalogUrl: './health-exam-catalog.json',
  saveExamFn: 'healthSaveLabExam',
  uploadResultFn: 'healthUploadLabResult',
  storagePrefix: 'health-lab-results'
});
