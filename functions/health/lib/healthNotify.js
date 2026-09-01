'use strict';

/**
 * Shared by every functions/health/*.js module that needs to fan out an in-app
 * notification (healthNotifications — read/unread inbox, see firestore.rules).
 * Never throws: a notification failing to write must never take down the operation
 * that triggered it. Never put medical content beyond what's already safe to show in
 * a short title/body — same discipline as healthAuditLogs.
 */
async function notifyUser(db, userId, type, { title, body, url, context = {} } = {}) {
  if (!userId) return;
  try {
    await db.collection('healthNotifications').add({
      userId, type,
      title: title || 'Notification',
      body: body || '',
      url: url || './health-espace.html',
      context, read: false, readAt: null,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    // eslint-disable-next-line global-require
    require('firebase-functions').logger.error('healthNotifications write failed', { type, message: error?.message });
  }
}

module.exports = { notifyUser };
