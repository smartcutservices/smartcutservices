import { bootClinicalProviderDashboard } from './health-clinical-provider-dashboard.js?v=20260831-5';

bootClinicalProviderDashboard({
  providerType: 'imaging',
  roleLabel: 'Centre d’imagerie',
  statusField: 'imagingStatus',
  profileField: 'imagingProfile',
  examCollection: 'healthImagingExams',
  resultCollection: 'healthImagingResults',
  centerIdField: 'imagingCenterId',
  catalogUrl: './health-imaging-catalog.json',
  saveExamFn: 'healthSaveImagingExam',
  uploadResultFn: 'healthUploadImagingResult',
  storagePrefix: 'health-imaging-results'
});
