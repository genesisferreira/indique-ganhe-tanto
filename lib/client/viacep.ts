/** Consulta de endereço via ViaCEP (client-only). */

import { onlyDigits } from "@/lib/client/formatters"

export type ViaCepAddress = {
  cep: string
  estado: string
  cidade: string
  bairro: string
  endereco: string
}

export type FetchAddressByCEPResult =
  | { ok: true; address: ViaCepAddress }
  | {
      ok: false
      code: "invalid_cep" | "not_found" | "network_error"
      message: string
    }

type ViaCepApiResponse = {
  cep?: string
  logradouro?: string
  bairro?: string
  localidade?: string
  uf?: string
  erro?: boolean
}

/**
 * Busca endereço em https://viacep.com.br/ws/{cep}/json/
 * Não lança exceção — retorna resultado tipado.
 */
export async function fetchAddressByCEP(
  cep: string
): Promise<FetchAddressByCEPResult> {
  const digits = onlyDigits(cep)
  if (digits.length !== 8) {
    return {
      ok: false,
      code: "invalid_cep",
      message: "CEP deve ter 8 dígitos.",
    }
  }

  try {
    const response = await fetch(
      `https://viacep.com.br/ws/${digits}/json/`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }
    )

    if (!response.ok) {
      return {
        ok: false,
        code: "network_error",
        message: "Não foi possível consultar o CEP. Tente novamente.",
      }
    }

    const data = (await response.json()) as ViaCepApiResponse

    if (data.erro) {
      return {
        ok: false,
        code: "not_found",
        message: "CEP não encontrado. Verifique e tente novamente.",
      }
    }

    return {
      ok: true,
      address: {
        cep: digits,
        estado: (data.uf ?? "").trim(),
        cidade: (data.localidade ?? "").trim(),
        bairro: (data.bairro ?? "").trim(),
        endereco: (data.logradouro ?? "").trim(),
      },
    }
  } catch {
    return {
      ok: false,
      code: "network_error",
      message: "Não foi possível consultar o CEP. Preencha o endereço manualmente.",
    }
  }
}
