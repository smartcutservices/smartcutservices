import { bootClinicalProviderDashboard } from './health-clinical-provider-dashboard.js?v=20260901-1';

bootClinicalProviderDashboard({
  providerType: 'imaging',
  roleLabel: 'Centre d’imagerie',
  statusField: 'imagingStatus',
  profileField: 'imagingProfile',
  examCollection: 'healthImagingExams',
  centerIdField: 'imagingCenterId',
  catalogUrl: './health-imaging-catalog.json',
  saveExamFn: 'healthSaveImagingExam'
});
