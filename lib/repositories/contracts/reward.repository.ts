import type { Recompensa, RecompensaConfig, RecompensaSummary } from "@/types"

export interface RewardRepository {
  getByIndicador(indicadorId: string): Promise<Recompensa[]>
  getSummary(indicadorId: string): Promise<RecompensaSummary>
  getConfig(): Promise<RecompensaConfig[]>
  updateConfig(config: RecompensaConfig): Promise<boolean>
  processReward(indicacaoId: string): Promise<boolean>
  markAvailable(recompensaId: string): Promise<boolean>
}
