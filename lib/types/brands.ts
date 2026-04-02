export type BrandDealStatus =
  | "prospect"
  | "draft_ready"
  | "sent"
  | "follow_up_1"
  | "follow_up_2"
  | "replied"
  | "negotiating"
  | "form_submitted"
  | "referral_active"
  | "closed_won"
  | "closed_lost"
  | "archived";

export type BrandPriority = "P0" | "P1" | "P2";
export type ContactConfidence = "high" | "medium" | "low";
export type RelationshipType = "long_term" | "active_user" | "new" | "regular_buyer" | "competitor";
export type DealType = "one_time" | "monthly" | "affiliate" | "product_seeding" | "ambassador";
export type EmailType = "initial" | "follow_up_1" | "follow_up_2" | "response" | "negotiation";
export type EmailDirection = "outbound" | "inbound";
export type ReplyClassification = "genuine_interest" | "auto_reply" | "redirect_to_form" | "product_seeding_offer" | "decline";

export interface BrandDeal {
  id: string;
  user_id: string;
  brand_name: string;
  contact_email: string | null;
  contact_name: string | null;
  contact_confidence: ContactConfidence | null;
  status: BrandDealStatus;
  priority: BrandPriority | null;
  relationship_type: RelationshipType | null;
  relationship_notes: string | null;
  product_usage: string | null;
  angle: string | null;
  dont_say: string[];
  first_contact_date: string | null;
  last_contact_date: string | null;
  last_reply_date: string | null;
  follow_up_count: number;
  next_action: string | null;
  next_action_date: string | null;
  estimated_value_low: number | null;
  estimated_value_high: number | null;
  actual_value: number | null;
  deal_type: DealType | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archive_reason: string | null;
}

export interface BrandOutreachEmail {
  id: string;
  brand_deal_id: string;
  sent_at: string;
  email_type: EmailType;
  subject: string | null;
  gmail_thread_id: string | null;
  gmail_message_id: string | null;
  gmail_draft_id: string | null;
  direction: EmailDirection;
  summary: string | null;
  created_at: string;
}

export interface BrandDealWithEmails extends BrandDeal {
  brand_outreach_emails: BrandOutreachEmail[];
}

export interface PipelineSummary {
  total_active: number;
  by_status: Record<BrandDealStatus, number>;
  estimated_value_low: number;
  estimated_value_high: number;
  follow_ups_due: BrandDeal[];
  recent_replies: BrandDeal[];
  drafts_today: BrandDeal[];
}

export const PIPELINE_COLUMNS: { status: BrandDealStatus; label: string; color: string }[] = [
  { status: "prospect", label: "Prospects", color: "#6B7280" },
  { status: "draft_ready", label: "Draft Ready", color: "#F59E0B" },
  { status: "sent", label: "Sent", color: "#3B82F6" },
  { status: "follow_up_1", label: "Follow-up 1", color: "#8B5CF6" },
  { status: "follow_up_2", label: "Follow-up 2", color: "#EC4899" },
  { status: "replied", label: "Replied", color: "#10B981" },
  { status: "negotiating", label: "Negotiating", color: "#F97316" },
  { status: "form_submitted", label: "Form Submitted", color: "#6366F1" },
  { status: "referral_active", label: "Referral Active", color: "#14B8A6" },
  { status: "closed_won", label: "Won", color: "#22C55E" },
  { status: "closed_lost", label: "Lost", color: "#EF4444" },
];
