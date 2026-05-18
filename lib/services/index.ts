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
  getAuthProfileBasicsFromSupabase,
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
  markNotificationAsRead,
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
} from './supabase-data.service'
export type { NotificationItem } from '@/types/notification'
export type { AuthProfileBasics } from '@/types/auth-profile'
