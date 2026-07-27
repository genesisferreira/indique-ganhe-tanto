/**
 * Compatibilidade do pré-cadastro com o catálogo comercial compartilhado.
 */
export {
  COMMERCIAL_OFFERS as PUBLIC_PRE_REGISTRATION_OFFERS,
  formatCommercialOfferSelectLabel as formatPublicOfferSelectLabel,
  formatPublicOfferPrice,
  getCommercialOfferByCode as getPublicPreRegistrationOfferByCode,
  type CommercialOffer as PublicPreRegistrationOffer,
} from "@/lib/commercial-offers/catalog"
