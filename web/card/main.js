import { birthdayCardConfig, birthdayCardFallback } from "./config.js";

function withFallback(value, fallback) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : fallback;
}

function resolveCardConfig(config) {
  return {
    recipientName: withFallback(config.recipientName, birthdayCardFallback.recipientName),
    dateLabel: withFallback(config.dateLabel, birthdayCardFallback.dateLabel),
    shortMessage: withFallback(config.shortMessage, birthdayCardFallback.shortMessage),
    greetingTitle: withFallback(config.greetingTitle, birthdayCardFallback.greetingTitle),
    subheading: withFallback(config.subheading, birthdayCardFallback.subheading),
    ctaLabel: withFallback(config.ctaLabel, birthdayCardFallback.ctaLabel),
    ctaHref: withFallback(config.ctaHref, birthdayCardFallback.ctaHref)
  };
}

const card = resolveCardConfig(birthdayCardConfig);

document.querySelector("#greeting-title").textContent = `${card.greetingTitle}, ${card.recipientName}!`;
document.querySelector("#subheading").textContent = card.subheading;
document.querySelector("#short-message").textContent = card.shortMessage;
document.querySelector("#recipient-name").textContent = card.recipientName;
document.querySelector("#date-label").textContent = card.dateLabel;

const ctaButton = document.querySelector("#cta-button");
ctaButton.textContent = card.ctaLabel;
ctaButton.addEventListener("click", () => {
  if (card.ctaHref !== "#") {
    window.open(card.ctaHref, "_blank", "noopener,noreferrer");
  }
});
