import type { Plano, PlanoCreateData, PlanoUpdateData } from "@/types"

export interface PlanRepository {
  getAll(includeInactive?: boolean): Promise<Plano[]>
  getById(id: string): Promise<Plano | null>
  create(data: PlanoCreateData): Promise<Plano>
  update(data: PlanoUpdateData): Promise<Plano | null>
  toggleActive(id: string): Promise<boolean>
  reorder(planIds: string[]): Promise<boolean>
}
