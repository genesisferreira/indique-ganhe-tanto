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
  fetchActivePlansForIndicador,
  getCurrentUserProfile,
  insertIndicadorReferral,
  loadIndicadorHomeFromSupabase,
  loadIndicadorReferralDetailFromSupabase,
  loadIndicadorReferralsListFromSupabase,
} from './supabase-data.service'
export type {
  IndicadorHomeFromSupabase,
  IndicadorReferralDetailResult,
  InsertIndicadorReferralInput,
} from './supabase-data.service'
