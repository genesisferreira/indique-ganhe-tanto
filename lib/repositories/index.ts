import { mockAuthRepository } from "./mock/mock-auth.repository"
import { mockNotificationRepository } from "./mock/mock-notification.repository"
import { mockPaymentRepository } from "./mock/mock-payment.repository"
import { mockPlanRepository } from "./mock/mock-plan.repository"
import { mockReferralRepository } from "./mock/mock-referral.repository"
import { mockRewardRepository } from "./mock/mock-reward.repository"
import { mockUserRepository } from "./mock/mock-user.repository"
import { mockWalletRepository } from "./mock/mock-wallet.repository"
import { supabaseAuthRepository } from "./supabase/supabase-auth.repository"
import { supabaseNotificationRepository } from "./supabase/supabase-notification.repository"
import { supabasePaymentRepository } from "./supabase/supabase-payment.repository"
import { supabasePlanRepository } from "./supabase/supabase-plan.repository"
import { supabaseReferralRepository } from "./supabase/supabase-referral.repository"
import { supabaseRewardRepository } from "./supabase/supabase-reward.repository"
import { supabaseUserRepository } from "./supabase/supabase-user.repository"
import { supabaseWalletRepository } from "./supabase/supabase-wallet.repository"

type RepositoryProvider = "mock" | "supabase"
const repositoryProvider = (process.env.DATA_PROVIDER as RepositoryProvider | undefined) ?? "mock"

const providers = {
  mock: {
    authRepository: mockAuthRepository,
    userRepository: mockUserRepository,
    referralRepository: mockReferralRepository,
    planRepository: mockPlanRepository,
    paymentRepository: mockPaymentRepository,
    rewardRepository: mockRewardRepository,
    walletRepository: mockWalletRepository,
    notificationRepository: mockNotificationRepository,
  },
  supabase: {
    authRepository: supabaseAuthRepository,
    userRepository: supabaseUserRepository,
    referralRepository: supabaseReferralRepository,
    planRepository: supabasePlanRepository,
    paymentRepository: supabasePaymentRepository,
    rewardRepository: supabaseRewardRepository,
    walletRepository: supabaseWalletRepository,
    notificationRepository: supabaseNotificationRepository,
  },
} as const

export const authRepository = providers[repositoryProvider].authRepository
export const userRepository = providers[repositoryProvider].userRepository
export const referralRepository = providers[repositoryProvider].referralRepository
export const planRepository = providers[repositoryProvider].planRepository
export const paymentRepository = providers[repositoryProvider].paymentRepository
export const rewardRepository = providers[repositoryProvider].rewardRepository
export const walletRepository = providers[repositoryProvider].walletRepository
export const notificationRepository = providers[repositoryProvider].notificationRepository

export { mockAuthRepository, mockUserRepository, mockReferralRepository, mockPlanRepository, mockPaymentRepository, mockRewardRepository, mockWalletRepository, mockNotificationRepository }
export { supabaseAuthRepository, supabaseUserRepository, supabaseReferralRepository, supabasePlanRepository, supabasePaymentRepository, supabaseRewardRepository, supabaseWalletRepository, supabaseNotificationRepository }
