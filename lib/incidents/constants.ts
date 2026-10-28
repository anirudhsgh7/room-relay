export const INCIDENT_CATEGORIES = [
  "damage",
  "cleanliness",
  "equipment",
  "safety",
  "overstay",
  "other",
] as const;

export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const INCIDENT_CATEGORY_LABELS: Record<IncidentCategory, string> = {
  damage: "Damage",
  cleanliness: "Cleanliness",
  equipment: "Equipment",
  safety: "Safety",
  overstay: "Overstayed use",
  other: "Other",
};

export const INCIDENT_STATUSES = ["open", "reviewing", "resolved"] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  open: "Open — awaiting review",
  reviewing: "In review",
  resolved: "Resolved",
};

export const CONDITION_STATES = ["left_as_found", "issue_found"] as const;

export type ConditionState = (typeof CONDITION_STATES)[number];

export const CONDITION_STATE_LABELS: Record<ConditionState, string> = {
  left_as_found: "Left as found",
  issue_found: "Issue found",
};

export function isIncidentCategory(value: unknown): value is IncidentCategory {
  return (
    typeof value === "string" &&
    INCIDENT_CATEGORIES.includes(value as IncidentCategory)
  );
}

export function isIncidentStatus(value: unknown): value is IncidentStatus {
  return (
    typeof value === "string" &&
    INCIDENT_STATUSES.includes(value as IncidentStatus)
  );
}
