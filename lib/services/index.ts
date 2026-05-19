// Export all services
export { authService } from './auth.service'
export { userService } from './user.service'
export { referralService } from './referral.service'
export { planService } from './plan.service'
export { rewardService } from './reward.service'
export { paymentService } from './payment.service'
export { walletService } from './wallet.service'
export { mockDataService } from './mock-data.service'
export {
  countAdminActiveIndicadoresFromSupabase,
  countAdminPendingPixWithdrawalsFromSupabase,
  countAdminReferralsFromSupabase,
  countComercialPipelineReferralsFromSupabase,
  countComercialScheduledReturnsFromSupabase,
  countUserUnreadNotificationsFromSupabase,
  fetchActivePlansForIndicador,
  loadAdminPlansCatalogFromSupabase,
  canConfirmFirstInvoice,
  debugFinancialIntegrityFromSupabase,
  ensureRewardForReferralFromSupabase,
  getAuthProfileBasicsFromSupabase,
  markFirstInvoiceAsPaidFromSupabase,
  getCurrentUserProfile,
  insertIndicadorReferral,
  loadAdminDashboardMetricsFromSupabase,
  loadAdminComerciaisFromSupabase,
  loadAdminIndicatorDetailFromSupabase,
  loadAdminIndicatorsFromSupabase,
  loadAdminReferralsFromSupabase,
  loadAdminReferralDetailFromSupabase,
  assignReferralToCommercialFromSupabase,
  updateAdminReferralStatusFromSupabase,
  loadComercialAssignedHistoryFromSupabase,
  loadComercialAvailabilityStatusFromSupabase,
  loadComercialLeadsFromSupabase,
  loadAdminNotificationsFromSupabase,
  loadIndicadorHomeFromSupabase,
  loadIndicadorPrimaryPixKeyFromSupabase,
  loadIndicadorReferralDetailFromSupabase,
  loadIndicadorReferralsListFromSupabase,
  loadUserNotificationsFromSupabase,
  markAllUserNotificationsAsRead,
  markUserNotificationAsRead,
  processExpiredLeadAssignments,
} from './supabase-data.service'
export type { SidebarBadgeCountsMock } from './mock-data.service'
export { getSidebarBadgeCountsFromMock } from './mock-data.service'
export type {
  AdminNotificationItem,
  AdminDashboardMetrics,
  ProcessExpiredLeadAssignmentsError,
  ProcessExpiredLeadAssignmentsResult,
  IndicadorHomeFromSupabase,
  IndicadorReferralDetailResult,
  InsertIndicadorReferralInput,
  AdminReferralDetailResult,
  AdminReferralMutationResult,
  EnsureRewardForReferralResult,
  FinancialIntegrityReport,
} from './supabase-data.service'
export type {
  NotificationItem,
  NotificationToastPayload,
} from '@/types/notification'
export type { CreateNotificationForProfileInput } from './notification.service'
export {
  loadUnreadNotificationsCount,
  loadRecentNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  createNotificationFromSupabase,
  createNotificationForProfileFromSupabase,
  notifyAdminsOfNewReferralFromSupabase,
  notifyIndicatorReferralProgressFromSupabase,
  notifyIndicatorRewardReleasedFromSupabase,
  createRealtimeToastPayload,
  NOTIFICATION_RECENT_LIMIT,
} from './notification.service'
export type { AuthProfileBasics } from '@/types/auth-profile'
