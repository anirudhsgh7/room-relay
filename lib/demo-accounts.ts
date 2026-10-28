import type { Role } from "@/lib/domain";

export interface DemoAccount {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  password: string;
  description: string;
}

/**
 * These accounts are intentionally public. They exist only so reviewers can
 * explore the Phase 1 foundation without an email or identity provider.
 * Never reuse these credentials outside the demo environment.
 */
export const demoAccounts: DemoAccount[] = [
  {
    id: "usr_amelia_chen",
    email: "student@roomrelay.demo",
    displayName: "Amelia Chen",
    role: "student",
    password: "demo-student-2026",
    description: "Robotics club lead with an active demo credential.",
  },
  {
    id: "usr_marcus_webb",
    email: "manager@roomrelay.demo",
    displayName: "Marcus Webb",
    role: "manager",
    password: "demo-manager-2026",
    description: "Manages Seminar Room 02 and Classroom 14.",
  },
  {
    id: "usr_priya_nair",
    email: "manager2@roomrelay.demo",
    displayName: "Priya Nair",
    role: "manager",
    password: "demo-manager-2026",
    description: "Manages Media Studio 01 and Quiet Study 03.",
  },
  {
    id: "usr_rowan_ellis",
    email: "admin@roomrelay.demo",
    displayName: "Rowan Ellis",
    role: "admin",
    password: "demo-admin-2026",
    description: "Foundation administrator with institution-wide oversight.",
  },
];
