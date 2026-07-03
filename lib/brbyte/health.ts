import "server-only"

import { brbyteAdminLogin } from "@/lib/brbyte/admin-http"
import {
  getBrbyteConnectionConfig,
  getBrbytePublicIntegrationFlags,
} from "@/lib/brbyte/config"

export type BrbyteHealthResult = {
  ok: boolean
  apiUrl: string | null
  apiUrlHost: string | null
  isDemoEnvironment: boolean
  loginOk: boolean
  httpStatus: number | null
  message: string
  executedAt: string
}

export async function runBrbyteHealthCheck(): Promise<BrbyteHealthResult> {
  const executedAt = new Date().toISOString()
  const flags = getBrbytePublicIntegrationFlags()
  const config = getBrbyteConnectionConfig()

  if (!config) {
    return {
      ok: false,
      apiUrl: flags.apiUrlConfigured ? flags.apiUrlHost : null,
      apiUrlHost: flags.apiUrlHost,
      isDemoEnvironment: flags.isDemoEnvironment,
      loginOk: false,
      httpStatus: null,
      message:
        "Configuração incompleta. Defina BRBYTE_API_URL, BRBYTE_API_USER e BRBYTE_API_PASSWORD.",
      executedAt,
    }
  }

  const login = await brbyteAdminLogin({
    enabled: true,
    apiUrl: config.apiUrl,
    apiUser: config.apiUser,
    apiPassword: config.apiPassword,
    defaultLeadPk: "",
    defaultInterestStatus: "",
    defaultPlanPk: "",
    timeoutMs: config.timeoutMs,
  })

  if ("error" in login) {
    return {
      ok: false,
      apiUrl: flags.apiUrlHost,
      apiUrlHost: flags.apiUrlHost,
      isDemoEnvironment: flags.isDemoEnvironment,
      loginOk: false,
      httpStatus: login.httpStatus,
      message: login.error,
      executedAt,
    }
  }

  return {
    ok: true,
    apiUrl: flags.apiUrlHost,
    apiUrlHost: flags.apiUrlHost,
    isDemoEnvironment: flags.isDemoEnvironment,
    loginOk: true,
    httpStatus: login.httpStatus,
    message: "Conexão com Controllr estabelecida com sucesso.",
    executedAt,
  }
}
