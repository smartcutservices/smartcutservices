export function createCourseApi(callSst, getAuthUser) {
  const invoke = (name, options = {}) => callSst(name, { auth: getAuthUser(), ...options });
  return Object.freeze({
    save: (body) => invoke('SaveCourse', { method: 'POST', body }),
    remove: (body) => invoke('DeleteCourse', { method: 'POST', body }),
    setStatus: (body) => invoke('SetCourseStatus', { method: 'POST', body }),
    checklist: (organizationId, courseId) => invoke('GetCoursePublishChecklist', { query: { organizationId, courseId } }),
    overview: (organizationId, courseId) => invoke('GetCourseOverview', { query: { organizationId, courseId } }),
    analytics: (organizationId, courseId) => invoke('GetCourseAnalytics', { query: { organizationId, courseId } }),
    auditLog: (organizationId, courseId) => invoke('GetCourseAuditLog', { query: { organizationId, courseId } }),
    assets: (organizationId, courseId) => invoke('ListCourseAssets', { query: { organizationId, courseId } }),
    saveAsset: (body) => invoke('SaveCourseAsset', { method: 'POST', body }),
    deleteAsset: (body) => invoke('DeleteCourseAsset', { method: 'POST', body }),
    enrollments: (organizationId, courseId) => invoke('ListEnrollments', { query: { organizationId, courseId } }),
    manageEnrollment: (body) => invoke('ManageEnrollment', { method: 'POST', body }),
    saveModule: (body) => invoke('SaveCourseModule', { method: 'POST', body }),
    deleteModule: (body) => invoke('DeleteCourseModule', { method: 'POST', body }),
    saveLesson: (body) => invoke('SaveLesson', { method: 'POST', body }),
    deleteLesson: (body) => invoke('DeleteLesson', { method: 'POST', body }),
    publishPage: (body) => invoke('PublishPage', { method: 'POST', body }),
    progress: (courseId, lessonId, completed) => invoke('UpdateLessonProgress', { method: 'POST', body: { courseId, lessonId, completed } })
  });
}
