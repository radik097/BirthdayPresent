export interface BirthdayCardConfig {
  recipientName?: string;
  dateLabel?: string;
  shortMessage?: string;
  greetingTitle?: string;
  subheading?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export interface BirthdayCardResolved {
  recipientName: string;
  dateLabel: string;
  shortMessage: string;
  greetingTitle: string;
  subheading: string;
  ctaLabel: string;
  ctaHref: string;
}

export const birthdayCardConfig: BirthdayCardConfig = {
  recipientName: "",
  dateLabel: "",
  shortMessage: "",
  greetingTitle: "",
  subheading: "",
  ctaLabel: "",
  ctaHref: ""
};

const fallbackBirthdayCard: BirthdayCardResolved = {
  recipientName: "Wanderer",
  dateLabel: "Today",
  shortMessage: "A new chapter begins. Keep your torch high and your steps relentless.",
  greetingTitle: "Happy Birthday",
  subheading: "Ancestor's blessing from the Dismas road.",
  ctaLabel: "CONQUER THE YEAR",
  ctaHref: "#"
};

function resolveText(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function resolveBirthdayCardConfig(config: BirthdayCardConfig): BirthdayCardResolved {
  return {
    recipientName: resolveText(config.recipientName, fallbackBirthdayCard.recipientName),
    dateLabel: resolveText(config.dateLabel, fallbackBirthdayCard.dateLabel),
    shortMessage: resolveText(config.shortMessage, fallbackBirthdayCard.shortMessage),
    greetingTitle: resolveText(config.greetingTitle, fallbackBirthdayCard.greetingTitle),
    subheading: resolveText(config.subheading, fallbackBirthdayCard.subheading),
    ctaLabel: resolveText(config.ctaLabel, fallbackBirthdayCard.ctaLabel),
    ctaHref: resolveText(config.ctaHref, fallbackBirthdayCard.ctaHref)
  };
}
